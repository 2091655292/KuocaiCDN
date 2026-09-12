<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">定时切换策略</span>
          <n-button type="primary" @click="$router.push('/schedule-tasks/add')">
            <template #icon><n-icon :component="AddOutline" /></template>
            添加策略
          </n-button>
        </div>
      </template>

      <n-space style="margin-bottom: 16px">
        <n-select v-model:value="searchType" :options="searchTypeOptions" style="width: 130px" />
        <n-input v-model:value="kw" placeholder="关键词" style="width: 200px" @keyup.enter="search" />
        <n-select v-model:value="stype" :options="stypeOptions" clearable placeholder="执行方式" style="width: 130px" />
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
      <n-empty v-if="!loading && !tasks.length" description="暂无定时切换策略" />

      <n-space v-if="checkedRowKeys.length" style="margin-top: 12px">
        <n-button size="small" @click="batch('open')">开启运行</n-button>
        <n-button size="small" @click="batch('close')">停止运行</n-button>
        <n-button size="small" type="error" @click="batch('delete')">删除</n-button>
      </n-space>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline, SearchOutline, RefreshOutline } from '@vicons/ionicons5';
import { api } from '../api';

const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const tasks = ref<any[]>([]);
const page = ref(1);
const pageSize = ref(10);
const checkedRowKeys = ref<number[]>([]);

const searchType = ref(1);
const kw = ref('');
const stype = ref<number | null>(null);

const searchTypeOptions = [
  { label: '域名', value: 1 },
  { label: '解析记录ID', value: 2 },
  { label: '记录值', value: 3 },
  { label: '备注', value: 4 },
];
const stypeOptions = [
  { label: '单次执行', value: 0 },
  { label: '周期执行', value: 1 },
];

const switchtypeMap: Record<number, string> = { 0: '修改解析', 1: '启用解析', 2: '暂停解析', 3: '删除解析' };

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
  { type: 'selection' },
  { title: 'ID', key: 'id', width: 60 },
  {
    title: '域名',
    key: 'rr',
    minWidth: 160,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.rr + '.' + row.domain });
    },
  },
  { title: '执行方式', key: 'type', width: 90, render: (row: any) => (row.type === 1 ? '周期' : '单次') },
  {
    title: '切换设置',
    key: 'switchtype',
    width: 110,
    render(row: any) {
      const t = row.switchtype === 0 ? 'warning' : row.switchtype === 3 ? 'error' : 'default';
      return h(NTag, { size: 'small', type: t, bordered: false }, { default: () => switchtypeMap[row.switchtype] || row.switchtype });
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
  { title: '下次执行', key: 'nexttimestr', width: 160 },
  { title: '上次执行', key: 'updatetimestr', width: 160 },
  { title: '备注', key: 'remark', minWidth: 100, render: (row: any) => row.remark || '-' },
  {
    title: '操作',
    key: 'actions',
    width: 180,
    render(row: any) {
      const btns: any[] = [];
      btns.push(h(NButton, { size: 'tiny', onClick: () => router.push('/schedule-tasks/' + row.id + '/edit') }, { default: () => '编辑' }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => toggleActive(row) }, { default: () => (row.active ? '停用' : '启用') }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => '删除' }));
      return h(NSpace, null, { default: () => btns });
    },
  },
];

async function loadTasks() {
  loading.value = true;
  const res = await api<any>('GET', '/schedule/tasks', {
    offset: (page.value - 1) * pageSize.value,
    limit: pageSize.value,
    type: searchType.value,
    kw: kw.value || undefined,
    stype: stype.value === null ? undefined : stype.value,
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
  stype.value = null;
  searchType.value = 1;
  page.value = 1;
  loadTasks();
}
function onCheckedRowKeys(keys: number[]) {
  checkedRowKeys.value = keys;
}

function batch(act: string) {
  const ids = checkedRowKeys.value;
  if (!ids.length) return message.warning('请先勾选策略');
  dialog.warning({
    title: '批量操作',
    content: '确定对选中的 ' + ids.length + ' 个策略执行该操作吗？',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('POST', '/schedule/tasks/batch', { act, ids });
      if (res.code === 0) message.success(res.msg);
      else message.error(res.msg);
      checkedRowKeys.value = [];
      loadTasks();
    },
  });
}

async function toggleActive(row: any) {
  const res = await api('POST', `/schedule/tasks/${row.id}/active`, { active: row.active ? 0 : 1 });
  if (res.code === 0) message.success('操作成功');
  else message.error(res.msg);
  loadTasks();
}

function del(row: any) {
  dialog.warning({
    title: '删除策略',
    content: '确定删除该定时切换策略吗？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('DELETE', `/schedule/tasks/${row.id}`);
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
.title {
  font-size: 16px;
  font-weight: 600;
}
</style>