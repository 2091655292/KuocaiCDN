<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">容灾切换策略</span>
          <div class="actions">
            <n-button type="primary" @click="$router.push('/dm-tasks/add')">
              <template #icon><n-icon :component="AddOutline" /></template>
              添加策略
            </n-button>
            <n-dropdown trigger="click" :options="batchOptions" @select="onBatch">
              <n-button>批量操作<template #icon><n-icon :component="ChevronDownOutline" /></template></n-button>
            </n-dropdown>
          </div>
        </div>
      </template>

      <n-space style="margin-bottom: 16px">
        <n-select v-model:value="searchType" :options="searchTypeOptions" style="width: 140px" />
        <n-input v-model:value="kw" placeholder="关键词" style="width: 200px" @keyup.enter="search" />
        <n-select v-model:value="status" :options="statusOptions" clearable placeholder="健康状况" style="width: 130px" />
        <n-button type="primary" @click="search"><template #icon><n-icon :component="SearchOutline" /></template>搜索</n-button>
        <n-button @click="clearSearch"><template #icon><n-icon :component="RefreshOutline" /></template>刷新</n-button>
      </n-space>

      <n-data-table
        :columns="columns"
        :data="tasks"
        :loading="loading"
        :pagination="pagination"
        :row-key="(row: any) => row.id"
        :checked-row-keys="checkedRowKeys"
        :bordered="false"
        @update:checked-row-keys="onCheckedRowKeys"
      />
      <n-empty class="list-empty" v-if="!loading && !tasks.length" description="暂无容灾切换策略" />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline, SearchOutline, RefreshOutline, ChevronDownOutline } from '@vicons/ionicons5';
import { api } from '../api';

const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const tasks = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const checkedRowKeys = ref<number[]>([]);

const searchType = ref(1);
const kw = ref('');
const status = ref<number | null>(null);

const searchTypeOptions = [
  { label: '域名', value: 1 },
  { label: '解析记录ID', value: 2 },
  { label: '解析记录', value: 3 },
  { label: '备用解析记录', value: 4 },
  { label: '备注', value: 5 },
];
const statusOptions = [
  { label: '正常', value: 0 },
  { label: '异常', value: 1 },
];

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

const typeMap: Record<number, string> = { 0: '无操作', 1: '暂停解析', 2: '切换备用', 3: '条件开启解析' };
const checktypeMap: Record<number, string> = { 0: 'PING', 1: 'TCP', 2: 'HTTP(S)' };

const columns: any[] = [
  { type: 'selection' },
  { title: 'ID', key: 'id', width: 60 },
  {
    title: '域名',
    key: 'rr',
    minWidth: 160,
    render(row: any) {
      const txt = row.rr + '.' + row.domain;
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => txt });
    },
  },
  { title: '解析记录', key: 'main_value', minWidth: 130, render: (row: any) => h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.main_value }) },
  {
    title: '切换设置',
    key: 'type',
    width: 130,
    render(row: any) {
      if (row.type === 2) return h(NTag, { size: 'small', bordered: false }, { default: () => '切换备用' });
      if (row.type === 1) return h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => '暂停解析' });
      if (row.type === 3) return h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => '条件开启' });
      return typeMap[row.type];
    },
  },
  { title: '检测', key: 'checktype', width: 80, render: (row: any) => checktypeMap[row.checktype] || row.checktype },
  { title: '间隔', key: 'frequency', width: 70, render: (row: any) => row.frequency + '秒' },
  {
    title: '健康状况',
    key: 'status',
    width: 90,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.status ? 'error' : 'success' }, { default: () => (row.status ? '异常' : '正常') });
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
  { title: '最后检测', key: 'checktimestr', width: 160 },
  {
    title: '操作',
    key: 'actions',
    width: 240,
    render(row: any) {
      const btns: any[] = [];
      btns.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => router.push('/dm-tasks/' + row.id) }, { default: () => '详情' }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => router.push('/dm-tasks/' + row.id + '/edit') }, { default: () => '编辑' }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => retry(row) }, { default: () => '重试' }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => toggleActive(row) }, { default: () => (row.active ? '停用' : '启用') }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => '删除' }));
      return h(NSpace, null, { default: () => btns });
    },
  },
];

async function loadTasks() {
  loading.value = true;
  const res = await api<any>('GET', '/dmonitor/tasks', {
    offset: (page.value - 1) * pageSize.value,
    limit: pageSize.value,
    type: searchType.value,
    kw: kw.value || undefined,
    status: status.value === null ? undefined : status.value,
  });
  if (res.code === 0) {
    tasks.value = res.data.list;
    total.value = res.data.total;
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

function onCheckedRowKeys(keys: number[]) {
  checkedRowKeys.value = keys;
}

const batchOptions = [
  { label: '开启运行', key: 'open' },
  { label: '停止运行', key: 'close' },
  { label: '立即重试', key: 'retry' },
  { label: '删除', key: 'delete' },
];

function onBatch(key: string) {
  const ids = checkedRowKeys.value;
  if (!ids.length) return message.warning('请先勾选要操作的策略');
  dialog.warning({
    title: '批量操作',
    content: '确定对选中的 ' + ids.length + ' 个策略执行该操作吗？',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('POST', '/dmonitor/tasks/batch', { act: key, ids });
      if (res.code === 0) message.success(res.msg);
      else message.error(res.msg);
      checkedRowKeys.value = [];
      loadTasks();
    },
  });
}

async function retry(row: any) {
  const res = await api('POST', '/dmonitor/tasks/batch', { act: 'retry', ids: [row.id] });
  if (res.code === 0) message.success('已设置立即重试');
  else message.error(res.msg);
  loadTasks();
}

async function toggleActive(row: any) {
  const res = await api('POST', `/dmonitor/tasks/${row.id}/active`, { active: row.active ? 0 : 1 });
  if (res.code === 0) message.success('操作成功');
  else message.error(res.msg);
  loadTasks();
}

function del(row: any) {
  dialog.warning({
    title: '删除策略',
    content: '确定删除该容灾切换策略吗？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('DELETE', `/dmonitor/tasks/${row.id}`);
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