package com.kuocai.cdn.util;

import com.kuocai.cdn.entity.SelfHostedDomainConfig;
import lombok.extern.slf4j.Slf4j;

import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Detects the Alibaba Cloud ICP interception page at a self-hosted domain's public acceleration
 * endpoint. Alibaba can intercept the request before it reaches Nginx, so probing the origin
 * directly cannot reliably detect this condition.
 */
@Slf4j
public final class AliyunIcpComplianceProbe {

    public static final String USER_MESSAGE =
            "该域名目前未通过阿里云备案，请完成阿里云接入备案后再启用加速。";

    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int READ_TIMEOUT_MS = 5000;
    private static final int MAX_RESPONSE_BYTES = 128 * 1024;

    private AliyunIcpComplianceProbe() {
    }

    public static boolean isBlocked(SelfHostedDomainConfig config, String domainName) {
        if (config == null || Assert.isEmpty(domainName)) {
            return false;
        }
        String host = normalizeProbeHost(domainName);
        if (host == null) {
            return false;
        }
        try {
            ProbeResponse response = request(host, 80, host, false);
            return matches(response.statusCode, response.server, response.content);
        } catch (Exception e) {
            log.debug("Alibaba ICP acceleration probe skipped for {}: {}", domainName, e.getMessage());
            return false;
        }
    }

    static String normalizeProbeHost(String domainName) {
        if (Assert.isEmpty(domainName)) {
            return null;
        }
        String host = domainName.trim().toLowerCase(Locale.ROOT);
        while (host.endsWith(".")) {
            host = host.substring(0, host.length() - 1);
        }
        if (Assert.isEmpty(host) || host.startsWith("*.")
                || !host.matches("^[a-z0-9.-]{1,253}$")) {
            return null;
        }
        return host;
    }

    public static boolean matches(int statusCode, String server, String content) {
        if (statusCode != 403 || Assert.isEmpty(content)) {
            return false;
        }
        String normalized = content.toLowerCase(Locale.ROOT);
        boolean canonicalPage = normalized.contains("non-compliance icp filing")
                && normalized.contains("aliyun.com/beian/beian-block");
        boolean localizedPage = content.contains("域名暂时无法访问")
                && content.contains("备案")
                && (normalized.contains("aliyun") || String.valueOf(server).toLowerCase(Locale.ROOT).contains("beaver"));
        return canonicalPage || localizedPage;
    }

    public static boolean isBlockedReason(String value) {
        return USER_MESSAGE.equals(value);
    }

    private static ProbeResponse request(String address, int port, String host, boolean tls)
            throws Exception {
        Exception lastError = null;
        for (InetAddress target : InetAddress.getAllByName(address)) {
            if (!isPublicAddress(target)) {
                continue;
            }
            Socket socket = new Socket();
            try {
                socket.connect(new InetSocketAddress(target, port), CONNECT_TIMEOUT_MS);
                socket.setSoTimeout(READ_TIMEOUT_MS);
                if (tls) {
                    SSLSocketFactory sslSocketFactory =
                            (SSLSocketFactory) SSLSocketFactory.getDefault();
                    SSLSocket sslSocket = (SSLSocket) sslSocketFactory
                            .createSocket(socket, host, port, true);
                    SSLParameters parameters = sslSocket.getSSLParameters();
                    parameters.setServerNames(java.util.Collections.singletonList(new SNIHostName(host)));
                    sslSocket.setSSLParameters(parameters);
                    sslSocket.startHandshake();
                    socket = sslSocket;
                }
                return exchange(socket, host);
            } catch (Exception e) {
                lastError = e;
                try {
                    socket.close();
                } catch (Exception ignored) {
                }
            }
        }
        if (lastError != null) {
            throw lastError;
        }
        throw new IllegalArgumentException("origin has no public address");
    }

    private static ProbeResponse exchange(Socket socket, String host) throws Exception {
        try (Socket closeable = socket;
             OutputStream output = closeable.getOutputStream();
             InputStream input = closeable.getInputStream()) {
            String request = "GET / HTTP/1.1\r\n"
                    + "Host: " + host + "\r\n"
                    + "User-Agent: KuocaiCDN-ICP-Compliance-Probe/1.0\r\n"
                    + "Accept: text/html,application/xhtml+xml\r\n"
                    + "Accept-Encoding: identity\r\n"
                    + "Connection: close\r\n\r\n";
            output.write(request.getBytes(StandardCharsets.US_ASCII));
            output.flush();
            ByteArrayOutputStream response = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while (response.size() < MAX_RESPONSE_BYTES
                    && (read = input.read(buffer, 0,
                    Math.min(buffer.length, MAX_RESPONSE_BYTES - response.size()))) >= 0) {
                response.write(buffer, 0, read);
            }
            return parse(response.toByteArray());
        }
    }

    private static ProbeResponse parse(byte[] raw) {
        String value = new String(raw, StandardCharsets.UTF_8);
        int headerEnd = value.indexOf("\r\n\r\n");
        String headers = headerEnd >= 0 ? value.substring(0, headerEnd) : value;
        String content = headerEnd >= 0 ? value.substring(headerEnd + 4) : "";
        int status = 0;
        String server = "";
        String[] lines = headers.split("\r\n");
        if (lines.length > 0) {
            String[] statusParts = lines[0].split(" ");
            if (statusParts.length > 1) {
                try {
                    status = Integer.parseInt(statusParts[1]);
                } catch (NumberFormatException ignored) {
                }
            }
        }
        for (String line : lines) {
            if (line.toLowerCase(Locale.ROOT).startsWith("server:")) {
                server = line.substring("server:".length()).trim();
                break;
            }
        }
        return new ProbeResponse(status, server, content);
    }

    private static boolean isPublicAddress(InetAddress address) {
        if (address == null || address.isAnyLocalAddress() || address.isLoopbackAddress()
                || address.isLinkLocalAddress() || address.isSiteLocalAddress()
                || address.isMulticastAddress()) {
            return false;
        }
        if (address instanceof Inet6Address) {
            byte[] bytes = address.getAddress();
            return bytes.length != 16 || (bytes[0] & 0xfe) != 0xfc;
        }
        return true;
    }

    private static final class ProbeResponse {
        private final int statusCode;
        private final String server;
        private final String content;

        private ProbeResponse(int statusCode, String server, String content) {
            this.statusCode = statusCode;
            this.server = server;
            this.content = content;
        }
    }
}
