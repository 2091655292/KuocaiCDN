<template>
  <div>
    <n-card :bordered="false" size="small">
      <div class="head">
        <n-space align="center">
          <n-button quaternary circle @click="$router.back()"><template #icon><n-icon :component="ArrowBackOutline" /></template></n-button>
          <span class="title">Cloudflare Tunnel · {{ accountName || '账户 #' + accountId }}</span>
        </n-space>
        <n-button type="primary" size="small" @click="openAdd"><template #icon><n-icon :component="AddOutline" /></template>创建 Tunnel</n-button>
      </div>
    </n-card>

    <n-card :bordered="false" size="small" style="margin-top: 12px">
      <n-data-table :columns="columns" :data="rows" :loading="loading" :row-key="(row: any) => row.id" :bordered="false" size="small" />
      <n-empty v-if="!loading && !rows.length" description="暂无 Tunnel" />
    </n-card>

    <!-- 创建 -->
    <n-modal v-model:show="showAdd" preset="card" title="创建 Tunnel" style="max-width:440px" :mask-closable="false">
      <n-form label-placement="left" label-width="90">
        <n-form-item label="名称" required><n-input v-model:value="addName" placeholder="Tunnel 名称" /></n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAdd = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="saveAdd">创建</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Token -->
    <n-modal v-model:show="showToken" preset="card" title="Tunnel Token" style="max-width:640px">
      <n-form label-placement="left" label-width="90">
        <n-form-item label="Tunnel"><n-input :value="tokenName" disabled /></n-form-item>
        <n-form-item label="Token"><n-input v-model:value="tokenValue" type="textarea" :rows="6" readonly /></n-form-item>
        <n-form-item label="运行命令"><n-input v-model:value="tokenCommand" type="textarea" :rows="2" readonly /></n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="copy(tokenCommand)">复制命令</n-button>
          <n-button @click="showToken = false">关闭</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 公网主机名 -->
    <n-modal v-model:show="showPublic" preset="card" :title="'公网主机名 · ' + currentTunnelName" style="max-width:760px">
      <n-form label-placement="left" label-width="90" inline>
        <n-form-item label="主机名"><n-input v-model:value="publicForm.hostname" placeholder="app.example.com" style="width:200px" /></n-form-item>
        <n-form-item label="服务"><n-input v-model:value="publicForm.service" placeholder="http://localhost:8080" style="width:200px" /></n-form-item>
        <n-form-item label="路径"><n-input v-model:value="publicForm.path" placeholder="留空" style="width:120px" /></n-form-item>
        <n-button type="primary" size="small" :loading="publicLoading" @click="savePublic">保存</n-button>
      </n-form>
      <n-divider />
      <n-data-table :columns="publicColumns" :data="publicRows" :loading="publicLoading" :row-key="(row: any) => row.hostname + row.path" :bordered="false" size="small" />
      <template #footer>
        <n-button @click="showPublic = false">关闭</n-button>
      </template>
    </n-modal>

    <!-- CIDR 路由 -->
    <n-modal v-model:show="showCidr" preset="card" :title="'CIDR 路由 · ' + currentTunnelName" style="max-width:760px">
      <n-form label-placement="left" label-width="90" inline>
        <n-form-item label="CIDR"><n-input v-model:value="cidrForm.network" placeholder="10.0.0.0/24" style="width:180px" /></n-form-item>
        <n-form-item label="备注"><n-input v-model:value="cidrForm.comment" style="width:200px" /></n-form-item>
        <n-button type="primary" size="small" :loading="cidrLoading" @click="saveCidr">添加</n-button>
      </n-form>
      <n-divider />
      <n-data-table :columns="cidrColumns" :data="cidrRows" :loading="cidrLoading" :row-key="(row: any) => row.id" :bordered="false" size="small" />
      <template #footer>
        <n-button @click="showCidr = false">关闭</n-button>
      </template>
    </n-modal>

    <!-- 主机名路由 -->
    <n-modal v-model:show="showRoute" preset="card" :title="'主机名路由 · ' + currentTunnelName" style="max-width:760px">
      <n-form label-placement="left" label-width="90" inline>
        <n-form-item label="主机名"><n-input v-model:value="routeForm.hostname" placeholder="private.example.com" style="width:220px" /></n-form-item>
        <n-form-item label="备注"><n-input v-model:value="routeForm.comment" style="width:200px" /></n-form-item>
        <n-button type="primary" size="small" :loading="routeLoading" @click="saveRoute">添加</n-button>
      </n-form>
      <n-divider />
      <n-data-table :columns="routeColumns" :data="routeRows" :loading="routeLoading" :row-key="(row: any) => row.id" :bordered="false" size="small" />
      <template #footer>
        <n-button @click="showRoute = false">关闭</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { ArrowBackOutline, AddOutline } from '@vicons/ionicons5';
import { api } from '../api';

const route = useRoute();
const message = useMessage();
const dialog = useDialog();
const accountId = Number(route.params.id);
const accountName = ref('');
const loading = ref(false);
const rows = ref<any[]>([]);
const saving = ref(false);

const showAdd = ref(false);
const addName = ref('');

const showToken = ref(false);
const tokenName = ref('');
const tokenValue = ref('');
const tokenCommand = ref('');

const currentTunnelId = ref('');
const currentTunnelName = ref('');

const columns: any[] = [
  { title: '名称', key: 'name', minWidth: 180 },
  { title: 'Tunnel ID', key: 'id', minWidth: 180, render: (row: any) => h(NEllipsis, { style: 'max-width:220px' }, { default: () => row.id || '-' }) },
  { title: '状态', key: 'status', width: 120, render: (row: any) => statusTag(row.status) },
  { title: '连接数', key: 'connection_count', width: 80 },
  { title: '创建时间', key: 'created_at', width: 170, render: (row: any) => fmt(row.created_at) },
  {
    title: '操作',
    key: 'actions',
    width: 340,
    render(row: any) {
      return h(NSpace, { size: 2 }, {
        default: () => [
          h(NButton, { size: 'tiny', type: 'primary', onClick: () => showTokenOf(row) }, { default: () => 'Token' }),
          h(NButton, { size: 'tiny', onClick: () => openPublic(row) }, { default: () => '公网主机名' }),
          h(NButton, { size: 'tiny', onClick: () => openCidr(row) }, { default: () => 'CIDR 路由' }),
          h(NButton, { size: 'tiny', onClick: () => openRoute(row) }, { default: () => '主机名路由' }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => delTunnel(row) }, { default: () => '删除' }),
        ],
      });
    },
  },
];

const publicRows = ref<any[]>([]);
const publicLoading = ref(false);
const publicForm = reactive<any>({ hostname: '', service: '', path: '' });
const publicColumns: any[] = [
  { title: '主机名', key: 'hostname', minWidth: 180 },
  { title: '路径', key: 'path', width: 100, render: (row: any) => row.path || '-' },
  { title: '服务', key: 'service', minWidth: 180, render: (row: any) => h(NEllipsis, { style: 'max-width:220px' }, { default: () => row.service }) },
  {
    title: '操作',
    key: 'actions',
    width: 80,
    render(row: any) {
      return h(NButton, { size: 'tiny', type: 'error', onClick: () => delPublic(row) }, { default: () => '删除' });
    },
  },
];

const showCidr = ref(false);
const cidrRows = ref<any[]>([]);
const cidrLoading = ref(false);
const cidrForm = reactive<any>({ network: '', comment: '' });
const cidrColumns: any[] = [
  { title: 'CIDR', key: 'network', minWidth: 180 },
  { title: '备注', key: 'comment', minWidth: 160, render: (row: any) => row.comment || '-' },
  { title: '创建时间', key: 'created_at', width: 170, render: (row: any) => fmt(row.created_at) },
  {
    title: '操作',
    key: 'actions',
    width: 80,
    render(row: any) {
      return h(NButton, { size: 'tiny', type: 'error', onClick: () => delCidr(row) }, { default: () => '删除' });
    },
  },
];

const showRoute = ref(false);
const routeRows = ref<any[]>([]);
const routeLoading = ref(false);
const routeForm = reactive<any>({ hostname: '', comment: '' });
const routeColumns: any[] = [
  { title: '主机名', key: 'hostname', minWidth: 200 },
  { title: '备注', key: 'comment', minWidth: 160, render: (row: any) => row.comment || '-' },
  { title: '创建时间', key: 'created_at', width: 170, render: (row: any) => fmt(row.created_at) },
  {
    title: '操作',
    key: 'actions',
    width: 80,
    render(row: any) {
      return h(NButton, { size: 'tiny', type: 'error', onClick: () => delRoute(row) }, { default: () => '删除' });
    },
  },
];

function fmt(s: string) {
  if (!s) return '-';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('zh-CN', { hour12: false });
}

function statusTag(v: string) {
  const val = (v || 'unknown').toUpperCase();
  let type: any = 'default';
  if (val === 'HEALTHY' || val === 'ACTIVE') type = 'success';
  else if (val === 'INACTIVE') type = 'warning';
  return h(NTag, { size: 'small', type, bordered: false }, { default: () => val });
}

async function load() {
  loading.value = true;
  const res = await api<any>('GET', `/cloudflare/accounts/${accountId}/tunnels`);
  if (res.code === 0) {
    rows.value = res.data;
    accountName.value = res.account_name || '';
  } else message.error(res.msg);
  loading.value = false;
}

function openAdd() {
  addName.value = '';
  showAdd.value = true;
}

async function saveAdd() {
  if (!addName.value.trim()) return message.warning('请输入名称');
  saving.value = true;
  const res = await api('POST', `/cloudflare/accounts/${accountId}/tunnels`, { name: addName.value });
  saving.value = false;
  if (res.code === 0) { message.success(res.msg); showAdd.value = false; load(); } else message.error(res.msg);
}

function delTunnel(row: any) {
  dialog.warning({ title: '删除 Tunnel', content: `确定删除 Tunnel ${row.name} 吗？`, positiveText: '删除', negativeText: '取消', onPositiveClick: async () => {
    const res = await api('DELETE', `/cloudflare/accounts/${accountId}/tunnels/${row.id}`);
    if (res.code === 0) { message.success(res.msg); load(); } else message.error(res.msg);
  } });
}

async function showTokenOf(row: any) {
  tokenName.value = `${row.name} [${row.id}]`;
  tokenValue.value = '';
  tokenCommand.value = '';
  showToken.value = true;
  const res = await api<any>('GET', `/cloudflare/accounts/${accountId}/tunnels/${row.id}/token`);
  if (res.code === 0) {
    tokenValue.value = res.data.token || '';
    tokenCommand.value = `cloudflared tunnel run --token ${res.data.token}`;
  } else message.error(res.msg);
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(() => message.success('已复制')).catch(() => message.warning('复制失败，请手动复制'));
}

function openPublic(row: any) {
  currentTunnelId.value = row.id;
  currentTunnelName.value = row.name;
  Object.assign(publicForm, { hostname: '', service: '', path: '' });
  showPublic.value = true;
  loadPublic();
}

async function loadPublic() {
  publicLoading.value = true;
  const res = await api<any>('GET', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/public-hostnames`);
  publicRows.value = res.code === 0 ? res.data : [];
  if (res.code !== 0) message.error(res.msg);
  publicLoading.value = false;
}

async function savePublic() {
  if (!publicForm.hostname || !publicForm.service) return message.warning('主机名和服务地址不能为空');
  publicLoading.value = true;
  const res = await api('PUT', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/public-hostnames`, { ...publicForm });
  publicLoading.value = false;
  if (res.code === 0) { message.success(res.msg); Object.assign(publicForm, { hostname: '', service: '', path: '' }); loadPublic(); } else message.error(res.msg);
}

function delPublic(row: any) {
  dialog.warning({ title: '删除公网主机名', content: `确定删除 ${row.hostname}${row.path ? ' [' + row.path + ']' : ''} 吗？`, positiveText: '删除', negativeText: '取消', onPositiveClick: async () => {
    const q = `hostname=${encodeURIComponent(row.hostname)}&path=${encodeURIComponent(row.path || '')}`;
    const res = await api('DELETE', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/public-hostnames?${q}`);
    if (res.code === 0) { message.success(res.msg); loadPublic(); } else message.error(res.msg);
  } });
}

function openCidr(row: any) {
  currentTunnelId.value = row.id;
  currentTunnelName.value = row.name;
  Object.assign(cidrForm, { network: '', comment: '' });
  showCidr.value = true;
  loadCidr();
}

async function loadCidr() {
  cidrLoading.value = true;
  const res = await api<any>('GET', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/cidr-routes`);
  cidrRows.value = res.code === 0 ? res.data : [];
  if (res.code !== 0) message.error(res.msg);
  cidrLoading.value = false;
}

async function saveCidr() {
  if (!cidrForm.network.trim()) return message.warning('请输入 CIDR');
  cidrLoading.value = true;
  const res = await api('POST', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/cidr-routes`, { ...cidrForm });
  cidrLoading.value = false;
  if (res.code === 0) { message.success(res.msg); Object.assign(cidrForm, { network: '', comment: '' }); loadCidr(); } else message.error(res.msg);
}

function delCidr(row: any) {
  dialog.warning({ title: '删除 CIDR 路由', content: `确定删除 ${row.network} 吗？`, positiveText: '删除', negativeText: '取消', onPositiveClick: async () => {
    const res = await api('DELETE', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/cidr-routes/${row.id}`);
    if (res.code === 0) { message.success(res.msg); loadCidr(); } else message.error(res.msg);
  } });
}

function openRoute(row: any) {
  currentTunnelId.value = row.id;
  currentTunnelName.value = row.name;
  Object.assign(routeForm, { hostname: '', comment: '' });
  showRoute.value = true;
  loadRoute();
}

async function loadRoute() {
  routeLoading.value = true;
  const res = await api<any>('GET', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/hostname-routes`);
  routeRows.value = res.code === 0 ? res.data : [];
  if (res.code !== 0) message.error(res.msg);
  routeLoading.value = false;
}

async function saveRoute() {
  if (!routeForm.hostname.trim()) return message.warning('请输入主机名');
  routeLoading.value = true;
  const res = await api('POST', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/hostname-routes`, { ...routeForm });
  routeLoading.value = false;
  if (res.code === 0) { message.success(res.msg); Object.assign(routeForm, { hostname: '', comment: '' }); loadRoute(); } else message.error(res.msg);
}

function delRoute(row: any) {
  dialog.warning({ title: '删除主机名路由', content: `确定删除 ${row.hostname} 吗？`, positiveText: '删除', negativeText: '取消', onPositiveClick: async () => {
    const res = await api('DELETE', `/cloudflare/accounts/${accountId}/tunnels/${currentTunnelId.value}/hostname-routes/${row.id}`);
    if (res.code === 0) { message.success(res.msg); loadRoute(); } else message.error(res.msg);
  } });
}

onMounted(load);
</script>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; }
.title { font-size: 16px; font-weight: 600; }
</style>