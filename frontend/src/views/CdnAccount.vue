<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">CDN 账户</span>
          <n-button type="primary" @click="openAdd">
            <template #icon><n-icon :component="AddOutline" /></template>
            添加账户
          </n-button>
        </div>
      </template>
      <n-data-table :columns="columns" :data="accounts" :loading="loading" :bordered="false" />
      <n-empty v-if="!loading && !accounts.length" description="暂无 CDN 账户" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? '编辑账户' : '添加账户'" style="max-width:520px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item label="服务商">
          <n-select v-model:value="form.type" :options="providerOptions" @update:value="onTypeChange" />
        </n-form-item>
        <n-form-item label="账户名称">
          <n-input v-model:value="form.name" placeholder="备注名称" />
        </n-form-item>
        <n-alert v-if="currentProvider?.note" type="info" style="margin-bottom:12px">{{ currentProvider.note }}</n-alert>
        <n-form-item v-for="(field, key) in currentProvider?.config || {}" :key="key" :label="field.name">
          <n-input v-model:value="form.config[key]" :placeholder="field.placeholder || field.name" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="save">保存并验证</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { NButton, NSpace, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline } from '@vicons/ionicons5';
import { api } from '../api';

const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const accounts = ref<any[]>([]);
const providers = ref<Record<string, any>>({});
const providerOptions = ref<any[]>([]);

const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const form = reactive<any>({ type: '', name: '', config: {} });
const currentProvider = ref<any>(null);

const columns = [
  { title: 'ID', key: 'id', width: 60 },
  { title: '服务商', key: 'typename', width: 140 },
  {
    title: '账户名称',
    key: 'name',
    minWidth: 180,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.name });
    },
  },
  {
    title: '备注',
    key: 'remark',
    minWidth: 120,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.remark || '' });
    },
  },
  { title: '添加时间', key: 'addtime', width: 170 },
  {
    title: '操作',
    key: 'actions',
    width: 160,
    render(row: any) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'tiny', type: 'primary', onClick: () => openEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => '删除' }),
        ],
      });
    },
  },
];

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

async function loadProviders() {
  const res = await api<any>('GET', '/cdn/providers');
  if (res.code === 0) {
    providers.value = res.data;
    providerOptions.value = Object.entries(res.data).map(([k, v]: any) => ({ label: v.name, value: k }));
  }
}

async function loadAccounts() {
  loading.value = true;
  const res = await api<any>('GET', '/cdn/accounts');
  accounts.value = res.code === 0 ? res.data : [];
  loading.value = false;
}

function onTypeChange() {
  currentProvider.value = providers.value[form.type] || null;
  const cfg: Record<string, any> = {};
  for (const key of Object.keys(currentProvider.value?.config || {})) cfg[key] = '';
  form.config = cfg;
}

function openAdd() {
  editingId.value = null;
  form.type = '';
  form.name = '';
  form.config = {};
  currentProvider.value = null;
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.type = row.type;
  form.name = row.name;
  form.config = safeJson(row.config) || {};
  currentProvider.value = providers.value[form.type] || null;
  showEdit.value = true;
}

async function save() {
  if (!form.type || !form.name) return message.warning('请填写服务商和账户名称');
  saving.value = true;
  const body = { type: form.type, name: form.name, config: form.config, remark: '' };
  const res = editingId.value
    ? await api('PUT', `/cdn/accounts/${editingId.value}`, body)
    : await api('POST', '/cdn/accounts', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    loadAccounts();
  } else message.error(res.msg);
}

function del(row: any) {
  dialog.warning({
    title: '删除账户',
    content: `确定删除账户 ${row.name} 吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/accounts/${row.id}`);
      if (res.code === 0) {
        message.success('删除成功');
        loadAccounts();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadProviders();
  loadAccounts();
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