<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">优选IP任务</span>
          <div class="actions">
            <n-button @click="$router.push('/optimize-settings')">
              <template #icon><n-icon :component="SettingsOutline" /></template>
              优选IP设置
            </n-button>
            <n-button type="primary" @click="$router.push('/optimize-tasks/add')">
              <template #icon><n-icon :component="AddOutline" /></template>
              添加任务
            </n-button>
          </div>
        </div>
      </template>

      <n-space style="margin-bottom: 16px">
        <n-select v-model:value="searchType" :options="searchTypeOptions" style="width: 120px" />
        <n-input v-model:value="kw" placeholder="关键词" style="width: 200px" @keyup.enter="search" />
        <n-select v-model:value="status" :options="statusOptions" clearable placeholder="状态" style="width: 120px" />
        <n-button type="primary" @click="search"><template #icon><n-icon :component="SearchOutline" /></template>搜索</n-button>
        <n-button @click="clearSearch"><template #icon><n-icon :component="RefreshOutline" /></template>刷新</n-button>
      </n-space>

      <n-data-table :columns="columns" :data="tasks" :loading="loading" :pagination="pagination" :row-key="(row: any) => row.id" :bordered="false" />
      <n-empty v-if="!loading && !tasks.length" description="暂无优选IP任务" />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline, SearchOutline, RefreshOutline, SettingsOutline } from '@vicons/ionicons5';
import { api } from '../api';

const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const tasks = ref<any[]>([]);
const page = ref(1);
const pageSize = ref(10);

const searchType = ref(1);
const kw = ref('');
const status = ref<number | null>(null);

const searchTypeOptions = [
  { label: '域名', value: 1 },
  { label: '备注', value: 2 },
];
const statusOptions = [
  { label: '等待执行', value: 0 },
  { label: '成功', value: 1 },
  { label: '失败', value: 2 },
];

const cdnTypeMap: Record<number, string> = { 1: 'CloudFlare', 2: 'CloudFront', 3: 'GCore', 4: 'EdgeOne' };
const typeMap: Record<number, string> = { 0: '电信/联通/移动', 1: '默认/联通/移动' };

const pagination = reactive({
  page: 1,
  pageSize: 10,
  itemCount: 0,
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  onChange: (p: number) => {
    page.value = p;
    loadTasks();
  },
  onUpdatePageSize: (s: number) => {
    pageSize.value = s;
    page.value = 1;
    loadTasks();
  },
});

const columns: any[] = [
  { title: 'ID', key: 'id', width: 60 },
  {
    title: '域名',
    key: 'rr',
    minWidth: 160,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.rr + '.' + row.domain });
    },
  },
  { title: 'CDN服务商', key: 'cdn_type', width: 110, render: (row: any) => cdnTypeMap[row.cdn_type] || row.cdn_type },
  { title: '线路类型', key: 'type', width: 130, render: (row: any) => typeMap[row.type] || row.type },
  { title: 'IP类型', key: 'ip_type', width: 80, render: (row: any) => String(row.ip_type).split(',').join('/') },
  { title: '数量', key: 'recordnum', width: 60 },
  { title: 'TTL', key: 'ttl', width: 70 },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render(row: any) {
      const map: any = { 0: ['等待执行', 'default'], 1: ['成功', 'success'], 2: ['失败', 'error'] };
      const [label, type] = map[row.status] || [row.status, 'default'];
      return h(NTag, { size: 'small', type }, { default: () => label });
    },
  },
  {
    title: '运行',
    key: 'active',
    width: 70,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.active ? 'success' : 'default', bordered: false }, { default: () => (row.active ? '运行中' : '已停止') });
    },
  },
  {
    title: '错误信息',
    key: 'errmsg',
    minWidth: 150,
    render(row: any) {
      return row.errmsg ? h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.errmsg }) : '-';
    },
  },
  { title: '更新时间', key: 'updatetime', width: 160 },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    render(row: any) {
      const btns: any[] = [];
      btns.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => run(row) }, { default: () => '立即执行' }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => router.push('/optimize-tasks/' + row.id + '/edit') }, { default: () => '编辑' }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => toggleActive(row) }, { default: () => (row.active ? '停用' : '启用') }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => '删除' }));
      return h(NSpace, null, { default: () => btns });
    },
  },
];

async function loadTasks() {
  loading.value = true;
  const res = await api<any>('GET', '/optimize/tasks', {
    offset: (page.value - 1) * pageSize.value,
    limit: pageSize.value,
    type: searchType.value,
    kw: kw.value || undefined,
    status: status.value === null ? undefined : status.value,
  });
  if (res.code === 0) {
    tasks.value = res.data.list;
    pagination.itemCount = res.data.total;
    pagination.page = page.value;
    pagination.pageSize = pageSize.value;
  }
  loading.value = false;
}

function search() {
  page.value = 1;
  loadTasks();
}
function clearSearch() {
  kw.value = '';
  status.value = null;
  searchType.value = 1;
  page.value = 1;
  loadTasks();
}

async function run(row: any) {
  message.loading('正在执行优选任务...');
  const res = await api('POST', `/optimize/tasks/${row.id}/run`, {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
  loadTasks();
}

async function toggleActive(row: any) {
  const res = await api('POST', `/optimize/tasks/${row.id}/active`, { active: row.active ? 0 : 1 });
  if (res.code === 0) message.success('操作成功');
  else message.error(res.msg);
  loadTasks();
}

function del(row: any) {
  dialog.warning({
    title: '删除任务',
    content: '确定删除该优选IP任务吗？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('DELETE', `/optimize/tasks/${row.id}`);
      if (res.code === 0) {
        message.success('删除成功');
        loadTasks();
      } else message.error(res.msg);
    },
  });
}

onMounted(loadTasks);
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.actions {
  display: flex;
  gap: 8px;
}
.title {
  font-size: 16px;
  font-weight: 600;
}
</style>