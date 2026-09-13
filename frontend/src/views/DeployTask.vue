<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">自动部署任务</span>
          <n-button type="primary" @click="openAdd">
            <template #icon><n-icon :component="AddOutline" /></template>
            添加任务
          </n-button>
        </div>
      </template>
      <n-data-table :columns="columns" :data="tasks" :loading="loading" :bordered="false" />
      <n-empty class="list-empty" v-if="!loading && !tasks.length" description="暂无部署任务" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? '编辑任务' : '添加部署任务'" style="max-width:640px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item label="部署账户">
          <n-select v-model:value="form.aid" :options="accountOptions" @update:value="onAccountChange" />
        </n-form-item>
        <n-form-item label="证书订单">
          <n-select v-model:value="form.oid" :options="orderOptions" filterable placeholder="选择已签发的证书订单" />
        </n-form-item>
        <n-form-item label="任务备注">
          <n-input v-model:value="form.remark" placeholder="选填" />
        </n-form-item>
        <template v-if="currentProvider">
          <n-alert v-if="currentProvider.tasknote" type="info" style="margin-bottom:12px" :show-icon="false">{{ currentProvider.tasknote }}</n-alert>
          <n-form-item v-for="(field, key) in currentProvider.taskinputs" v-show="fieldVisible(field.show, form.config)" :key="key" :label="field.name" :required="field.required">
            <n-input v-if="field.type === 'input'" v-model:value="form.config[key]" :placeholder="field.placeholder || field.name" />
            <n-input v-else-if="field.type === 'textarea'" v-model:value="form.config[key]" type="textarea" :rows="3" :placeholder="field.placeholder || field.name" />
            <n-radio-group v-else-if="field.type === 'radio'" v-model:value="form.config[key]">
              <n-radio v-for="(label, val) in field.options" :key="String(val)" :value="String(val)">{{ label }}</n-radio>
            </n-radio-group>
            <n-select v-else-if="field.type === 'select'" v-model:value="form.config[key]" :options="selectOptions(field.options)" />
          </n-form-item>
        </template>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref, computed } from 'vue';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline } from '@vicons/ionicons5';
import { api } from '../api';

const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const tasks = ref<any[]>([]);
const providers = ref<Record<string, any>>({});
const accounts = ref<any[]>([]);
const orders = ref<any[]>([]);

const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const form = reactive<any>({ aid: null, oid: null, remark: '', config: {} });
const currentProvider = ref<any>(null);

const accountOptions = computed(() => accounts.value.map((r: any) => ({ label: r.name + ' [' + (r.typename || r.type) + ']', value: r.id })));
const orderOptions = computed(() =>
  orders.value.map((r: any) => {
    const d = (r.domains || []).join(',');
    return { label: `${r.id}_${d}` + (r.aid === 0 ? '（手动续期）' : `（${r.typename || '手动'}）`), value: r.id, disabled: r.status !== 3 };
  }),
);

const columns = [
  { title: 'ID', key: 'id', width: 60 },
  {
    title: '部署类型',
    key: 'typename',
    width: 130,
    render(row: any) {
      return h(NTag, { size: 'small', bordered: false }, { default: () => row.typename || row.type });
    },
  },
  {
    title: '绑定域名',
    key: 'domains',
    minWidth: 180,
    render(row: any) {
      const txt = (row.domains || []).join(', ');
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => txt });
    },
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render(row: any) {
      const map: any = { 0: ['待部署', 'default'], 1: ['已部署', 'success'], [-1]: ['失败', 'error'] };
      const [label, type] = map[row.status] || [row.status, 'default'];
      return h(NTag, { size: 'small', type }, { default: () => label });
    },
  },
  {
    title: '启用',
    key: 'active',
    width: 70,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.active ? 'success' : 'default', bordered: false }, { default: () => (row.active ? '是' : '否') });
    },
  },
  { title: '最后部署', key: 'lasttime', width: 160 },
  {
    title: '操作',
    key: 'actions',
    width: 240,
    render(row: any) {
      const btns: any[] = [];
      if (row.status !== 1) btns.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => process(row) }, { default: () => '执行部署' }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => reset(row) }, { default: () => '重置' }));
      btns.push(h(NButton, { size: 'tiny', onClick: () => toggleActive(row) }, { default: () => (row.active ? '停用' : '启用') }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => '删除' }));
      return h(NSpace, null, { default: () => btns });
    },
  },
];

function selectOptions(options: any) {
  if (Array.isArray(options)) return options;
  return Object.entries(options || {}).map(([value, label]) => ({ label: String(label), value }));
}

function fieldVisible(show: string | undefined, config: Record<string, any>): boolean {
  if (!show) return true;
  try {
    const fn = new Function('config', `with(config){return !!(${show});}`);
    return !!fn(config);
  } catch {
    return true;
  }
}

async function loadTasks() {
  loading.value = true;
  const res = await api<any>('GET', '/deploy/tasks', { limit: 200 });
  tasks.value = res.code === 0 ? res.data : [];
  loading.value = false;
}

async function loadProviders() {
  const res = await api<any>('GET', '/deploy/providers');
  if (res.code === 0) providers.value = res.data;
}

async function loadAccounts() {
  const res = await api<any>('GET', '/cert/accounts', { deploy: 1, limit: 200 });
  accounts.value = res.code === 0 ? res.data : [];
}

async function loadOrders() {
  const res = await api<any>('GET', '/cert/orders', { limit: 200 });
  orders.value = res.code === 0 ? res.data : [];
}

function onAccountChange() {
  const acct = accounts.value.find((a: any) => a.id === form.aid);
  currentProvider.value = providers.value[acct?.type] || null;
  const cfg: Record<string, any> = {};
  if (currentProvider.value) {
    for (const [key, field] of Object.entries<any>(currentProvider.value.taskinputs || {})) {
      cfg[key] = field.value !== undefined ? String(field.value) : '';
    }
  }
  form.config = cfg;
}

function openAdd() {
  editingId.value = null;
  form.aid = null;
  form.oid = null;
  form.remark = '';
  form.config = {};
  currentProvider.value = null;
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.aid = row.aid;
  form.oid = row.oid;
  form.remark = row.remark || '';
  form.config = safeJson(row.config) || {};
  const acct = accounts.value.find((a: any) => a.id === row.aid);
  currentProvider.value = providers.value[acct?.type || row.type] || null;
  showEdit.value = true;
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

async function save() {
  if (!form.aid || !form.oid) return message.warning('请选择部署账户和证书订单');
  saving.value = true;
  const body = { aid: form.aid, oid: form.oid, config: form.config, remark: form.remark };
  const res = editingId.value ? await api('PUT', `/deploy/tasks/${editingId.value}`, body) : await api('POST', '/deploy/tasks', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    loadTasks();
  } else message.error(res.msg);
}

async function process(row: any) {
  const res = await api('POST', `/deploy/tasks/${row.id}/process`, {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
  loadTasks();
}

function reset(row: any) {
  dialog.warning({
    title: '重置任务',
    content: '确定重置该部署任务吗？',
    positiveText: '重置',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('POST', `/deploy/tasks/${row.id}/reset`, {});
      if (res.code === 0) message.success('重置成功');
      else message.error(res.msg);
      loadTasks();
    },
  });
}

async function toggleActive(row: any) {
  const res = await api('POST', `/deploy/tasks/${row.id}/setactive`, { active: row.active ? 0 : 1 });
  if (res.code === 0) message.success('操作成功');
  else message.error(res.msg);
  loadTasks();
}

function del(row: any) {
  dialog.warning({
    title: '删除任务',
    content: '确定删除该部署任务吗？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('DELETE', `/deploy/tasks/${row.id}`);
      if (res.code === 0) {
        message.success('删除成功');
        loadTasks();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadTasks();
  loadProviders();
  loadAccounts();
  loadOrders();
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