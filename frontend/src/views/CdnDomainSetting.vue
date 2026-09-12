<template>
  <div>
    <n-card :bordered="false" size="small">
      <div class="info-row">
        <n-button quaternary circle size="small" @click="$router.back()"><template #icon><n-icon :component="ArrowBackOutline" /></template></n-button>
        <span class="domain-name">{{ info?.name }}</span>
        <n-space>
          <n-tag size="small">{{ info?.routename || info?.route }}</n-tag>
          <n-tag size="small" :type="info?.status === 'offline' ? 'default' : 'success'">状态：{{ info?.status }}</n-tag>
        </n-space>
      </div>
      <div class="info-row" style="margin-top:6px">
        <span class="cname">CNAME：{{ info?.cname || '暂无' }}</span>
      </div>
    </n-card>

    <n-space vertical :size="12" style="margin-top:12px">
      <n-card title="域名状态" size="small" :bordered="false">
        <n-space>
          <n-button type="success" size="small" @click="setStatus('online')">启用</n-button>
          <n-button type="warning" size="small" @click="setStatus('offline')">停用</n-button>
        </n-space>
      </n-card>

      <n-card title="回源配置" size="small" :bordered="false">
        <n-form label-placement="left" label-width="90">
          <n-form-item label="源站地址">
            <n-input v-model:value="originForm.origin" placeholder="IP 或域名，多个用分号间隔" />
          </n-form-item>
          <n-form-item label="源站类型">
            <n-radio-group v-model:value="originForm.origin_type">
              <n-radio value="ipaddr">IP 源站</n-radio>
              <n-radio value="domain">域名源站</n-radio>
            </n-radio-group>
          </n-form-item>
          <n-form-item label="回源 Host">
            <n-input v-model:value="originForm.origin_host" placeholder="可留空" />
          </n-form-item>
          <n-form-item label="回源协议">
            <n-select v-model:value="originForm.origin_protocol" :options="protoOptions" style="width:200px" />
          </n-form-item>
          <n-form-item label="回源端口">
            <n-space>
              <n-input-number v-model:value="originForm.http_port" :min="1" style="width:120px" placeholder="HTTP" />
              <n-input-number v-model:value="originForm.https_port" :min="1" style="width:120px" placeholder="HTTPS" />
            </n-space>
          </n-form-item>
          <n-button type="primary" size="small" @click="saveOrigin">保存回源配置</n-button>
        </n-form>
      </n-card>

      </n-space>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useMessage } from 'naive-ui';
import { ArrowBackOutline } from '@vicons/ionicons5';
import { api } from '../api';

const route = useRoute();
const message = useMessage();
const domainId = Number(route.params.id);

const info = ref<any>(null);
const cacheRules = ref<any[]>([]);

const protoOptions = [
  { label: '跟随', value: 'follow' },
  { label: 'HTTP', value: 'http' },
  { label: 'HTTPS', value: 'https' },
];

const originForm = reactive<any>({ origin: '', origin_type: 'ipaddr', origin_host: '', origin_protocol: 'follow', http_port: 80, https_port: 443 });

async function load() {
  const res = await api<any>('GET', `/cdn/domains/${domainId}`);
  if (res.code !== 0) {
    message.error(res.msg);
    return;
  }
  const { info: _info, cacheRules: _rules } = res.data;
  info.value = _info;
  cacheRules.value = _rules || [];
  Object.assign(originForm, {
    origin: _info.origin || '',
    origin_type: _info.origin_type || 'ipaddr',
    origin_host: _info.origin_host || '',
    origin_protocol: _info.origin_protocol || 'follow',
    http_port: _info.http_port || 80,
    https_port: _info.https_port || 443,
  });
}

async function setStatus(status: string) {
  const res = await api('POST', `/cdn/domains/${domainId}/status`, { status });
  if (res.code === 0) {
    message.success(res.msg);
    load();
  } else message.error(res.msg);
}

async function saveOrigin() {
  if (!originForm.origin) return message.warning('源站不能为空');
  const res = await api('POST', `/cdn/domains/${domainId}/origin`, originForm);
  if (res.code === 0) {
    message.success(res.msg);
    load();
  } else message.error(res.msg);
}

onMounted(load);
</script>

<style scoped>
.info-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.domain-name {
  font-size: 16px;
  font-weight: 600;
}
.cname {
  color: #888;
  font-size: 13px;
}
</style>