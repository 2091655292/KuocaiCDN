<template>
  <div>
    <n-card :bordered="false" size="small">
      <div class="info-row">
        <n-button quaternary circle size="small" @click="$router.back()"><template #icon><n-icon :component="ArrowBackOutline" /></template></n-button>
        <span class="title">站点设置</span>
        <n-select
          v-model:value="selectedKey"
          :options="zoneOptions"
          placeholder="选择站点"
          style="width:320px;margin-left:8px"
          @update:value="onZoneSelect"
        />
      </div>
    </n-card>

    <n-empty v-if="!zoneOptions.length" description="暂无站点（仅接入到站点类型的加速域名后可用）" style="margin-top:24px" />

    <template v-if="selectedKey">
      <n-card :bordered="false" size="small" style="margin-top:12px">
        <template #header>
          <n-space align="center">
            <span class="title">{{ currentZone?.routename || '' }} · {{ currentZone?.name || '' }}</span>
            <n-tag size="small">站点 ID：{{ currentZone?.zone_id }}</n-tag>
            <n-tag size="small" type="info">{{ currentZone?.domain_count }} 个加速域名</n-tag>
          </n-space>
        </template>
        <div>
          <n-tag v-for="d in currentZone?.domains || []" :key="d" size="small" style="margin:0 4px 4px 0">{{ d }}</n-tag>
        </div>
      </n-card>

      <n-card title="站点全局配置" size="small" :bordered="false" style="margin-top:12px">
        <template #header-extra>
          <span style="color:#f60;font-size:12px">作用于站点下所有加速域名</span>
        </template>
        <n-form label-placement="left" label-width="130">
          <n-divider title-placement="left">HTTPS / TLS</n-divider>
          <n-form-item label="强制 HTTPS 跳转">
            <n-switch v-model:value="zone.forceSwitch" />
            <n-select v-model:value="zone.forceCode" :options="[{ label: '302', value: 302 }, { label: '301', value: 301 }]" style="width:90px;margin-left:8px" />
          </n-form-item>
          <n-form-item label="HTTP/2"><n-switch v-model:value="zone.http2" /></n-form-item>
          <n-form-item label="OCSP Stapling"><n-switch v-model:value="zone.ocsp" /></n-form-item>
          <n-form-item label="HSTS">
            <n-space>
              <n-switch v-model:value="zone.hstsSwitch" />
              <span>含子域</span><n-switch v-model:value="zone.hstsSub" size="small" />
              <span>Preload</span><n-switch v-model:value="zone.hstsPreload" size="small" />
              <span>MaxAge</span><n-input-number v-model:value="zone.hstsMaxage" :min="0" style="width:110px" />
            </n-space>
          </n-form-item>
          <n-form-item label="TLS 版本">
            <n-space>
              <n-checkbox v-model:checked="zone.tls12">TLS 1.2</n-checkbox>
              <n-checkbox v-model:checked="zone.tls13">TLS 1.3</n-checkbox>
            </n-space>
          </n-form-item>

          <n-divider title-placement="left">网络与协议</n-divider>
          <n-form-item label="HTTP/3（QUIC）"><n-switch v-model:value="zone.quic" /></n-form-item>
          <n-form-item label="回源 HTTP/2"><n-switch v-model:value="zone.upstreamHttp2" /></n-form-item>
          <n-form-item label="gRPC"><n-switch v-model:value="zone.grpc" /></n-form-item>
          <n-form-item label="WebSocket">
            <n-space>
              <n-switch v-model:value="zone.websocketSwitch" />
              <span>超时(s)</span><n-input-number v-model:value="zone.websocketTimeout" :min="1" style="width:80px" />
            </n-space>
          </n-form-item>

          <n-divider title-placement="left">缓存</n-divider>
          <n-form-item label="节点缓存模式">
            <n-space>
              <n-radio-group v-model:value="zone.cacheMode">
                <n-radio value="follow">遵循源站</n-radio>
                <n-radio value="custom">自定义时间</n-radio>
                <n-radio value="nocache">不缓存</n-radio>
              </n-radio-group>
              <n-input-number v-model:value="zone.cacheTime" :min="0" style="width:120px" placeholder="时间(秒)" />
            </n-space>
          </n-form-item>
          <n-form-item label="缓存预刷新"><n-switch v-model:value="zone.cachePrefresh" /></n-form-item>
          <n-form-item label="离线缓存"><n-switch v-model:value="zone.offlineCache" /></n-form-item>

          <n-divider title-placement="left">性能优化</n-divider>
          <n-form-item label="智能路由"><n-switch v-model:value="zone.smartRouting" /></n-form-item>
          <n-form-item label="内容压缩">
            <n-space>
              <n-switch v-model:value="zone.compression" />
              <n-checkbox v-model:checked="zone.compGzip">gzip</n-checkbox>
              <n-checkbox v-model:checked="zone.compBrotli">brotli</n-checkbox>
            </n-space>
          </n-form-item>

          <n-divider title-placement="left">其他</n-divider>
          <n-form-item label="IPv6 访问"><n-switch v-model:value="zone.ipv6" /></n-form-item>
          <n-form-item label="客户端 IP 头">
            <n-space>
              <n-switch v-model:value="zone.clientIpHeader" />
              <n-input v-model:value="zone.clientIpHeaderName" placeholder="Header 名，如 X-Real-IP" style="width:200px" />
            </n-space>
          </n-form-item>
          <n-form-item label="客户端 IP 地区头"><n-switch v-model:value="zone.clientIpCountry" /></n-form-item>
          <n-form-item label="上传大小限制">
            <n-space>
              <n-switch v-model:value="zone.postmax" />
              <n-input-number v-model:value="zone.postmaxSize" :min="0" style="width:160px" placeholder="最大(字节)" />
            </n-space>
          </n-form-item>
          <n-form-item label="中国大陆加速"><n-switch v-model:value="zone.accelerateMainland" /></n-form-item>

          <n-button type="primary" size="small" :loading="savingZone" @click="saveZone">保存站点配置</n-button>
        </n-form>
      </n-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { ArrowBackOutline } from '@vicons/ionicons5';
import { api } from '../api';

const message = useMessage();
const zoneOptions = ref<any[]>([]);
const zoneList = ref<any[]>([]);
const selectedKey = ref<string | null>(null);
const currentZone = computed(() => zoneList.value.find((z) => z.key === selectedKey.value));
const zoneSetting = ref<Record<string, any>>({});
const savingZone = ref(false);

const zone = reactive<any>({
  forceSwitch: false, forceCode: 302,
  http2: false, ocsp: false,
  hstsSwitch: false, hstsSub: false, hstsPreload: false, hstsMaxage: 0,
  tls12: true, tls13: true,
  quic: false, upstreamHttp2: false, grpc: false, websocketSwitch: false, websocketTimeout: 30,
  cacheMode: 'follow', cacheTime: 0, cachePrefresh: false, offlineCache: false,
  smartRouting: false, compression: false, compGzip: false, compBrotli: false,
  ipv6: false, clientIpHeader: false, clientIpHeaderName: '', clientIpCountry: false,
  postmax: true, postmaxSize: 838860800, accelerateMainland: false,
});

async function loadZones() {
  const res = await api<any>('GET', '/cdn/zones');
  if (res.code !== 0) {
    message.error(res.msg);
    return;
  }
  zoneList.value = (res.data || []).map((z: any) => ({ ...z, key: `${z.aid}:${z.zone_id}` }));
  zoneOptions.value = zoneList.value.map((z: any) => ({
    label: `${z.routename} · ${z.name}（${z.domain_count} 域名）`,
    value: z.key,
  }));
}

async function onZoneSelect(key: string) {
  const z = currentZone.value;
  if (!z) return;
  zoneSetting.value = {};
  const res = await api<any>('GET', '/cdn/zones/setting', { aid: z.aid, zone_id: z.zone_id });
  if (res.code === 0) {
    zoneSetting.value = res.data.zoneSetting || {};
    loadZone();
  } else {
    message.error(res.msg);
  }
}

function ov(key: string, sub: string, def: any): any {
  const o = zoneSetting.value?.[key];
  return o && o[sub] !== undefined && o[sub] !== '' && o[sub] !== null ? o[sub] : def;
}

function loadZone() {
  zone.forceSwitch = ov('ForceRedirectHTTPS', 'Switch', 'off') === 'on';
  zone.forceCode = Number(ov('ForceRedirectHTTPS', 'RedirectStatusCode', 302));
  zone.http2 = ov('HTTP2', 'Switch', 'off') === 'on';
  zone.ocsp = ov('OCSPStapling', 'Switch', 'off') === 'on';
  zone.hstsSwitch = ov('HSTS', 'Switch', 'off') === 'on';
  zone.hstsSub = ov('HSTS', 'IncludeSubDomains', 'off') === 'on';
  zone.hstsPreload = ov('HSTS', 'Preload', 'off') === 'on';
  zone.hstsMaxage = Number(ov('HSTS', 'Timeout', 0) || 0);
  const tlsv = zoneSetting.value?.TLSConfig?.Version || [];
  zone.tls12 = tlsv.includes('TLSv1.2');
  zone.tls13 = tlsv.includes('TLSv1.3');
  zone.quic = ov('QUIC', 'Switch', 'off') === 'on';
  zone.upstreamHttp2 = ov('UpstreamHTTP2', 'Switch', 'off') === 'on';
  zone.grpc = ov('Grpc', 'Switch', 'off') === 'on';
  zone.websocketSwitch = ov('WebSocket', 'Switch', 'off') === 'on';
  zone.websocketTimeout = Number(ov('WebSocket', 'Timeout', 30) || 30);
  const cache = zoneSetting.value?.Cache;
  if (cache?.NoCache?.Switch === 'on') zone.cacheMode = 'nocache';
  else if (cache?.CustomTime?.Switch === 'on') zone.cacheMode = 'custom';
  else zone.cacheMode = 'follow';
  zone.cacheTime = Number(cache?.CustomTime?.CacheTime || 0);
  zone.cachePrefresh = ov('CachePrefresh', 'Switch', 'off') === 'on';
  zone.offlineCache = ov('OfflineCache', 'Switch', 'off') === 'on';
  zone.smartRouting = ov('SmartRouting', 'Switch', 'off') === 'on';
  zone.compression = ov('Compression', 'Switch', 'off') === 'on';
  const algos = zoneSetting.value?.Compression?.Algorithms || [];
  zone.compGzip = algos.includes('gzip');
  zone.compBrotli = algos.includes('brotli');
  zone.ipv6 = ov('IPv6', 'Switch', 'off') === 'on';
  zone.clientIpHeader = ov('ClientIPHeader', 'Switch', 'off') === 'on';
  zone.clientIpHeaderName = ov('ClientIPHeader', 'HeaderName', '') || '';
  zone.clientIpCountry = ov('ClientIPCountry', 'Switch', 'off') === 'on';
  zone.postmax = ov('PostMaxSize', 'Switch', 'on') === 'on';
  zone.postmaxSize = Number(ov('PostMaxSize', 'MaxSize', 838860800) || 838860800);
  zone.accelerateMainland = ov('AccelerateMainland', 'Switch', 'off') === 'on';
}

async function saveZone() {
  const z = currentZone.value;
  if (!z) return;
  const tlsVersions: string[] = [];
  if (zone.tls12) tlsVersions.push('TLSv1.2');
  if (zone.tls13) tlsVersions.push('TLSv1.3');
  const algos: string[] = [];
  if (zone.compGzip) algos.push('gzip');
  if (zone.compBrotli) algos.push('brotli');
  const cfg: Record<string, any> = {
    ForceRedirectHTTPS: { Switch: zone.forceSwitch ? 'on' : 'off', RedirectStatusCode: zone.forceCode },
    HTTP2: { Switch: zone.http2 ? 'on' : 'off' },
    OCSPStapling: { Switch: zone.ocsp ? 'on' : 'off' },
    HSTS: { Switch: zone.hstsSwitch ? 'on' : 'off', IncludeSubDomains: zone.hstsSub ? 'on' : 'off', Preload: zone.hstsPreload ? 'on' : 'off', Timeout: Number(zone.hstsMaxage || 0) },
    TLSConfig: { Version: tlsVersions, CipherSuite: zoneSetting.value?.TLSConfig?.CipherSuite || 'general-v2023' },
    QUIC: { Switch: zone.quic ? 'on' : 'off' },
    UpstreamHTTP2: { Switch: zone.upstreamHttp2 ? 'on' : 'off' },
    Grpc: { Switch: zone.grpc ? 'on' : 'off' },
    WebSocket: { Switch: zone.websocketSwitch ? 'on' : 'off', Timeout: Number(zone.websocketTimeout || 30) },
    Cache: {
      FollowOrigin: { Switch: zone.cacheMode === 'follow' ? 'on' : 'off', DefaultCache: 'on', DefaultCacheStrategy: 'on', DefaultCacheTime: 0 },
      CustomTime: { Switch: zone.cacheMode === 'custom' ? 'on' : 'off', CacheTime: Number(zone.cacheTime || 0) },
      NoCache: { Switch: zone.cacheMode === 'nocache' ? 'on' : 'off' },
    },
    CachePrefresh: { Switch: zone.cachePrefresh ? 'on' : 'off', CacheTimePercent: Number(zoneSetting.value?.CachePrefresh?.CacheTimePercent || 90) },
    SmartRouting: { Switch: zone.smartRouting ? 'on' : 'off' },
    Compression: { Switch: zone.compression ? 'on' : 'off', Algorithms: algos },
    OfflineCache: { Switch: zone.offlineCache ? 'on' : 'off' },
    ClientIPHeader: { Switch: zone.clientIpHeader ? 'on' : 'off', HeaderName: zone.clientIpHeaderName || '' },
    ClientIPCountry: { Switch: zone.clientIpCountry ? 'on' : 'off', HeaderName: zoneSetting.value?.ClientIPCountry?.HeaderName || '' },
    PostMaxSize: { Switch: zone.postmax ? 'on' : 'off', MaxSize: Number(zone.postmaxSize || 0) },
    IPv6: { Switch: zone.ipv6 ? 'on' : 'off' },
    AccelerateMainland: { Switch: zone.accelerateMainland ? 'on' : 'off' },
  };
  savingZone.value = true;
  const res = await api('POST', '/cdn/zones/setting', { aid: z.aid, zone_id: z.zone_id, setting: cfg });
  savingZone.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    onZoneSelect(selectedKey.value!);
  } else message.error(res.msg);
}

onMounted(loadZones);
</script>

<style scoped>
.info-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.title {
  font-size: 16px;
  font-weight: 600;
}
</style>