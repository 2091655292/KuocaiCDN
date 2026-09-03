#!/usr/bin/env python3
import hashlib
import glob
import ipaddress
import json
import os
import pwd
import re
import signal
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import urllib.parse

CONFIG_FILE = "/etc/kuocai-edge/agent.json"
AGENT_VERSION = "1.5.12"
RELEASE_ROOT = "/etc/kuocai-edge/releases"
ACTIVE_LINK = "/etc/nginx/kuocai-edge"
STREAM_ACTIVE_LINK = "/etc/nginx/kuocai-edge-stream"
DEFAULT_CACHE_DIR = "/var/cache/kuocai-cdn"
CACHE_POLICY_FILE = "/etc/kuocai-edge/cache-policy.json"
CACHE_ACCESS_DB = "/var/lib/kuocai-edge/cache-access.sqlite3"
CACHE_ACCESS_LOG = "/var/log/nginx/kuocai-edge-access.log"
CACHE_CLEANUP_INTERVAL_SECONDS = 600
STATISTICS_READ_LIMIT = 4 * 1024 * 1024
_CPU_SAMPLE = None
_LAST_CACHE_CLEANUP = 0


def load_agent_config():
    with open(CONFIG_FILE, "r", encoding="utf-8") as stream:
        return json.load(stream)


def decode_mount_value(value):
    return str(value or "").replace("\\040", " ").replace("\\011", "\t").replace("\\134", "\\")


def normalize_mount_path(value):
    mount = str(value or "/").strip().replace("\\", "/")
    while len(mount) > 1 and mount.endswith("/"):
        mount = mount[:-1]
    if (not mount.startswith("/") or len(mount) > 512 or "\x00" in mount
            or "\r" in mount or "\n" in mount or ".." in mount.split("/")):
        raise ValueError("invalid cache disk mount")
    return mount


def cache_directory_for_mount(mount):
    mount = normalize_mount_path(mount)
    return DEFAULT_CACHE_DIR if mount == "/" else mount + "/kuocai-cdn-cache"


MAX_REPORTED_BYTES = (1 << 63) - 1


def reported_bytes(value):
    return min(max(int(value or 0), 0), MAX_REPORTED_BYTES)


def detected_disks():
    supported = {
        "ext2", "ext3", "ext4", "xfs", "btrfs", "f2fs", "jfs", "reiserfs", "zfs",
        # OSSFS is explicitly supported for operators that choose an OSS-backed cache directory.
        # Other FUSE file systems stay excluded until their cache semantics are verified.
        "fuse.ossfs",
    }
    mounts = []
    try:
        with open("/proc/self/mounts", "r", encoding="utf-8") as stream:
            for line in stream:
                fields = line.split()
                if len(fields) < 4 or fields[2].lower() not in supported:
                    continue
                device = decode_mount_value(fields[0])
                mount = normalize_mount_path(decode_mount_value(fields[1]))
                if not os.path.isdir(mount):
                    continue
                mount_options = set(fields[3].split(","))
                usage = shutil.disk_usage(mount)
                mounts.append({
                    "device": device[:255],
                    "mountPath": mount,
                    "fsType": fields[2][:64],
                    # Some FUSE drivers expose unsigned 64-bit sentinel capacities. Clamp these
                    # fields so the Java heartbeat DTO can deserialize them as signed Long values.
                    "totalBytes": reported_bytes(usage.total),
                    "availableBytes": reported_bytes(usage.free),
                    "usedPercent": round(usage.used * 100.0 / usage.total, 2) if usage.total else 0,
                    "writable": "rw" in mount_options and bool(os.access(mount, os.W_OK)),
                })
    except Exception:
        mounts = []
    if not any(item.get("mountPath") == "/" for item in mounts):
        try:
            usage = shutil.disk_usage("/")
            mounts.append({
                "device": "rootfs", "mountPath": "/", "fsType": "unknown",
                "totalBytes": reported_bytes(usage.total),
                "availableBytes": reported_bytes(usage.free),
                "usedPercent": round(usage.used * 100.0 / usage.total, 2) if usage.total else 0,
                "writable": bool(os.access("/", os.W_OK)),
            })
        except Exception:
            pass
    unique = {}
    for item in mounts:
        unique[item["mountPath"]] = item
    return sorted(unique.values(), key=lambda item: (item["mountPath"] != "/", item["mountPath"]))


def default_cache_policy():
    return {
        "diskMount": "/",
        "directory": DEFAULT_CACHE_DIR,
        "maxSizeGb": 50,
        "cleanupEnabled": True,
        "cleanupAgeDays": 7,
        "cleanupMinHits": 1,
        "trackingStartedAt": int(time.time()),
    }


def normalize_cache_policy(value, require_disk=True):
    source = value if isinstance(value, dict) else {}
    mount = normalize_mount_path(source.get("diskMount") or "/")
    available = {item["mountPath"]: item for item in detected_disks()}
    if require_disk and (mount not in available or not available[mount].get("writable")):
        raise RuntimeError("所选缓存磁盘未挂载或不可写：%s" % mount)
    max_size = max(1, min(int(source.get("maxSizeGb") or 50), 102400))
    age_days = max(1, min(int(source.get("cleanupAgeDays") or 7), 3650))
    min_hits = max(1, min(int(source.get("cleanupMinHits") or 1), 1000000))
    tracking_started = int(source.get("trackingStartedAt") or int(time.time()))
    return {
        "diskMount": mount,
        "directory": cache_directory_for_mount(mount),
        "maxSizeGb": max_size,
        "cleanupEnabled": bool(source.get("cleanupEnabled", True)),
        "cleanupAgeDays": age_days,
        "cleanupMinHits": min_hits,
        "trackingStartedAt": tracking_started,
    }


def load_active_cache_policy():
    try:
        with open(CACHE_POLICY_FILE, "r", encoding="utf-8") as stream:
            return normalize_cache_policy(json.load(stream), require_disk=False)
    except Exception:
        return default_cache_policy()


def save_active_cache_policy(policy):
    previous = load_active_cache_policy()
    policy = dict(policy)
    if previous.get("directory") == policy.get("directory"):
        policy["trackingStartedAt"] = int(previous.get("trackingStartedAt") or int(time.time()))
    else:
        # 切换缓存盘后重新观察一个完整周期，避免旧盘遗留统计误删新盘缓存。
        policy["trackingStartedAt"] = int(time.time())
    os.makedirs(os.path.dirname(CACHE_POLICY_FILE), mode=0o700, exist_ok=True)
    temp_path = CACHE_POLICY_FILE + ".tmp"
    with open(temp_path, "w", encoding="utf-8") as stream:
        json.dump(policy, stream, ensure_ascii=False, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temp_path, 0o600)
    os.replace(temp_path, CACHE_POLICY_FILE)


def cache_zone_name(cache_dir):
    suffix = hashlib.sha256(cache_dir.encode("utf-8")).hexdigest()[:10]
    return "kuocai_edge_cache_" + suffix


def api_request(config, method, path, payload=None):
    url = config["controlPlane"].rstrip("/") + path
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Authorization", "Bearer " + config["token"])
    request.add_header("X-Kuocai-Node-Id", str(config["nodeId"]))
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.loads(response.read().decode("utf-8"))
    if body.get("code") != "SUCCESS":
        raise RuntimeError(body.get("message") or "control plane request failed")
    return body.get("data")


def safe_name(domain):
    value = domain.lower().strip()
    host = value[2:] if value.startswith("*.") else value[1:] if value.startswith(".") else value
    labels = host.split(".")
    valid_labels = all(
        label and len(label) <= 63 and label[0].isalnum() and label[-1].isalnum()
        and all(ch.isalnum() or ch == "-" for ch in label)
        for label in labels
    )
    if (not host or len(host) > 253 or len(labels) < 2 or not valid_labels
            or any(ord(ch) > 127 for ch in host)):
        raise ValueError("invalid domain name")
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:20]


def nginx_quote(value):
    value = str(value or "")
    if any(ch in value for ch in "\r\n{};$`\\\""):
        raise ValueError("unsafe nginx value")
    return value


def nginx_string(value):
    value = str(value or "")
    if any(ch in value for ch in "\r\n{}\x00"):
        raise ValueError("unsafe nginx string")
    return '"%s"' % value.replace("\\", "\\\\").replace('"', '\\"')


def json_config(value):
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def safe_header_name(value):
    value = str(value or "").strip()
    if not re.match(r"^[A-Za-z][A-Za-z0-9-]{0,99}$", value):
        raise ValueError("invalid HTTP header name")
    return value


def safe_url(value):
    value = str(value or "").strip()
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("invalid HTTP URL")
    return nginx_quote(value)


def normalize_switch(value, default="off"):
    return "on" if str(value or default).lower() == "on" else "off"


def origin_protocol(domain, incoming_protocol=None):
    protocol = domain.get("originProtocol", "http")
    if protocol == "follow":
        protocol = incoming_protocol or "http"
    return "https" if protocol == "https" else "http"


def origin_endpoint(address, port):
    address = str(address or "").strip()
    if not address or any(ch in address for ch in "\r\n{};$`\\/\""):
        raise ValueError("invalid origin address")
    if ":" in address and not address.startswith("["):
        address = "[" + address + "]"
    return "%s:%d" % (address, int(port))


def origin_url(domain):
    protocol = origin_protocol(domain)
    port = domain.get("httpsPort", 443) if protocol == "https" else domain.get("httpPort", 80)
    address = str(domain.get("originAddress", "")).split(";")[0].strip()
    return "%s://%s" % (protocol, origin_endpoint(address, port))


def origin_upstream(domain, name, origin_config, protocol_override=None):
    protocol = origin_protocol(domain, protocol_override)
    port = int(domain.get("httpsPort", 443) if protocol == "https" else domain.get("httpPort", 80))
    addresses = [item.strip() for item in str(domain.get("originAddress") or "").replace(",", ";").split(";") if item.strip()]
    if not addresses:
        raise ValueError("origin address is empty")
    upstream_name = "kuocai_origin_" + name
    lines = ["upstream %s {" % upstream_name]
    for address in addresses:
        lines.append("    server %s;" % origin_endpoint(address, port))
    standby = origin_config.get("standby") or {}
    standby_address = standby.get("ipOrDomain") or standby.get("ip_or_domain")
    if standby_address:
        standby_port = standby.get("httpsPort", 443) if protocol == "https" else standby.get("httpPort", 80)
        for address in str(standby_address).replace(",", ";").split(";"):
            if address.strip():
                lines.append("    server %s backup;" % origin_endpoint(address.strip(), standby_port))
    lines.extend(["    keepalive 32;", "}"])
    return lines, "%s://%s" % (protocol, upstream_name)


def ttl_seconds(rule):
    value = max(0, min(int(rule.get("ttl") or 0), 31536000))
    unit = str(rule.get("ttl_unit") or "s").lower()
    return min(value * {"s": 1, "m": 60, "h": 3600, "d": 86400}.get(unit, 1), 31536000)


def safe_path(value):
    value = urllib.parse.unquote(str(value or "").strip(), errors="strict")
    if (not value.startswith("/") or len(value) > 2048
            or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~/% " for ch in value)):
        raise ValueError("unsafe cache path")
    # Nginx matches locations against the normalized (percent-decoded) URI. Quote the
    # decoded path so exact cache rules also work for filenames containing spaces.
    return nginx_string(value)


def cache_key_line(config, include_slice=False):
    config = config or {}
    if config.get("_querySuffixVariable"):
        key = "$scheme$proxy_host$uri%s" % config.get("_querySuffixVariable")
        quoted = False
    else:
        mode = str(config.get("url_parameter_type") or config.get("urlParameterType") or "")
        values = str(config.get("url_parameter_value") or config.get("urlParameterValue") or "")
        if not mode:
            ignore = config.get("ignoreQueryString") or {}
            if normalize_switch(ignore.get("enable")) == "on":
                mode = "reserve_params" if ignore.get("type") == "allow" else "del_params"
                values = str(ignore.get("hashKeyArgs") or "")
        if mode == "ignore_url_params":
            key = "$scheme$proxy_host$uri"
            quoted = False
        elif mode == "reserve_params":
            parameters = []
            for value in re.split(r"[,;，；]", values):
                value = value.strip()
                if value and re.match(r"^[A-Za-z0-9_-]{1,64}$", value):
                    parameters.append("%s=$arg_%s" % (value, value))
            suffix = "&".join(parameters)
            key = "$scheme$proxy_host$uri?" + suffix
            quoted = True
        else:
            # Nginx cannot safely remove arbitrary unknown parameters without Lua/njs.
            # Keep the full query string for del_params so different resources never share a cache entry.
            key = "$scheme$proxy_host$uri$is_args$args"
            quoted = False
    if include_slice:
        key += "$slice_range"
    return "        proxy_cache_key %s;" % (nginx_string(key) if quoted else key)


def cache_slice_size_mb(cache_settings):
    try:
        size = int(cache_settings.get("sliceSizeMb") or cache_settings.get("slice_size_mb") or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, min(size, 64))


def query_filter_maps(cache, name):
    maps = []
    candidates = [("global", cache)]
    for index, rule in enumerate(cache.get("cacheRules") or cache.get("cache_rules") or []):
        candidates.append(("r%d" % index, rule))
    for label, config in candidates:
        mode = str(config.get("url_parameter_type") or config.get("urlParameterType") or "")
        values = str(config.get("url_parameter_value") or config.get("urlParameterValue") or "")
        if label == "global" and not mode:
            ignore = config.get("ignoreQueryString") or {}
            if normalize_switch(ignore.get("enable")) == "on" and ignore.get("type") == "block":
                mode = "del_params"
                values = str(ignore.get("hashKeyArgs") or "")
        parameters = [value for value in split_values(values)
                      if re.match(r"^[A-Za-z0-9_-]{1,64}$", value)]
        if mode != "del_params" or not parameters:
            continue
        source = "$args"
        prefix = "kuocai_q_%s_%s" % (name[:10], label)
        for index, parameter in enumerate(parameters):
            target = "$%s_%d" % (prefix, index)
            capture = "q%s%s%d" % (name[:6], label.replace("_", ""), index)
            escaped = re.escape(parameter)
            maps.extend([
                "map %s %s {" % (source, target),
                "    default %s;" % source,
                "    ~^%s=[^&]*&?(?<%sa>.*)$ $%sa;" % (escaped, capture, capture),
                "    ~^(?<%sb>.+)&%s=[^&]*$ $%sb;" % (capture, escaped, capture),
                "    ~^(?<%sb>.+)&%s=[^&]*&(?<%sa>.*)$ $%sb&$%sa;" %
                (capture, escaped, capture, capture, capture),
                "}",
            ])
            source = target
        suffix = "$%s_suffix" % prefix
        maps.extend(["map %s %s {" % (source, suffix), "    default ?%s;" % source,
                     '    "" "";', "}"])
        config["_querySuffixVariable"] = suffix
    return maps


def rewrite_lines(origin_config):
    result = []
    rules = origin_config.get("originRequestUrlRewrite") or []
    for rule in sorted(rules, key=lambda item: int(item.get("priority") or 0), reverse=True):
        match_type = str(rule.get("match_type") or rule.get("matchType") or "")
        source = str(rule.get("source_url") or rule.get("sourceUrl") or "")
        target = str(rule.get("target_url") or rule.get("targetUrl") or "")
        if not target.startswith("/") or not re.match(r"^/[A-Za-z0-9._~/%$-]*$", target):
            raise ValueError("invalid origin rewrite target")
        if match_type == "all":
            pattern = "^/.*$"
        elif match_type == "wildcard" and source.startswith("/"):
            chunks = source.split("*")
            pattern = "^" + "(.*)".join(re.escape(chunk) for chunk in chunks) + "$"
        elif source.startswith("/") and re.match(r"^/[A-Za-z0-9._~/%-]*$", source):
            pattern = "^" + re.escape(source) + ("$" if match_type == "full_path" else "")
        else:
            raise ValueError("invalid origin rewrite source")
        result.append("        rewrite %s %s break;" % (pattern, target))
    return result


def origin_header_lines(origin_config):
    result = []
    for item in origin_config.get("originRequestHeader") or []:
        name = safe_header_name(item.get("name"))
        action = str(item.get("action") or "set").lower()
        value = "" if action == "delete" else item.get("value")
        result.append("        proxy_set_header %s %s;" % (name, nginx_string(value)))
    return result


def response_header_lines(advanced):
    result = []
    for item in advanced.get("httpResponseHeaders") or []:
        name = safe_header_name(item.get("name"))
        if str(item.get("action") or "set").lower() == "delete":
            result.append("        proxy_hide_header %s;" % name)
        else:
            result.append("        add_header %s %s always;" % (name, nginx_string(item.get("value"))))
    return result


def ignores_origin_cache_headers(cache_settings):
    for key in ("follow_origin", "followOrigin"):
        if key in cache_settings and cache_settings.get(key) is not None:
            return normalize_switch(cache_settings.get(key), "off") == "off"
    return False


def proxy_location(selector, ttl, origin, origin_host, error_rules, options, cache_rule=None):
    origin_config = options.get("origin") or {}
    timeout = max(1, min(int(origin_config.get("originReceiveTimeout") or 30), 300))
    cache_settings = dict(options.get("cache") or {})
    if cache_rule:
        cache_settings.update(cache_rule)
    slice_size_mb = cache_slice_size_mb(cache_settings) if ttl > 0 else 0
    lines = ["    location %s {" % selector,
             "        proxy_set_header Host %s;" % origin_host,
             "        proxy_set_header X-Real-IP $remote_addr;",
             "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
             "        proxy_set_header X-Forwarded-Proto $scheme;",
             "        proxy_http_version 1.1;",
             "        proxy_connect_timeout %ds;" % timeout,
             "        proxy_read_timeout %ds;" % timeout,
             "        proxy_send_timeout %ds;" % timeout,
             "        proxy_cache %s;" % options.get("cacheZone", "kuocai_edge_cache"),
             cache_key_line(cache_settings, slice_size_mb > 0)]
    lines.extend(origin_header_lines(origin_config))
    lines.extend(rewrite_lines(origin_config))
    if normalize_switch(origin_config.get("rangeStatus"), "on") == "on":
        lines.append("        proxy_force_ranges on;")
    if origin.startswith("https://"):
        lines.extend(["        proxy_ssl_server_name on;", "        proxy_ssl_name %s;" % origin_host])
    if normalize_switch(origin_config.get("followRedirectStatus")) == "on":
        lines.extend(["        proxy_intercept_errors on;",
                      "        error_page 301 302 307 308 = @kuocai_follow_redirect_1;"])
    if ttl <= 0:
        lines.extend([
            "        proxy_cache_bypass 1;",
            "        proxy_no_cache 1;",
            "        proxy_set_header Range $http_range;",
        ])
    else:
        lines.extend([
            # Cache directories may be backed by OSSFS/FUSE. Nginx sendfile can
            # stall large cached responses on those filesystems after only the
            # initial output buffers have been sent.
            "        sendfile off;",
            "        proxy_cache_lock on;",
            "        proxy_cache_lock_timeout 300s;",
            "        proxy_cache_lock_age 300s;",
            "        proxy_cache_use_stale error timeout invalid_header updating http_500 http_502 http_503 http_504;",
            "        proxy_cache_revalidate on;",
        ])
        if slice_size_mb > 0:
            lines.extend([
                "        slice %dm;" % slice_size_mb,
                "        proxy_set_header Range $slice_range;",
            ])
        lines.append("        proxy_cache_valid 200 206 %ds;" % ttl)
        if ignores_origin_cache_headers(cache_settings):
            lines.append("        proxy_ignore_headers X-Accel-Expires Expires Cache-Control;")
    for rule in error_rules:
        code = int(rule.get("code") or 0)
        error_ttl = max(0, min(int(rule.get("ttl") or 0), 31536000))
        if code in (400, 403, 404, 405, 414, 500, 501, 502, 503, 504):
            lines.append("        proxy_cache_valid %d %ds;" % (code, error_ttl))
    lines.extend(response_header_lines(options.get("advanced") or {}))
    lines.extend(["        add_header X-Kuocai-Cache $upstream_cache_status always;",
                  "        proxy_pass %s;" % origin,
                  "    }"])
    return lines


def cache_locations(cache, origin, origin_host, options):
    rules = cache.get("cacheRules") or cache.get("cache_rules") or []
    error_rules = cache.get("errorCodeCache") or cache.get("error_code_cache") or []
    default_ttl = max(0, min(int(cache.get("defaultTtl", 3600)), 31536000))
    default_rule = None
    locations = []
    for rule in sorted(rules, key=lambda item: int(item.get("priority") or 0), reverse=True):
        match_type = rule.get("match_type") or rule.get("matchType")
        values = str(rule.get("match_value") or rule.get("matchValue") or "").replace(",", ";").split(";")
        ttl = ttl_seconds(rule)
        if match_type == "all":
            if default_rule is None:
                default_ttl = ttl
                default_rule = rule
        elif match_type == "file_extension":
            extensions = [value.strip().lstrip(".") for value in values if value.strip().lstrip(".").isalnum()]
            if extensions:
                locations.extend(proxy_location("~* \\.(%s)$" % "|".join(extensions), ttl, origin, origin_host, error_rules, options, rule))
        elif match_type == "catalog":
            for value in values:
                if value.strip():
                    if urllib.parse.unquote(value.strip(), errors="strict") == "/":
                        if default_rule is None:
                            default_ttl = ttl
                            default_rule = rule
                    else:
                        locations.extend(proxy_location("^~ " + safe_path(value), ttl, origin,
                                                        origin_host, error_rules, options, rule))
        elif match_type in ("full_path", "home_page"):
            paths = ["/"] if match_type == "home_page" else values
            for value in paths:
                if value.strip() and "*" not in value:
                    locations.extend(proxy_location("= " + safe_path(value), ttl, origin, origin_host, error_rules, options, rule))
    locations.extend(proxy_location("/", default_ttl, origin, origin_host, error_rules,
                                    options, default_rule))
    return locations


def split_values(value):
    if isinstance(value, list):
        values = value
    else:
        values = re.split(r"[,;\r\n，；]", str(value or ""))
    return [str(item).strip() for item in values if str(item).strip()]


def wildcard_regex(values):
    patterns = []
    for value in values:
        if len(value) > 200:
            raise ValueError("access rule is too long")
        patterns.append(re.escape(value).replace(r"\*", ".*"))
    return "(?:%s)" % "|".join(patterns)


def access_server_lines(access):
    lines = []
    referer = access.get("referer") or {}
    referer_type = int(referer.get("referer_type") or referer.get("refererType") or 0)
    referers = split_values(referer.get("referers") or referer.get("referer_list"))
    include_empty = bool(referer.get("include_empty", True))
    if referer_type == 2:
        valid_referers = []
        if include_empty:
            valid_referers.append("none")
        for value in referers:
            value = value.replace("http://", "").replace("https://", "").split("/", 1)[0]
            if not re.match(r"^(?:\*\.)?[A-Za-z0-9.-]+(?::[0-9]{1,5})?$", value):
                raise ValueError("invalid referer whitelist value")
            valid_referers.append(value)
        if valid_referers:
            lines.extend(["    valid_referers %s;" % " ".join(valid_referers),
                          "    if ($invalid_referer) { return 403; }"])
        else:
            lines.append("    return 403;")
    elif referer_type == 1:
        if referers:
            lines.append("    if ($http_referer ~* %s) { return 403; }" % nginx_string(wildcard_regex(referers)))
        if include_empty:
            lines.append('    if ($http_referer = "") { return 403; }')

    ip_type = int(access.get("ipType") or 0)
    ips = split_values(access.get("ips"))
    normalized_ips = []
    for value in ips:
        try:
            normalized_ips.append(str(ipaddress.ip_network(value, strict=False)))
        except ValueError:
            raise ValueError("invalid IP access rule")
    if ip_type == 1:
        lines.extend("    deny %s;" % value for value in normalized_ips)
    elif ip_type == 2:
        lines.extend("    allow %s;" % value for value in normalized_ips)
        lines.append("    deny all;")

    user_agent = access.get("userAgent") or {}
    ua_type = int(user_agent.get("type") or 0)
    ua_values = split_values(user_agent.get("ua_list") or user_agent.get("uaList"))
    if ua_type == 1 and ua_values:
        lines.append("    if ($http_user_agent ~* %s) { return 403; }" % nginx_string(wildcard_regex(ua_values)))
    elif ua_type == 2:
        if ua_values:
            lines.append("    if ($http_user_agent !~* %s) { return 403; }" % nginx_string(wildcard_regex(ua_values)))
        else:
            lines.append("    return 403;")

    url_auth = access.get("urlAuth") or {}
    if normalize_switch(url_auth.get("status")) == "on":
        primary_key = str(url_auth.get("primary_key") or url_auth.get("primaryKey") or "")
        if not primary_key or len(primary_key) > 128:
            raise ValueError("URL auth primary key is invalid")
        auth_type = str(url_auth.get("type") or "typeA")
        signature_arg = "$arg_sign" if auth_type == "typeA" else "$arg_auth_key"
        expires_arg = "$arg_t" if auth_type == "typeA" else "$arg_timestamp"
        lines.extend(["    secure_link %s,%s;" % (signature_arg, expires_arg),
                      "    secure_link_md5 %s;" % nginx_string(primary_key + "$secure_link_expires$uri"),
                      '    if ($secure_link = "") { return 403; }',
                      '    if ($secure_link = "0") { return 410; }'])
    return lines


def advanced_server_lines(advanced):
    lines = []
    compress = advanced.get("compress") or {}
    if normalize_switch(compress.get("status"), "on") == "on":
        lines.extend(["    gzip on;", "    gzip_vary on;", "    gzip_min_length 1024;",
                      "    gzip_types text/plain text/css application/json application/javascript "
                      "application/xml application/xml+rss image/svg+xml;"])
    else:
        lines.append("    gzip off;")
    for item in advanced.get("errorCodeRedirectRules") or []:
        code = int(item.get("error_code") or item.get("errorCode") or 0)
        target_code = int(item.get("target_code") or item.get("targetCode") or 302)
        if code in (400, 403, 404, 405, 406, 414, 416, 451, 500, 501, 502, 503, 504) and target_code in (301, 302):
            lines.append("    error_page %d =%d %s;" % (code, target_code,
                                                        safe_url(item.get("target_link") or item.get("targetLink"))))
    for item in advanced.get("errorPages") or []:
        code = int(item.get("errorHttpCode") or 0)
        if code in (400, 403, 404, 405, 406, 414, 416, 500, 501, 502, 503, 504):
            lines.append("    error_page %d =302 %s;" % (code, safe_url(item.get("customPageUrl"))))
    return lines


def attack_protection_settings(advanced):
    source = advanced.get("attackProtection") or advanced.get("attack_protection") or {}
    try:
        request_rate = int(source.get("requestRate") or source.get("request_rate") or 1000)
        burst = int(source.get("burst") or 2000)
        max_connections = int(source.get("maxConnections")
                              or source.get("max_connections") or 300)
    except (TypeError, ValueError):
        request_rate, burst, max_connections = 1000, 2000, 300
    return {
        "enabled": normalize_switch(source.get("status"), "on") == "on",
        "requestRate": max(10, min(request_rate, 100000)),
        "burst": max(1, min(burst, 1000000)),
        "maxConnections": max(10, min(max_connections, 100000)),
    }


def attack_protection_zone_lines(name, settings):
    if not settings["enabled"]:
        return []
    return [
        "limit_req_zone $server_name zone=kuocai_attack_req_%s:64k rate=%dr/s;"
        % (name, settings["requestRate"]),
        "limit_conn_zone $server_name zone=kuocai_attack_conn_%s:64k;" % name,
    ]


def attack_protection_server_lines(name, settings):
    if not settings["enabled"]:
        return []
    return [
        "    limit_req zone=kuocai_attack_req_%s burst=%d nodelay;"
        % (name, settings["burst"]),
        "    limit_req_status 429;",
        "    limit_conn kuocai_attack_conn_%s %d;"
        % (name, settings["maxConnections"]),
        "    limit_conn_status 429;",
        "    client_header_timeout 10s;",
        "    client_body_timeout 10s;",
        "    send_timeout 30s;",
        "    reset_timedout_connection on;",
    ]


def flexible_origin_locations(domain, origin_config, cache, origin_host, options, protocol_override=None):
    locations = []
    error_rules = cache.get("errorCodeCache") or cache.get("error_code_cache") or []
    protocol = origin_protocol(domain, protocol_override)
    port = domain.get("httpsPort", 443) if protocol == "https" else domain.get("httpPort", 80)
    for rule in sorted(origin_config.get("flexibleOrigins") or [],
                       key=lambda item: int(item.get("priority") or 0), reverse=True):
        sources = rule.get("back_sources") or rule.get("backSources") or []
        if not sources:
            continue
        address = sources[0].get("ip_or_domain") or sources[0].get("ipOrDomain")
        target_origin = "%s://%s" % (protocol, origin_endpoint(address, port))
        match_type = rule.get("match_type") or rule.get("matchType")
        values = split_values(rule.get("match_pattern") or rule.get("matchPattern"))
        selectors = []
        if match_type == "file_extension":
            extensions = [value.lstrip(".") for value in values if re.match(r"^[A-Za-z0-9_-]+$", value.lstrip("."))]
            if extensions:
                selectors.append("~* \\.(%s)$" % "|".join(extensions))
        elif match_type in ("file_path", "catalog"):
            selectors.extend("^~ " + safe_path(value) for value in values)
        elif match_type == "full_path":
            selectors.extend("= " + safe_path(value) for value in values if "*" not in value)
        for selector in selectors:
            locations.extend(proxy_location(selector, int(cache.get("defaultTtl", 3600)), target_origin,
                                            origin_host, error_rules, options))
    return locations


def default_flexible_origin(domain, origin_config, fallback, protocol_override=None):
    protocol = origin_protocol(domain, protocol_override)
    port = domain.get("httpsPort", 443) if protocol == "https" else domain.get("httpPort", 80)
    for rule in sorted(origin_config.get("flexibleOrigins") or [],
                       key=lambda item: int(item.get("priority") or 0), reverse=True):
        match_type = rule.get("match_type") or rule.get("matchType")
        sources = rule.get("back_sources") or rule.get("backSources") or []
        if match_type == "all" and sources:
            address = sources[0].get("ip_or_domain") or sources[0].get("ipOrDomain")
            return "%s://%s" % (protocol, origin_endpoint(address, port))
    return fallback


def follow_redirect_location(origin_host, origin_config):
    if normalize_switch(origin_config.get("followRedirectStatus")) != "on":
        return []
    timeout = max(1, min(int(origin_config.get("originReceiveTimeout") or 30), 300))
    max_times = max(1, min(int(origin_config.get("followRedirectMaxTimes") or 1), 5))
    lines = []
    for index in range(1, max_times + 1):
        lines.extend(["    location @kuocai_follow_redirect_%d {" % index,
                      "        resolver 223.5.5.5 119.29.29.29 valid=300s;",
                      "        proxy_set_header Host $proxy_host;",
                      "        proxy_set_header X-Real-IP $remote_addr;",
                      "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
                      "        proxy_connect_timeout %ds;" % timeout,
                      "        proxy_read_timeout %ds;" % timeout,
                      "        proxy_ssl_server_name on;"])
        if index < max_times:
            lines.extend(["        proxy_intercept_errors on;",
                          "        error_page 301 302 307 308 = @kuocai_follow_redirect_%d;" % (index + 1)])
        lines.extend(["        proxy_pass $upstream_http_location;", "    }"])
    return lines


def tls_protocols(value):
    supported = {"TLSv1.0": "TLSv1", "TLSv1.1": "TLSv1.1",
                 "TLSv1.2": "TLSv1.2", "TLSv1.3": "TLSv1.3"}
    protocols = []
    for item in split_values(value or "TLSv1.2,TLSv1.3"):
        if item in supported and supported[item] not in protocols:
            protocols.append(supported[item])
    return protocols or ["TLSv1.2", "TLSv1.3"]


def server_common(name, domain_name, origin_host, domain, origin_config, cache, access,
                  advanced, origin, protocol_override=None, cache_zone="kuocai_edge_cache"):
    options = {"origin": origin_config, "cache": cache, "advanced": advanced,
               "cacheZone": cache_zone}
    actual_origin = default_flexible_origin(domain, origin_config, origin, protocol_override)
    locations = flexible_origin_locations(domain, origin_config, cache, origin_host,
                                          options, protocol_override)
    locations.extend(cache_locations(cache, actual_origin, origin_host, options))
    locations.extend(follow_redirect_location(origin_host, origin_config))
    common = ["    server_name %s;" % domain_name,
              "    access_log /var/log/nginx/kuocai-edge-access.log kuocai_edge;"]
    common.extend(attack_protection_server_lines(name, attack_protection_settings(advanced)))
    common.extend(access_server_lines(access))
    common.extend(advanced_server_lines(advanced))
    common.extend(locations)
    return common


ICP_BLOCK_PAGE = (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1">'
    '<title>域名备案提示</title></head>'
    '<body style="margin:0;background:#f7f8fa;color:#1f2937;font-family:Arial,Microsoft YaHei,sans-serif;">'
    '<main style="max-width:680px;margin:12vh auto;padding:48px;background:#fff;border:1px solid #e5e7eb;'
    'border-radius:16px;box-shadow:0 12px 36px rgba(15,23,42,.08);">'
    '<div style="font-size:42px;margin-bottom:20px;">&#9888;</div>'
    '<h1 style="font-size:26px;margin:0 0 18px;">该域名已暂停加速</h1>'
    '<p style="font-size:17px;line-height:1.8;margin:0;">该域名目前未通过阿里云备案，'
    '请完成阿里云接入备案后再启用加速。</p>'
    '</main></body></html>'
)


def write_icp_blocked_domain_config(release_dir, domain):
    name = safe_name(domain["domainName"])
    domain_name = nginx_quote(domain["domainName"])
    listeners = ["    listen 80;"]
    if int(domain.get("ipv6Enabled") or 0) == 1:
        listeners.append("    listen [::]:80;")
    common = [
        "    server_name %s;" % domain_name,
        "    default_type text/html;",
        "    charset utf-8;",
        '    add_header Cache-Control "no-store" always;',
        "    return 451 %s;" % nginx_string(ICP_BLOCK_PAGE),
    ]
    blocks = ["server {", *listeners, *common, "}"]
    if int(domain.get("httpsEnabled") or 0) == 1:
        certificate = domain.get("certificate") or ""
        private_key = domain.get("privateKey") or ""
        if certificate and private_key:
            cert_path = os.path.join(release_dir, name + ".crt")
            key_path = os.path.join(release_dir, name + ".key")
            with open(cert_path, "w", encoding="utf-8") as stream:
                stream.write(certificate)
            with open(key_path, "w", encoding="utf-8") as stream:
                stream.write(private_key)
            os.chmod(key_path, 0o600)
            https_listeners = ["    listen 443 ssl;"]
            if int(domain.get("ipv6Enabled") or 0) == 1:
                https_listeners.append("    listen [::]:443 ssl;")
            blocks.extend([
                "server {",
                *https_listeners,
                "    ssl_certificate %s;" % cert_path,
                "    ssl_certificate_key %s;" % key_path,
                *common,
                "}",
            ])
    with open(os.path.join(release_dir, name + ".conf"), "w", encoding="utf-8") as stream:
        stream.write("\n".join(blocks) + "\n")


def write_domain_config(release_dir, domain, cache_zone="kuocai_edge_cache"):
    if domain.get("icpBlocked") is True:
        write_icp_blocked_domain_config(release_dir, domain)
        return
    name = safe_name(domain["domainName"])
    domain_name = nginx_quote(domain["domainName"])
    origin_host = nginx_quote(domain.get("originHost") or domain_name)
    origin_config = json_config(domain.get("originConfigJson"))
    cache = json_config(domain.get("cacheConfigJson"))
    access = json_config(domain.get("accessConfigJson"))
    advanced = json_config(domain.get("advancedConfigJson"))
    https_config = json_config(domain.get("httpsConfigJson"))
    query_maps = query_filter_maps(cache, name)
    attack_settings = attack_protection_settings(advanced)
    attack_zones = attack_protection_zone_lines(name, attack_settings)
    follows_request = str(domain.get("originProtocol") or "http").lower() == "follow"
    upstream, http_origin = origin_upstream(domain, name + "_http" if follows_request else name,
                                            origin_config, "http" if follows_request else None)
    https_origin = http_origin
    if follows_request and int(domain.get("httpsEnabled") or 0) == 1:
        https_upstream, https_origin = origin_upstream(domain, name + "_https", origin_config, "https")
        upstream.extend([""] + https_upstream)
    http_common = server_common(name, domain_name, origin_host, domain, origin_config, cache,
                                access, advanced, http_origin, "http", cache_zone)
    http_listeners = ["    listen 80;"]
    if int(domain.get("ipv6Enabled") or 0) == 1:
        http_listeners.append("    listen [::]:80;")
    blocks = [*query_maps, *attack_zones, "", *upstream, "",
              "server {", *http_listeners, *http_common, "}"]
    if int(domain.get("httpsEnabled") or 0) == 1:
        certificate = domain.get("certificate") or ""
        private_key = domain.get("privateKey") or ""
        if not certificate or not private_key:
            raise ValueError("HTTPS certificate is incomplete for " + domain_name)
        cert_path = os.path.join(release_dir, name + ".crt")
        key_path = os.path.join(release_dir, name + ".key")
        with open(cert_path, "w", encoding="utf-8") as stream:
            stream.write(certificate)
        with open(key_path, "w", encoding="utf-8") as stream:
            stream.write(private_key)
        os.chmod(key_path, 0o600)
        if domain.get("forceRedirect") == "on":
            redirect_code = int(https_config.get("redirectCode") or 301)
            if redirect_code not in (301, 302):
                redirect_code = 301
            blocks = [
                *query_maps,
                *attack_zones,
                "",
                *upstream,
                "",
                "server {",
                *http_listeners,
                "    server_name %s;" % domain_name,
                *attack_protection_server_lines(name, attack_settings),
                "    return %d https://$host$request_uri;" % redirect_code,
                "}",
            ]
        https_listen = "    listen 443 ssl"
        if normalize_switch(https_config.get("http2Status"), "on") == "on":
            https_listen += " http2"
        https_listeners = [https_listen + ";"]
        if int(domain.get("ipv6Enabled") or 0) == 1:
            https_listeners.append(https_listen.replace("443", "[::]:443", 1) + ";")
        ssl_lines = [
            "    ssl_certificate %s;" % cert_path,
            "    ssl_certificate_key %s;" % key_path,
            "    ssl_protocols %s;" % " ".join(tls_protocols(https_config.get("tlsVersion"))),
        ]
        if normalize_switch(https_config.get("ocspStaplingStatus")) == "on":
            ssl_lines.extend(["    ssl_stapling on;", "    ssl_stapling_verify on;"])
        https_common = server_common(name, domain_name, origin_host, domain, origin_config, cache,
                                     access, advanced, https_origin, "https", cache_zone)
        blocks.extend([
            "server {",
            *https_listeners,
            *ssl_lines,
            *https_common,
            "}",
        ])
    with open(os.path.join(release_dir, name + ".conf"), "w", encoding="utf-8") as stream:
        stream.write("\n".join(blocks) + "\n")


def write_port_forward_config(release_dir, rule):
    rule_id = int(rule.get("id") or rule.get("ruleId") or 0)
    if rule_id <= 0:
        raise ValueError("invalid port forward rule id")
    protocol = str(rule.get("protocol") or "").lower()
    if protocol not in ("tcp", "udp"):
        raise ValueError("unsupported port forward protocol")
    listen_port = int(rule.get("listenPort") or 0)
    origin_port = int(rule.get("originPort") or 0)
    if not 1 <= listen_port <= 65535 or not 1 <= origin_port <= 65535:
        raise ValueError("invalid port forward port")
    origin_host = origin_endpoint(rule.get("originHost"), origin_port)
    upstream_name = "kuocai_port_forward_%d" % rule_id
    lines = ["upstream %s {" % upstream_name,
             "    server %s;" % origin_host,
             "}", "", "server {"]
    listen = "    listen %d" % listen_port
    if protocol == "udp":
        listen += " udp reuseport"
    lines.extend([listen + ";",
                  "    proxy_connect_timeout 10s;",
                  "    proxy_timeout 1h;"])
    proxy_protocol_enabled = rule.get("proxyProtocolEnabled")
    if (proxy_protocol_enabled is True
            or str(proxy_protocol_enabled or "").strip().lower() in ("1", "on", "true", "yes")):
        lines.append("    proxy_protocol on;")
    lines.extend(["    proxy_pass %s;" % upstream_name,
                  "    access_log /var/log/nginx/kuocai-edge-stream-access.log kuocai_edge_stream;",
                  "}"])
    with open(os.path.join(release_dir, "port-forward-%d.conf" % rule_id), "w", encoding="utf-8") as stream:
        stream.write("\n".join(lines) + "\n")


def base_config_content(cache_policy):
    cache_dir = cache_policy["directory"]
    cache_zone = cache_zone_name(cache_dir)
    return """proxy_cache_path %s levels=1:2 keys_zone=%s:100m max_size=%dg inactive=3650d use_temp_path=off;
log_format kuocai_edge '$msec|$scheme|$host|$request_uri|$status|$body_bytes_sent|$upstream_cache_status|$request_time|$upstream_status';
include /etc/nginx/kuocai-edge/*.conf;
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    return 444;
}
""" % (nginx_string(cache_dir), cache_zone, cache_policy["maxSizeGb"])


def nginx_worker_identity():
    candidates = []
    try:
        with open("/etc/nginx/nginx.conf", "r", encoding="utf-8") as stream:
            match = re.search(r"(?m)^\s*user\s+([^;\s]+)(?:\s+([^;\s]+))?\s*;", stream.read())
        if match:
            candidates.append(match.group(1))
    except (OSError, UnicodeError):
        pass
    candidates.extend(["www-data", "nginx", "nobody"])
    checked = set()
    for username in candidates:
        if not username or username in checked:
            continue
        checked.add(username)
        try:
            account = pwd.getpwnam(username)
            return account.pw_uid, account.pw_gid, username
        except KeyError:
            continue
    raise RuntimeError("无法识别 Nginx 工作进程用户")


def worker_can_write_cache(cache_dir, uid, gid):
    probe_name = ".kuocai-write-test-%d" % os.getpid()
    probe_path = os.path.join(cache_dir, probe_name)
    child = os.fork()
    if child == 0:
        try:
            os.setgroups([])
            os.setgid(gid)
            os.setuid(uid)
            descriptor = os.open(probe_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(descriptor)
            os.unlink(probe_path)
            os._exit(0)
        except Exception:
            os._exit(1)
    _, status = os.waitpid(child, 0)
    try:
        if os.path.exists(probe_path):
            os.unlink(probe_path)
    except OSError:
        pass
    return os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0


def prepare_cache_directory(cache_dir):
    if os.path.lexists(cache_dir) and os.path.islink(cache_dir):
        raise RuntimeError("缓存目录不能是符号链接：%s" % cache_dir)
    os.makedirs(cache_dir, mode=0o750, exist_ok=True)
    uid, gid, username = nginx_worker_identity()
    try:
        os.chown(cache_dir, uid, gid)
        os.chmod(cache_dir, 0o750)
    except OSError:
        # Some FUSE implementations reject chown but still allow POSIX mode changes.
        # Keep this fallback limited to the dedicated cache directory and verify it below.
        try:
            os.chmod(cache_dir, 0o777)
        except OSError:
            pass
    if not worker_can_write_cache(cache_dir, uid, gid):
        raise RuntimeError("缓存目录对 Nginx 工作进程不可写：%s（用户 %s）" % (cache_dir, username))


def install_base_config(cache_policy):
    cache_dir = cache_policy["directory"]
    prepare_cache_directory(cache_dir)
    # 节点没有匹配到已下发域名时，禁止落到系统默认欢迎页，避免暴露操作系统信息。
    for default_path in ("/etc/nginx/conf.d/default.conf", "/etc/nginx/sites-enabled/default"):
        try:
            if os.path.lexists(default_path):
                os.unlink(default_path)
        except OSError:
            pass
    remove_distribution_default_server()
    path = "/etc/nginx/conf.d/kuocai-edge-base.conf"
    old_content = open(path, "r", encoding="utf-8").read() if os.path.exists(path) else None
    content = base_config_content(cache_policy)
    if not os.path.exists(path) or open(path, "r", encoding="utf-8").read() != content:
        with open(path, "w", encoding="utf-8") as stream:
            stream.write(content)
    return path, old_content


def restore_base_config(snapshot):
    if not snapshot:
        return
    path, content = snapshot
    if content is None:
        if os.path.exists(path):
            os.unlink(path)
        return
    with open(path, "w", encoding="utf-8") as stream:
        stream.write(content)


def remove_distribution_default_server():
    path = "/etc/nginx/nginx.conf"
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as stream:
            lines = stream.readlines()
        kept = []
        index = 0
        changed = False
        while index < len(lines):
            if lines[index].strip() != "server {":
                kept.append(lines[index])
                index += 1
                continue
            end = index
            depth = 0
            while end < len(lines):
                depth += lines[end].count("{") - lines[end].count("}")
                end += 1
                if depth == 0:
                    break
            block = "".join(lines[index:end])
            if "server_name  _;" in block and "root         /usr/share/nginx/html;" in block:
                changed = True
                index = end
            else:
                kept.extend(lines[index:end])
                index = end
        if changed:
            with open(path, "w", encoding="utf-8") as stream:
                stream.writelines(kept)
    except (OSError, UnicodeError):
        return


def ensure_stream_module():
    probe = subprocess.run(["nginx", "-V"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           universal_newlines=True)
    output = probe.stdout or ""
    if "--with-stream" not in output:
        raise RuntimeError("当前 Nginx 未启用 stream 模块，无法配置 TCP/UDP 端口转发，请重新安装节点 Agent")
    if "--with-stream=dynamic" not in output:
        return
    configured_paths = [
        "/etc/nginx/nginx.conf",
        *glob.glob("/usr/share/nginx/modules/*.conf"),
        *glob.glob("/etc/nginx/modules-enabled/*"),
        *glob.glob("/etc/nginx/modules/*.conf"),
    ]
    for path in configured_paths:
        try:
            with open(path, "r", encoding="utf-8") as stream:
                if re.search(r"(?m)^\s*load_module\s+[^;]*ngx_stream_module\.so[\"']?\s*;",
                             stream.read()):
                    return
        except (OSError, UnicodeError):
            continue
    config_probe = subprocess.run(["nginx", "-T"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  universal_newlines=True)
    if "ngx_stream_module.so" in (config_probe.stdout or ""):
        return
    candidates = [
        "/usr/lib/nginx/modules/ngx_stream_module.so",
        "/usr/lib64/nginx/modules/ngx_stream_module.so",
        "/usr/share/nginx/modules/ngx_stream_module.so",
    ]
    module_path = next((path for path in candidates if os.path.exists(path)), None)
    if not module_path and re.search(r"(?:^|\s)--with-stream(?:\s|$)", output):
        return
    if not module_path:
        raise RuntimeError("当前 Nginx 的 stream 模块未加载，请安装 nginx-mod-stream 或 libnginx-mod-stream 后重试")
    config_probe = subprocess.run(["nginx", "-T"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  universal_newlines=True)
    if "ngx_stream_module.so" in (config_probe.stdout or ""):
        return
    nginx_conf = "/etc/nginx/nginx.conf"
    content = open(nginx_conf, "r", encoding="utf-8").read()
    load_line = "load_module %s;" % module_path
    if load_line not in content:
        with open(nginx_conf, "w", encoding="utf-8") as stream:
            stream.write(load_line + "\n" + content)


def install_stream_base_config():
    ensure_stream_module()
    nginx_conf = "/etc/nginx/nginx.conf"
    old_nginx_conf = open(nginx_conf, "r", encoding="utf-8").read()
    include_line = "include /etc/nginx/kuocai-edge-stream-base.conf;"
    if include_line not in old_nginx_conf:
        match = re.search(r"(?m)^\s*events\s*\{", old_nginx_conf)
        if not match:
            raise RuntimeError("无法定位 Nginx events 配置块")
        updated = old_nginx_conf[:match.start()] + include_line + "\n" + old_nginx_conf[match.start():]
        with open(nginx_conf, "w", encoding="utf-8") as stream:
            stream.write(updated)
    base_path = "/etc/nginx/kuocai-edge-stream-base.conf"
    base_content = """stream {
    log_format kuocai_edge_stream '$msec $server_port $protocol $bytes_sent $bytes_received $status';
    include /etc/nginx/kuocai-edge-stream/*.conf;
}
"""
    if not os.path.exists(base_path) or open(base_path, "r", encoding="utf-8").read() != base_content:
        with open(base_path, "w", encoding="utf-8") as stream:
            stream.write(base_content)
    return nginx_conf, old_nginx_conf


def restore_stream_base_config(snapshot):
    if not snapshot:
        return
    path, content = snapshot
    with open(path, "w", encoding="utf-8") as stream:
        stream.write(content)


def reload_nginx():
    result = subprocess.run(["nginx", "-s", "reload"], stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, universal_newlines=True)
    if result.returncode != 0:
        raise RuntimeError("nginx reload failed: %s" % ((result.stdout or "").strip() or result.returncode))


def compact_nginx_error(output):
    return re.sub(r"\s+", " ", str(output or "")).strip()[:260]


def failed_domain_filename(output, domain_files):
    output = str(output or "")
    return next((filename for filename in domain_files if filename in output), None)


def nginx_worker_pids():
    try:
        output = subprocess.check_output(
            ["ps", "-eo", "pid=,args="], universal_newlines=True)
    except (OSError, subprocess.CalledProcessError):
        return set()
    workers = set()
    for line in output.splitlines():
        fields = line.strip().split(None, 1)
        if len(fields) != 2 or fields[1].strip() != "nginx: worker process":
            continue
        try:
            workers.add(int(fields[0]))
        except ValueError:
            pass
    return workers


def retire_previous_nginx_workers(worker_pids):
    for pid in worker_pids or set():
        try:
            os.kill(int(pid), signal.SIGQUIT)
        except (OSError, TypeError, ValueError):
            pass


def apply_config(config, desired):
    version = int(desired.get("version") or 0)
    cache_policy = normalize_cache_policy(desired.get("cachePolicy"))
    cache_zone = cache_zone_name(cache_policy["directory"])
    warnings = {}
    release_dir = os.path.join(RELEASE_ROOT, str(version))
    if os.path.exists(release_dir):
        shutil.rmtree(release_dir)
    http_release_dir = os.path.join(release_dir, "http")
    stream_release_dir = os.path.join(release_dir, "stream")
    os.makedirs(http_release_dir, mode=0o700)
    os.makedirs(stream_release_dir, mode=0o700)
    domain_files = {}
    for domain in desired.get("domains") or []:
        domain_name = str(domain.get("domainName") or "unknown")
        try:
            filename = safe_name(domain_name) + ".conf"
            write_domain_config(http_release_dir, domain, cache_zone)
            domain_files[filename] = domain_name
        except Exception as error:
            warnings[domain_name] = "domain %s was skipped because its configuration is invalid: %s" % (
                domain_name, compact_nginx_error(error))
    port_forwards = desired.get("portForwards") or []
    for rule in port_forwards:
        write_port_forward_config(stream_release_dir, rule)
    needs_stream = bool(port_forwards) or os.path.lexists(STREAM_ACTIVE_LINK)
    base_snapshot = None
    stream_snapshot = None
    old_target = os.path.realpath(ACTIVE_LINK) if os.path.islink(ACTIVE_LINK) else None
    old_stream_target = os.path.realpath(STREAM_ACTIVE_LINK) if os.path.islink(STREAM_ACTIVE_LINK) else None
    temp_link = ACTIVE_LINK + ".new"
    temp_stream_link = STREAM_ACTIVE_LINK + ".new"
    try:
        base_snapshot = install_base_config(cache_policy)
        if needs_stream:
            stream_snapshot = install_stream_base_config()
        if os.path.lexists(temp_link):
            os.unlink(temp_link)
        if os.path.lexists(temp_stream_link):
            os.unlink(temp_stream_link)
        os.symlink(http_release_dir, temp_link)
        os.replace(temp_link, ACTIVE_LINK)
        if needs_stream:
            os.symlink(stream_release_dir, temp_stream_link)
            os.replace(temp_stream_link, STREAM_ACTIVE_LINK)
        fallback_attempted = set()
        while True:
            test = subprocess.run(["nginx", "-t"], stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, universal_newlines=True)
            if test.returncode == 0:
                break
            test_error = (test.stderr or test.stdout).strip()
            failed_filename = failed_domain_filename(test_error, domain_files)
            if not failed_filename:
                raise RuntimeError(test_error)
            failed_domain = domain_files[failed_filename]
            current_path = os.path.join(http_release_dir, failed_filename)
            previous_path = os.path.join(old_target, failed_filename) if old_target else None
            if (failed_filename not in fallback_attempted and previous_path
                    and os.path.isfile(previous_path)):
                shutil.copy2(previous_path, current_path)
                fallback_attempted.add(failed_filename)
                warnings[failed_domain] = (
                    "domain %s kept its previous configuration after validation failed: %s"
                    % (failed_domain, compact_nginx_error(test_error)))
                continue
            if os.path.exists(current_path):
                os.unlink(current_path)
            warnings[failed_domain] = (
                "domain %s was quarantined after validation failed: %s"
                % (failed_domain, compact_nginx_error(test_error)))
        previous_workers = nginx_worker_pids()
        reload_nginx()
        retire_previous_nginx_workers(previous_workers)
        save_active_cache_policy(cache_policy)
    except Exception:
        if old_target:
            rollback_link = ACTIVE_LINK + ".rollback"
            if os.path.lexists(rollback_link):
                os.unlink(rollback_link)
            os.symlink(old_target, rollback_link)
            os.replace(rollback_link, ACTIVE_LINK)
        if needs_stream:
            if old_stream_target:
                rollback_stream_link = STREAM_ACTIVE_LINK + ".rollback"
                if os.path.lexists(rollback_stream_link):
                    os.unlink(rollback_stream_link)
                os.symlink(old_stream_target, rollback_stream_link)
                os.replace(rollback_stream_link, STREAM_ACTIVE_LINK)
            elif os.path.lexists(STREAM_ACTIVE_LINK):
                os.unlink(STREAM_ACTIVE_LINK)
        restore_stream_base_config(stream_snapshot)
        restore_base_config(base_snapshot)
        if stream_snapshot or base_snapshot:
            try:
                reload_nginx()
            except Exception:
                pass
        raise
    warning_text = "; ".join(warnings.values())[:900]
    api_request(config, "POST", "/api/self-hosted/agent/apply-result", {
        "version": version, "success": True, "error": warning_text
    })
    return version, warning_text


def read_percent(path, index):
    try:
        output = shutil.disk_usage(path)
        return round(output.used * 100.0 / output.total, 2)
    except Exception:
        return 0


def memory_percent():
    values = {}
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as stream:
            for line in stream:
                key, value = line.split(":", 1)
                values[key] = int(value.strip().split()[0])
        total = values.get("MemTotal", 0)
        available = values.get("MemAvailable", 0)
        return round((total - available) * 100.0 / total, 2) if total else 0
    except Exception:
        return 0


def cpu_percent():
    global _CPU_SAMPLE
    try:
        with open("/proc/stat", "r", encoding="utf-8") as stream:
            fields = [int(value) for value in stream.readline().split()[1:]]
        if len(fields) < 4:
            return 0
        idle = fields[3] + (fields[4] if len(fields) > 4 else 0)
        total = sum(fields)
        previous = _CPU_SAMPLE
        _CPU_SAMPLE = (total, idle)
        if previous is None or total <= previous[0]:
            return 0
        total_delta = total - previous[0]
        idle_delta = max(0, idle - previous[1])
        return round(max(0.0, min(100.0, (total_delta - idle_delta) * 100.0 / total_delta)), 2)
    except Exception:
        return 0


def default_route_interfaces():
    interfaces = set()
    try:
        with open("/proc/net/route", "r", encoding="utf-8") as stream:
            for line in stream.readlines()[1:]:
                fields = line.split()
                if len(fields) > 3 and fields[1] == "00000000" and int(fields[3], 16) & 2:
                    interfaces.add(fields[0])
    except Exception:
        pass
    return interfaces


def network_bytes():
    rx = tx = 0
    try:
        default_interfaces = default_route_interfaces()
        with open("/proc/net/dev", "r", encoding="utf-8") as stream:
            for line in stream.readlines()[2:]:
                interface, data = line.split(":", 1)
                interface = interface.strip()
                if interface == "lo" or (default_interfaces and interface not in default_interfaces):
                    continue
                fields = data.split()
                rx += int(fields[0])
                tx += int(fields[8])
    except Exception:
        pass
    return rx, tx


def cache_size_bytes(cache_dir):
    total = 0
    try:
        for root, _, files in os.walk(cache_dir):
            for name in files:
                try:
                    total += os.path.getsize(os.path.join(root, name))
                except OSError:
                    pass
    except Exception:
        return 0
    return total


def open_cache_access_db():
    os.makedirs(os.path.dirname(CACHE_ACCESS_DB), mode=0o700, exist_ok=True)
    connection = sqlite3.connect(CACHE_ACCESS_DB, timeout=10)
    connection.execute("CREATE TABLE IF NOT EXISTS access_daily ("
                       "uri TEXT NOT NULL, day INTEGER NOT NULL, hits INTEGER NOT NULL DEFAULT 0,"
                       "PRIMARY KEY (uri, day))")
    connection.execute("CREATE TABLE IF NOT EXISTS state ("
                       "name TEXT PRIMARY KEY, value TEXT NOT NULL)")
    return connection


def access_state(connection, name):
    row = connection.execute("SELECT value FROM state WHERE name=?", (name,)).fetchone()
    return row[0] if row else None


def set_access_state(connection, name, value):
    connection.execute("INSERT OR REPLACE INTO state(name,value) VALUES(?,?)",
                       (name, str(value)))


def record_cache_accesses():
    connection = open_cache_access_db()
    try:
        if not os.path.exists(CACHE_ACCESS_LOG):
            return
        stat = os.stat(CACHE_ACCESS_LOG)
        stored_inode = access_state(connection, "access_inode")
        stored_offset = access_state(connection, "access_offset")
        if stored_inode is None or stored_offset is None:
            set_access_state(connection, "access_inode", stat.st_ino)
            set_access_state(connection, "access_offset", stat.st_size)
            connection.commit()
            return
        offset = int(stored_offset)
        if str(stat.st_ino) != str(stored_inode) or stat.st_size < offset:
            offset = 0
        counts = {}
        with open(CACHE_ACCESS_LOG, "rb") as stream:
            stream.seek(offset)
            for raw_line in stream:
                line = raw_line.decode("utf-8", errors="replace")
                fields = line.rstrip("\r\n").split("|", 7)
                if len(fields) != 8 or fields[6] not in {
                        "HIT", "MISS", "EXPIRED", "STALE", "UPDATING", "REVALIDATED"}:
                    continue
                uri = fields[3]
                if not uri.startswith("/") or len(uri) > 8192:
                    continue
                try:
                    day = int(float(fields[0]) // 86400)
                except (TypeError, ValueError):
                    day = int(time.time() // 86400)
                keys = {uri, uri.split("?", 1)[0]}
                for key in keys:
                    counts[(key, day)] = counts.get((key, day), 0) + 1
            offset = stream.tell()
        for (uri, day), hits in counts.items():
            connection.execute("INSERT OR IGNORE INTO access_daily(uri,day,hits) VALUES(?,?,0)",
                               (uri, day))
            connection.execute("UPDATE access_daily SET hits=hits+? WHERE uri=? AND day=?",
                               (hits, uri, day))
        current_day = int(time.time() // 86400)
        connection.execute("DELETE FROM access_daily WHERE day < ?", (current_day - 3651,))
        set_access_state(connection, "access_inode", stat.st_ino)
        set_access_state(connection, "access_offset", offset)
        connection.commit()
    finally:
        connection.close()


def cache_file_key(path):
    try:
        with open(path, "rb") as stream:
            header = stream.read(65536)
        marker = b"\nKEY: "
        start = header.find(marker)
        if start < 0:
            return None
        start += len(marker)
        end = header.find(b"\n", start)
        if end < 0:
            return None
        return header[start:end].decode("utf-8", errors="replace")
    except (OSError, ValueError):
        return None


def cache_key_uri(cache_key):
    if not cache_key:
        return None
    index = cache_key.find("/")
    if index < 0:
        return None
    uri = cache_key[index:]
    return uri if len(uri) <= 8192 else None


def recent_cache_access_counts(age_days):
    connection = open_cache_access_db()
    try:
        cutoff_day = int((time.time() - age_days * 86400) // 86400)
        rows = connection.execute(
            "SELECT uri,SUM(hits) FROM access_daily WHERE day>=? GROUP BY uri",
            (cutoff_day,)).fetchall()
        return {row[0]: int(row[1] or 0) for row in rows}
    finally:
        connection.close()


def cleanup_low_frequency_cache(policy, now=None):
    now = int(now or time.time())
    age_seconds = int(policy["cleanupAgeDays"]) * 86400
    if now - int(policy.get("trackingStartedAt") or now) < age_seconds:
        return {"deletedFiles": 0, "freedBytes": 0, "scannedFiles": 0}
    cache_dir = policy["directory"]
    if not os.path.isdir(cache_dir):
        return {"deletedFiles": 0, "freedBytes": 0, "scannedFiles": 0}
    counts = recent_cache_access_counts(int(policy["cleanupAgeDays"]))
    cutoff = now - age_seconds
    deleted = freed = scanned = 0
    stop = False
    for root, _, files in os.walk(cache_dir):
        for name in files:
            path = os.path.join(root, name)
            scanned += 1
            if scanned > 50000:
                stop = True
                break
            try:
                file_stat = os.stat(path, follow_symlinks=False)
                if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_mtime > cutoff:
                    continue
                uri = cache_key_uri(cache_file_key(path))
                if not uri:
                    continue
                hits = max(counts.get(uri, 0), counts.get(uri.split("?", 1)[0], 0))
                if hits >= int(policy["cleanupMinHits"]):
                    continue
                os.unlink(path)
                deleted += 1
                freed += max(0, int(file_stat.st_size))
                if deleted >= 10000:
                    stop = True
                    break
            except OSError:
                continue
        if stop:
            break
    return {"deletedFiles": deleted, "freedBytes": freed, "scannedFiles": scanned}


def maybe_cleanup_cache(policy):
    global _LAST_CACHE_CLEANUP
    now = int(time.time())
    if now - _LAST_CACHE_CLEANUP < CACHE_CLEANUP_INTERVAL_SECONDS:
        return
    _LAST_CACHE_CLEANUP = now
    record_cache_accesses()
    if policy.get("cleanupEnabled"):
        cleanup_low_frequency_cache(policy, now)


def normalize_statistics_host(value):
    host = str(value or "").strip().lower().rstrip(".")
    if host.startswith("[") and "]" in host:
        host = host[1:host.index("]")]
    elif host.count(":") == 1:
        host = host.rsplit(":", 1)[0]
    if (not host or len(host) > 253 or any(ch.isspace() or ch in "/|" for ch in host)):
        return None
    return host


def statistics_status_family(value):
    try:
        family = int(value) // 100
        return family if family in {2, 3, 4, 5} else None
    except (TypeError, ValueError):
        return None


def parse_statistics_line(line):
    fields = line.rstrip("\r\n").split("|")
    if len(fields) < 8:
        return None
    # Agent 1.5 adds upstream_status as the ninth field. Read indexes from the
    # end so historical eight-field rows remain importable after an upgrade.
    has_upstream_status = len(fields) >= 9 and statistics_status_family(fields[-5]) is not None
    if has_upstream_status:
        status_value, bytes_value, cache_value, duration_value, upstream_value = fields[-5:]
    else:
        status_value, bytes_value, cache_value, duration_value = fields[-4:]
        upstream_value = ""
    try:
        timestamp = float(fields[0])
        body_bytes = max(0, int(bytes_value))
        duration = max(0.001, float(duration_value))
        status = int(status_value)
    except (TypeError, ValueError):
        return None
    host = normalize_statistics_host(fields[2])
    if not host:
        return None
    cache_status = str(cache_value or "").upper()
    hit = cache_status in {"HIT", "STALE", "UPDATING", "REVALIDATED"}
    origin = cache_status in {"MISS", "BYPASS", "EXPIRED"}
    upstream_matches = re.findall(r"(?<!\d)([2-5]\d\d)(?!\d)", str(upstream_value or ""))
    origin_status = int(upstream_matches[-1]) if upstream_matches else status
    bandwidth = min(int(body_bytes * 8 / duration), MAX_REPORTED_BYTES)
    bucket_start = int(timestamp // 300 * 300) * 1000
    return {
        "domainName": host,
        "bucketStart": bucket_start,
        "edgeBytes": body_bytes,
        "originBytes": body_bytes if origin else 0,
        "hitBytes": body_bytes if hit else 0,
        "peakBandwidthBps": bandwidth,
        "peakOriginBandwidthBps": bandwidth if origin else 0,
        "requestCount": 1,
        "hitCount": 1 if hit else 0,
        "originRequestCount": 1 if origin else 0,
        "originFailureCount": 1 if origin and status >= 500 else 0,
        "status%dxx" % (status // 100): 1 if statistics_status_family(status) else 0,
        "originStatus%dxx" % (origin_status // 100): 1
            if origin and statistics_status_family(origin_status) else 0,
    }


def merge_statistics_metric(result, metric):
    key = (metric["domainName"], metric["bucketStart"])
    current = result.setdefault(key, {
        "domainName": metric["domainName"], "bucketStart": metric["bucketStart"],
        "edgeBytes": 0, "originBytes": 0, "hitBytes": 0,
        "peakBandwidthBps": 0, "peakOriginBandwidthBps": 0,
        "requestCount": 0, "hitCount": 0, "originRequestCount": 0,
        "originFailureCount": 0,
        "status2xx": 0, "status3xx": 0, "status4xx": 0, "status5xx": 0,
        "originStatus2xx": 0, "originStatus3xx": 0,
        "originStatus4xx": 0, "originStatus5xx": 0,
    })
    for name in ("edgeBytes", "originBytes", "hitBytes", "requestCount", "hitCount",
                 "originRequestCount", "originFailureCount", "status2xx", "status3xx",
                 "status4xx", "status5xx", "originStatus2xx", "originStatus3xx",
                 "originStatus4xx", "originStatus5xx"):
        current[name] += int(metric.get(name) or 0)
    current["peakBandwidthBps"] = max(current["peakBandwidthBps"],
                                        int(metric.get("peakBandwidthBps") or 0))
    current["peakOriginBandwidthBps"] = max(current["peakOriginBandwidthBps"],
                                              int(metric.get("peakOriginBandwidthBps") or 0))


def prepare_statistics_batch():
    if not os.path.exists(CACHE_ACCESS_LOG):
        return None
    connection = open_cache_access_db()
    try:
        file_stat = os.stat(CACHE_ACCESS_LOG)
        stored_inode = access_state(connection, "statistics_inode")
        stored_offset = access_state(connection, "statistics_offset")
        start_offset = int(stored_offset or 0)
        if str(file_stat.st_ino) != str(stored_inode or "") or file_stat.st_size < start_offset:
            start_offset = 0
        with open(CACHE_ACCESS_LOG, "rb") as stream:
            stream.seek(start_offset)
            data = stream.read(STATISTICS_READ_LIMIT)
        if not data:
            return None
        last_newline = data.rfind(b"\n")
        if last_newline < 0:
            return None
        data = data[:last_newline + 1]
        end_offset = start_offset + len(data)
        metrics = {}
        for raw_line in data.splitlines():
            metric = parse_statistics_line(raw_line.decode("utf-8", errors="replace"))
            if metric:
                merge_statistics_metric(metrics, metric)
        batch_id = hashlib.sha256(("%s:%s:%s" %
                                   (file_stat.st_ino, start_offset, end_offset)).encode("ascii")).hexdigest()
        return {
            "batchId": batch_id,
            "metrics": list(metrics.values()),
            "_inode": file_stat.st_ino,
            "_offset": end_offset,
        }
    finally:
        connection.close()


def commit_statistics_batch(batch):
    connection = open_cache_access_db()
    try:
        set_access_state(connection, "statistics_inode", batch["_inode"])
        set_access_state(connection, "statistics_offset", batch["_offset"])
        connection.commit()
    finally:
        connection.close()


def report_statistics(config):
    batch = prepare_statistics_batch()
    if not batch:
        return
    api_request(config, "POST", "/api/self-hosted/agent/statistics", {
        "batchId": batch["batchId"],
        "metrics": batch["metrics"],
    })
    commit_statistics_batch(batch)


def heartbeat(config, applied, last_error):
    rx, tx = network_bytes()
    cache_policy = load_active_cache_policy()
    cache_dir = cache_policy["directory"]
    return api_request(config, "POST", "/api/self-hosted/agent/heartbeat", {
        "agentVersion": AGENT_VERSION,
        "appliedConfigVersion": applied,
        "cpuUsage": cpu_percent(),
        "memoryUsage": memory_percent(),
        "diskUsage": read_percent(cache_policy["diskMount"], 0),
        "rxBytes": rx,
        "txBytes": tx,
        "cacheBytes": cache_size_bytes(cache_dir),
        "disks": detected_disks(),
        "lastError": last_error,
    })


def process_cache_jobs(config, jobs):
    cache_dir = load_active_cache_policy()["directory"]
    for job in jobs or []:
        task_id = job.get("taskId")
        try:
            if job.get("operation") == "refresh":
                subprocess.check_call(["find", cache_dir, "-mindepth", "1", "-delete"])
            else:
                for target in job.get("targets") or []:
                    parsed = urllib.parse.urlsplit(target)
                    if not parsed.hostname:
                        raise ValueError("invalid preheat URL")
                    port = parsed.port or (443 if parsed.scheme == "https" else 80)
                    command = ["curl", "-fsS", "--max-time", "30", "-o", "/dev/null",
                               "--resolve", "%s:%d:127.0.0.1" % (parsed.hostname, port)]
                    if parsed.scheme == "https":
                        command.append("-k")
                    command.append(target)
                    subprocess.check_call(command)
            api_request(config, "POST", "/api/self-hosted/agent/cache-result", {
                "taskId": task_id, "success": True, "error": ""
            })
        except Exception as error:
            api_request(config, "POST", "/api/self-hosted/agent/cache-result", {
                "taskId": task_id, "success": False, "error": str(error)[:900]
            })


def main():
    config = load_agent_config()
    os.makedirs(RELEASE_ROOT, exist_ok=True)
    applied = 0
    last_error = ""
    config_warning = ""
    while True:
        try:
            response = heartbeat(config, applied, last_error)
            desired_version = int(response.get("desiredConfigVersion") or 0)
            if desired_version != applied:
                desired = api_request(config, "GET", "/api/self-hosted/agent/config")
                applied, config_warning = apply_config(config, desired)
            process_cache_jobs(config, response.get("cacheJobs"))
            report_statistics(config)
            maybe_cleanup_cache(load_active_cache_policy())
            last_error = config_warning
        except Exception as error:
            last_error = str(error)[:900]
            try:
                api_request(config, "POST", "/api/self-hosted/agent/apply-result", {
                    "version": applied, "success": False, "error": last_error
                })
            except Exception:
                pass
        time.sleep(max(10, int(config.get("pollIntervalSeconds", 30))))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--version":
        print(AGENT_VERSION)
    else:
        main()
