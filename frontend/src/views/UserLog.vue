<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <span class="title">操作日志</span>
      </template>

      <n-space style="margin-bottom: 16px">
        <n-input v-if="isAdmin" v-model:value="uid" placeholder="UID" style="width: 120px" />
        <n-input v-model:value="domain" placeholder="域名" style="width: 180px" />
        <n-input v-model:value="kw" placeholder="操作类型/操作详情" style="width: 220px" @keyup.enter="search" />
        <n-button type="primary" @click="search"><template #icon><n-icon :component="SearchOutline" /></template>搜索</n-button>
        <n-button @click="clearSearch"><template #icon><n-icon :component="RefreshOutline" /></template>刷新</n-button>
      </n-space>

      <n-data-table :columns="columns" :data="logs" :loading="loading" :pagination="pagination" :row-key="(row: any) => row.id" :bordered="false" />
      <n-empty class="list-empty" v-if="!loading && !logs.length" description="暂无日志" />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { NTag, NEllipsis, useMessage } from 'naive-ui';
import { SearchOutline, RefreshOutline } from '@vicons/ionicons5';
import { api, getUser } from '../api';

const message = useMessage();
const loading = ref(false);
const logs = ref<any[]>([]);
const page = ref(1);
const pageSize = ref(10);
const uid = ref('');
const domain = ref('');
const kw = ref('');

const isAdmin = computed(() => (getUser()?.level || 0) >= 2);

const pagination = reactive({
  page: 1,
  pageSize: 10,
  itemCount: 0,
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  onChange: (p: number) => {
    page.value = p;
    loadLogs();
  },
  onUpdatePageSize: (s: number) => {
    pageSize.value = s;
    page.value = 1;
    loadLogs();
  },
});

const columns: any[] = [
  { title: 'ID', key: 'id', width: 70 },
  {
    title: 'UID',
    key: 'uid',
    width: 80,
    render(row: any) {
      return row.uid > 0 ? String(row.uid) : h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => '系统' });
    },
  },
  { title: '域名', key: 'domain', minWidth: 150, render: (row: any) => h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.domain || '-' }) },
  { title: '操作类型', key: 'action', width: 150 },
  { title: '操作详情', key: 'data', minWidth: 200, render: (row: any) => h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.data || '-' }) },
  { title: '时间', key: 'addtime', width: 170 },
];

async function loadLogs() {
  loading.value = true;
  const res = await api<any>('GET', '/logs', {
    offset: (page.value - 1) * pageSize.value,
    limit: pageSize.value,
    uid: uid.value || undefined,
    domain: domain.value || undefined,
    kw: kw.value || undefined,
  });
  if (res.code === 0) {
    logs.value = res.data.list;
    pagination.itemCount = res.data.total;
    pagination.page = page.value;
    pagination.pageSize = pageSize.value;
  } else message.error(res.msg);
  loading.value = false;
}

function search() {
  page.value = 1;
  loadLogs();
}
function clearSearch() {
  uid.value = '';
  domain.value = '';
  kw.value = '';
  page.value = 1;
  loadLogs();
}

onMounted(loadLogs);
</script>

<style scoped>
.title {
  font-size: 16px;
  font-weight: 600;
}
</style>