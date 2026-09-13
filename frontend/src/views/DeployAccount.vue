<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">自动部署账户</span>
          <n-button type="primary" @click="openAdd">
            <template #icon><n-icon :component="AddOutline" /></template>
            添加账户
          </n-button>
        </div>
      </template>
      <n-data-table :columns="columns" :data="accounts" :loading="loading" :bordered="false" />
      <n-empty class="list-empty" v-if="!loading && !accounts.length" description="暂无部署账户" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? '编辑账户' : '添加账户'" style="max-width:600px" :mask-closable="false">
      <n-form label-placement="left" label-width="120">
        <n-form-item label="部署类型">
          <n-select v-model:value="form.type" :options="providerOptions" @update:value="onTypeChange" />
        </n-form-item>
        <n-form-item label="账户名称">
          <n-input v-model:value="form.name" placeholder="备注名称" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="form.remark" placeholder="选填" />
        </n-form-item>
        <template v-if="currentProvider">
          <n-alert v-if="!currentProvider.implemented" type="warning" style="margin-bottom:12px">该部署类型正在接入中，暂不可用</n-alert>
          <n-alert v-if="currentProvider.desc || currentProvider.note" type="info" style="margin-bottom:12px" :show-icon="false">
            {{ currentProvider.desc || currentProvider.note }}
          </n-alert>
          <n-form-item v-for="(field, key) in currentProvider.inputs" v-show="fieldVisible(field.show, form.config)" :key="key" :label="field.name" :required="field.required">
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
          <n-button type="primary" :loading="saving" @click="save">保存并验证</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { NButton, NSpace, NEllipsis, NTag, useMessage, useDialog } from 'naive-ui';
import { AddOutline } from '@vicons/ionicons5';
import { api } from '../api';

const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const accounts = ref<any[]>([]);
const providers = ref<Record<string, any>>({});
const classConfig = ref<Record<string, string>>({});

const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const form = reactive<any>({ type: '', name: '', remark: '', config: {} });
const currentProvider = ref<any>(null);
const providerOptions = ref<any[]>([]);

const columns = [
  { title: 'ID', key: 'id', width: 60 },
  {
    title: '部署类型',
    key: 'typename',
    width: 150,
    render(row: any) {
      const cls = providers.value[row.type]?.class;
      return h(NTag, { size: 'small', type: cls === 3 ? 'default' : cls === 2 ? 'warning' : 'info' }, { default: () => row.typename });
    },
  },
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

async function loadProviders() {
  const res = await api<any>('GET', '/deploy/providers');
  if (res.code === 0) {
    providers.value = res.data;
    classConfig.value = res.class_config || {};
    providerOptions.value = Object.entries(res.data).map(([k, v]: any) => ({
      label: (v.implemented ? '' : '[待接入] ') + v.name + '（' + k + '）',
      value: k,
      disabled: !v.implemented,
    }));
  }
}

async function loadAccounts() {
  loading.value = true;
  const res = await api<any>('GET', '/cert/accounts', { deploy: 1, limit: 200 });
  const rows = res.code === 0 ? res.data : [];
  accounts.value = rows.map((r: any) => ({ ...r, typename: r.typename || providers.value[r.type]?.name || r.type }));
  loading.value = false;
}

function onTypeChange() {
  currentProvider.value = providers.value[form.type] || null;
  const cfg: Record<string, any> = {};
  if (currentProvider.value) {
    for (const [key, field] of Object.entries<any>(currentProvider.value.inputs)) {
      cfg[key] = field.value !== undefined ? String(field.value) : '';
    }
  }
  form.config = cfg;
}

function openAdd() {
  editingId.value = null;
  form.type = '';
  form.name = '';
  form.remark = '';
  form.config = {};
  currentProvider.value = null;
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.type = row.type;
  form.name = row.name;
  form.remark = row.remark || '';
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
  if (!form.type || !form.name) return message.warning('请填写部署类型和账户名称');
  if (currentProvider.value && !currentProvider.value.implemented) return message.warning('该部署类型暂未支持');
  saving.value = true;
  const body = { type: form.type, name: form.name, remark: form.remark, config: form.config, deploy: 1 };
  const res = editingId.value
    ? await api('PUT', `/cert/accounts/${editingId.value}`, body)
    : await api('POST', '/cert/accounts', body);
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
      const res = await api('DELETE', `/cert/accounts/${row.id}?deploy=1`);
      if (res.code === 0) {
        message.success('删除成功');
        loadAccounts();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadProviders().then(loadAccounts);
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