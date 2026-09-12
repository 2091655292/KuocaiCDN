<template>
  <div>
    <n-grid :cols="isMobile ? 1 : 3" :x-gap="12" :y-gap="12">
      <n-grid-item>
        <n-card hoverable>
          <n-statistic label="域名数量" :value="stats.domains">
            <template #prefix><n-icon :component="ServerOutline" color="#3b6df0" /></template>
          </n-statistic>
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card hoverable>
          <n-statistic label="DNS 账户" :value="stats.accounts">
            <template #prefix><n-icon :component="LinkOutline" color="#18a058" /></template>
          </n-statistic>
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card hoverable>
          <n-statistic label="CDN 域名" :value="stats.cdnDomains">
            <template #prefix><n-icon :component="GlobeOutline" color="#f0a020" /></template>
          </n-statistic>
        </n-card>
      </n-grid-item>
    </n-grid>

    <n-card title="快速开始" class="quick-card">
      <n-space>
        <n-button type="primary" @click="$router.push('/dns-accounts')">添加 DNS 账户</n-button>
        <n-button type="primary" ghost @click="$router.push('/domains')">导入并管理域名</n-button>
        <n-button type="success" ghost @click="$router.push('/cdn-accounts')">添加 CDN 账户</n-button>
        <n-button @click="$router.push('/cdn-domains')">管理 CDN 加速域名</n-button>
      </n-space>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ServerOutline, LinkOutline, GlobeOutline } from '@vicons/ionicons5';
import { api } from '../api';

const isMobile = ref(window.innerWidth < 768);
const stats = ref({ domains: 0, accounts: 0, cdnDomains: 0 });

onMounted(async () => {
  const [d, a, c] = await Promise.all([
    api<any>('GET', '/domains').catch(() => ({ code: -1 })),
    api<any>('GET', '/dns/accounts').catch(() => ({ code: -1 })),
    api<any>('GET', '/cdn/domains').catch(() => ({ code: -1 })),
  ]);
  stats.value = {
    domains: d.code === 0 ? d.data.length : 0,
    accounts: a.code === 0 ? a.data.length : 0,
    cdnDomains: c.code === 0 ? c.data.length : 0,
  };
});
</script>

<style scoped>
.quick-card {
  margin-top: 16px;
}
</style>