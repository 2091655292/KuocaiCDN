<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">DNS 账户</span>
          <n-button type="primary" @click="openAdd">
            <template #icon><n-icon :component="AddOutline" /></template>
            添加账户
          </n-button>
        </div>
      </template>
      <n-data-table :columns="columns" :data="accounts" :loading="loading" :bordered="false" />
      <n-empty class="list-empty" v-if="!loading && !accounts.length" description="暂无 DNS 账户" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? '编辑账户' : '添加账户'" style="max-width:560px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item label="服务商">
          <n-select v-model:value="form.type" :options="providerOptions" @update:value="onTypeChange" />
        </n-form-item>
        <n-form-item label="账户名称">
          <n-input v-model:value="form.name" placeholder="备注名称" />
        </n-form-item>
        <template v-if="currentProvider">
          <n-alert v-if="!currentProvider.implemented" type="warning" style="margin-bottom:12px">
            该服务商正在接入中，暂不可用
          </n-alert>
          <n-form-item v-for="(field, key) in currentProvider.config" :key="key" :label="field.name">
            <n-input v-if="field.type === 'input'" v-model:value="form.config[key]" :placeholder="field.placeholder || field.name" />
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
          <n-button type="primary" :loading="saving" @click="save">保存并验证</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline } from '@vicons/ionicons5';
import { api } from '../api';

const router = useRouter();

const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const accounts = ref<any[]>([]);
const providers = ref<Record<string, any>>({});

const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const form = reactive<any>({ type: '', name: '', config: {} });
const currentProvider = ref<any>(null);

const providerOptions = ref<any[]>([]);

const columns = [
  { title: 'ID', key: 'id', width: 60 },
  { title: '服务商', key: 'type', width: 120 },
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
    width: 210,
    render(row: any) {
      const btns: any[] = [];
      if (row.type === 'cloudflare') {
        btns.push(h(NButton, { size: 'tiny', type: 'info', onClick: () => router.push(`/cloudflare/accounts/${row.id}/tunnels`) }, { default: () => 'Tunnels' }));
      }
      btns.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => openEdit(row) }, { default: () => '编辑' }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => '删除' }));
      return h(NSpace, null, { default: () => btns });
    },
  },
];

function selectOptions(options: any) {
  if (Array.isArray(options)) return options;
  return Object.entries(options || {}).map(([value, label]) => ({ label: String(label), value }));
}

async function loadProviders() {
  const res = await api<any>('GET', '/dns/providers');
  if (res.code === 0) {
    providers.value = res.data;
    providerOptions.value = Object.entries(res.data).map(([k, v]: any) => ({
      label: (v.implemented ? '' : '[待接入] ') + v.name + '（' + k + '）',
      value: k,
      disabled: !v.implemented,
    }));
  }
}

async function loadAccounts() {
  loading.value = true;
  const res = await api<any>('GET', '/dns/accounts');
  accounts.value = res.code === 0 ? res.data : [];
  loading.value = false;
}

function onTypeChange() {
  currentProvider.value = providers.value[form.type] || null;
  const cfg: Record<string, any> = {};
  if (currentProvider.value) {
    for (const [key, field] of Object.entries<any>(currentProvider.value.config)) {
      cfg[key] = field.value !== undefined ? field.value : '';
    }
  }
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

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

async function save() {
  if (!form.type || !form.name) return message.warning('请填写服务商和账户名称');
  if (!currentProvider.value?.implemented) return message.warning('该服务商暂未支持');
  saving.value = true;
  const body = { type: form.type, name: form.name, config: form.config };
  const res = editingId.value
    ? await api('PUT', `/dns/accounts/${editingId.value}`, body)
    : await api('POST', '/dns/accounts', body);
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
      const res = await api('DELETE', `/dns/accounts/${row.id}`);
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