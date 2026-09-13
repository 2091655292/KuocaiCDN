<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">切换记录</span>
          <n-button @click="$router.push('/dm-tasks')">
            <template #icon><n-icon :component="ArrowBackOutline" /></template>
            返回
          </n-button>
        </div>
      </template>

      <n-descriptions v-if="task" bordered :column="2" size="small" style="margin-bottom: 16px">
        <n-descriptions-item label="域名">{{ task.rr }}.{{ task.domain || '' }}</n-descriptions-item>
        <n-descriptions-item label="解析记录">{{ task.main_value }}</n-descriptions-item>
        <n-descriptions-item label="切换设置">{{ typeLabel }}</n-descriptions-item>
        <n-descriptions-item label="检测协议">{{ checktypeLabel }}</n-descriptions-item>
        <n-descriptions-item label="当前状态">
          <n-tag :type="task.status ? 'error' : 'success'" size="small">{{ task.status ? '异常' : '正常' }}</n-tag>
        </n-descriptions-item>
        <n-descriptions-item label="运行状态">
          <n-tag :type="task.active ? 'success' : 'default'" size="small" bordered>{{ task.active ? '运行中' : '已停止' }}</n-tag>
        </n-descriptions-item>
        <n-descriptions-item label="24H 告警次数">{{ task.fail_count }}</n-descriptions-item>
        <n-descriptions-item label="24H 切换次数">{{ task.switch_count }}</n-descriptions-item>
      </n-descriptions>

      <n-space style="margin-bottom: 16px">
        <n-select v-model:value="actionFilter" :options="actionOptions" style="width: 140px" @update:value="loadLogs" />
        <n-button @click="loadLogs"><template #icon><n-icon :component="RefreshOutline" /></template>刷新</n-button>
      </n-space>

      <n-data-table :columns="logColumns" :data="logs" :loading="loading" :pagination="pagination" :bordered="false" />
      <n-empty class="list-empty" v-if="!loading && !logs.length" description="暂无切换记录" />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMessage } from 'naive-ui';
import { NTag } from 'naive-ui';
import { ArrowBackOutline, RefreshOutline } from '@vicons/ionicons5';
import { api } from '../api';

const route = useRoute();
const router = useRouter();
const message = useMessage();

const task = ref<any>(null);
const logs = ref<any[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(10);
const actionFilter = ref(0);
const total = ref(0);

const typeMap: Record<number, string> = { 0: '无操作', 1: '暂停解析', 2: '切换备用 (备用:' + (task.value?.backup_value || '') + ')', 3: '条件开启解析' };
const checktypeMap: Record<number, string> = { 0: 'PING', 1: 'TCP', 2: 'HTTP(S)' };

const typeLabel = computed(() => {
  if (!task.value) return '';
  const t = task.value.type;
  if (t === 2) return '切换备用（备用：' + task.value.backup_value + '）';
  return typeMap[t] || t;
});
const checktypeLabel = computed(() => (task.value ? checktypeMap[task.value.checktype] || task.value.checktype : ''));

const actionOptions = [
  { label: '操作类型', value: 0 },
  { label: '发生异常', value: 1 },
  { label: '恢复正常', value: 2 },
];

function actionName(a: number): string {
  const t = task.value?.type;
  if (a === 1) {
    if (t === 2) return '切换备用解析记录';
    if (t === 3) return '开启解析';
    return '发生异常';
  }
  if (a === 2) {
    if (t === 2) return '恢复主解析记录';
    if (t === 3) return '暂停解析';
    return '恢复正常';
  }
  return '未知';
}

const logColumns = [
  { title: 'ID', key: 'id', width: 80 },
  {
    title: '操作类型',
    key: 'action',
    width: 160,
    render(row: any) {
      const isAlert = row.action === 1;
      return h(NTag, { size: 'small', type: isAlert ? 'error' : 'success' }, { default: () => actionName(row.action) });
    },
  },
  { title: '时间', key: 'date', width: 180 },
  { title: '异常原因', key: 'errmsg', render: (row: any) => row.errmsg || '-' },
];

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

async function loadInfo() {
  const id = Number(route.params.id);
  const res = await api<any>('GET', `/dmonitor/tasks/${id}`);
  if (res.code === 0) task.value = { ...res.data, domain: res.data.domain };
  else message.error(res.msg);
}

async function loadLogs() {
  const id = Number(route.params.id);
  loading.value = true;
  const res = await api<any>('GET', `/dmonitor/tasks/${id}/logs`, {
    offset: (page.value - 1) * pageSize.value,
    limit: pageSize.value,
    action: actionFilter.value,
  });
  if (res.code === 0) {
    logs.value = res.data.list;
    total.value = res.data.total;
    pagination.itemCount = res.data.total;
    pagination.page = page.value;
    pagination.pageSize = pageSize.value;
  }
  loading.value = false;
}

onMounted(() => {
  loadInfo();
  loadLogs();
});
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