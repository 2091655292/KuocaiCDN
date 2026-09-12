<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">证书订单</span>
          <n-space>
            <n-button @click="router.push('/cert-settings')">计划任务设置</n-button>
            <n-button type="primary" @click="openAdd">
              <template #icon><n-icon :component="AddOutline" /></template>
              申请证书
            </n-button>
          </n-space>
        </div>
      </template>
      <n-data-table :columns="columns" :data="orders" :loading="loading" :bordered="false" />
      <n-empty v-if="!loading && !orders.length" description="暂无证书订单" />
    </n-card>

    <!-- 添加/编辑弹窗 -->
    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? '编辑订单' : '申请证书'" style="max-width:640px" :mask-closable="false">
      <n-tabs v-model:value="tab" type="line">
        <n-tab-pane name="apply" tab="自动申请">
          <n-form label-placement="left" label-width="100">
            <n-form-item label="证书账户">
              <n-select v-model:value="form.aid" :options="accountOptions" placeholder="选择证书账户" />
            </n-form-item>
            <n-form-item label="密钥类型">
              <n-radio-group v-model:value="form.keytype">
                <n-radio value="RSA">RSA</n-radio>
                <n-radio value="ECC">ECC</n-radio>
              </n-radio-group>
            </n-form-item>
            <n-form-item label="密钥长度">
              <n-select v-model:value="form.keysize" :options="keySizeOptions" />
            </n-form-item>
            <n-form-item label="绑定域名">
              <n-dynamic-input v-model:value="form.domains" placeholder="每行输入一个域名" :min="1" />
            </n-form-item>
          </n-form>
        </n-tab-pane>
        <n-tab-pane name="import" tab="手动导入">
          <n-form label-placement="left" label-width="100">
            <n-form-item label="证书内容">
              <n-input v-model:value="form.fullchain" type="textarea" :rows="6" placeholder="-----BEGIN CERTIFICATE----- ..." />
            </n-form-item>
            <n-form-item label="私钥内容">
              <n-input v-model:value="form.privatekey" type="textarea" :rows="6" placeholder="-----BEGIN PRIVATE KEY----- ..." />
            </n-form-item>
          </n-form>
        </n-tab-pane>
      </n-tabs>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 证书详情 -->
    <n-modal v-model:show="showInfo" preset="card" title="证书详情" style="max-width:720px">
      <n-descriptions v-if="info" bordered :column="1" label-placement="left" style="margin-bottom:16px">
        <n-descriptions-item label="绑定域名">{{ (info.domains || []).join(', ') }}</n-descriptions-item>
        <n-descriptions-item label="签发时间">{{ info.issuetime }}</n-descriptions-item>
        <n-descriptions-item label="到期时间">{{ info.expiretime }}</n-descriptions-item>
      </n-descriptions>
      <n-form-item label="证书 (CERT)">
        <n-input v-model:value="info.crt" type="textarea" :rows="8" readonly />
      </n-form-item>
      <n-form-item label="私钥 (KEY)">
        <n-input v-model:value="info.key" type="textarea" :rows="8" readonly />
      </n-form-item>
      <template #footer>
        <n-space justify="end">
          <n-button @click="copyText('crt')">复制证书</n-button>
          <n-button @click="copyText('key')">复制私钥</n-button>
          <n-button type="primary" @click="downloadPfx">下载 PFX</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 日志 -->
    <n-modal v-model:show="showLog" preset="card" title="处理日志" style="max-width:720px">
      <n-input v-model:value="logText" type="textarea" :rows="18" readonly />
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline } from '@vicons/ionicons5';
import { api } from '../api';

const router = useRouter();

const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const orders = ref<any[]>([]);
const statusLabel = ref<Record<string, string>>({});
const accounts = ref<any[]>([]);
const accountOptions = ref<any[]>([]);

const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const tab = ref('apply');
const form = reactive<any>({ aid: null, keytype: 'RSA', keysize: '2048', domains: [], fullchain: '', privatekey: '' });

const showInfo = ref(false);
const info = ref<any>(null);
const showLog = ref(false);
const logText = ref('');

const keySizeOptions = computed(() =>
  form.keytype === 'RSA'
    ? [{ label: '2048', value: '2048' }, { label: '3072', value: '3072' }, { label: '4096', value: '4096' }]
    : [{ label: '256 (prime256v1)', value: '256' }, { label: '384 (secp384r1)', value: '384' }, { label: '521 (secp521r1)', value: '521' }],
);

function statusType(s: number): any {
  if (s === 3) return 'success';
  if (s === 4) return 'default';
  if (s === 1) return 'warning';
  if (s === 2) return 'info';
  if (s < 0) return 'error';
  return 'default';
}

const columns = [
  { title: 'ID', key: 'id', width: 60 },
  {
    title: '类型',
    key: 'typename',
    width: 100,
    render(row: any) {
      return h(NTag, { size: 'small', bordered: false }, { default: () => row.typename || '手动导入' });
    },
  },
  {
    title: '绑定域名',
    key: 'domains',
    minWidth: 200,
    render(row: any) {
      const txt = (row.domains || []).join(', ');
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => txt });
    },
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render(row: any) {
      return h(NTag, { size: 'small', type: statusType(row.status) }, { default: () => statusLabel.value[String(row.status)] || row.status });
    },
  },
  {
    title: '到期时间',
    key: 'expiretime',
    width: 130,
    render(row: any) {
      return row.expiretime ? `${row.expiretime}${row.end_day != null ? `（剩${row.end_day}天）` : ''}` : '-';
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 260,
    render(row: any) {
      const btns: any[] = [];
      if (row.status < 3) {
        btns.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => process(row) }, { default: () => (row.status === 1 ? '验证' : '处理') }));
        btns.push(h(NButton, { size: 'tiny', onClick: () => reset(row) }, { default: () => '重置' }));
      }
      if (row.status === 3) {
        btns.push(h(NButton, { size: 'tiny', type: 'info', onClick: () => viewInfo(row) }, { default: () => '详情' }));
        btns.push(h(NButton, { size: 'tiny', type: 'warning', onClick: () => revoke(row) }, { default: () => '吊销' }));
        btns.push(h(NButton, { size: 'tiny', onClick: () => toggleAuto(row) }, { default: () => (row.isauto ? '关自动续期' : '开自动续期') }));
      }
      btns.push(h(NButton, { size: 'tiny', onClick: () => viewLog(row) }, { default: () => '日志' }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => '删除' }));
      return h(NSpace, null, { default: () => btns });
    },
  },
];

async function loadOrders() {
  loading.value = true;
  const res = await api<any>('GET', '/cert/orders', { limit: 200 });
  if (res.code === 0) {
    orders.value = res.data;
    statusLabel.value = res.status_label || {};
  } else orders.value = [];
  loading.value = false;
}

async function loadAccounts() {
  const res = await api<any>('GET', '/cert/accounts', { limit: 200 });
  if (res.code === 0) {
    accounts.value = res.data;
    accountOptions.value = res.data.map((r: any) => ({ label: r.name + (r.remark ? '（' + r.remark + '）' : '') + ' [' + (r.typename || r.type) + ']', value: r.id }));
  }
}

function openAdd() {
  editingId.value = null;
  tab.value = 'apply';
  form.aid = null;
  form.keytype = 'RSA';
  form.keysize = '2048';
  form.domains = [];
  form.fullchain = '';
  form.privatekey = '';
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.aid = row.aid;
  form.keytype = row.keytype;
  form.keysize = row.keysize;
  form.domains = [...(row.domains || [])];
  form.fullchain = '';
  form.privatekey = '';
  tab.value = row.aid === 0 ? 'import' : 'apply';
  showEdit.value = true;
}

async function save() {
  saving.value = true;
  let body: any;
  if (tab.value === 'import') {
    if (!form.fullchain || !form.privatekey) return message.warning('请填写证书和私钥内容');
    body = { aid: -1, fullchain: form.fullchain, privatekey: form.privatekey };
  } else {
    if (!form.aid) return message.warning('请选择证书账户');
    const domains = form.domains.map((d: string) => (typeof d === 'string' ? d.trim() : (d as any)?.value?.trim())).filter(Boolean);
    if (!domains.length) return message.warning('请填写绑定域名');
    body = { aid: form.aid, keytype: form.keytype, keysize: form.keysize, domains };
  }
  const res = editingId.value
    ? await api('PUT', `/cert/orders/${editingId.value}`, body)
    : await api('POST', '/cert/orders', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    loadOrders();
  } else message.error(res.msg);
}

async function process(row: any) {
  const res = await api('POST', `/cert/orders/${row.id}/process`, {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
  loadOrders();
}

function reset(row: any) {
  dialog.warning({
    title: '重置订单',
    content: '确定重置该订单吗？将清空申请进度重新开始。',
    positiveText: '重置',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('POST', `/cert/orders/${row.id}/reset`, {});
      if (res.code === 0) message.success('重置成功');
      else message.error(res.msg);
      loadOrders();
    },
  });
}

function revoke(row: any) {
  dialog.warning({
    title: '吊销证书',
    content: '确定吊销该证书吗？吊销后不可恢复。',
    positiveText: '吊销',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('POST', `/cert/orders/${row.id}/revoke`, {});
      if (res.code === 0) message.success('吊销成功');
      else message.error(res.msg);
      loadOrders();
    },
  });
}

async function toggleAuto(row: any) {
  const res = await api('POST', `/cert/orders/${row.id}/setauto`, { isauto: row.isauto ? 0 : 1 });
  if (res.code === 0) message.success('操作成功');
  else message.error(res.msg);
  loadOrders();
}

async function viewInfo(row: any) {
  const res = await api<any>('GET', `/cert/orders/${row.id}/info`);
  if (res.code === 0) {
    info.value = res.data;
    showInfo.value = true;
  } else message.error(res.msg);
}

async function viewLog(row: any) {
  const res = await api<any>('GET', `/cert/orders/${row.id}/log`);
  if (res.code === 0) {
    logText.value = res.data;
    showLog.value = true;
  } else message.info(res.msg || '暂无日志');
}

function copyText(key: 'crt' | 'key') {
  navigator.clipboard.writeText(info.value?.[key] || '').then(() => message.success('已复制'));
}

function downloadPfx() {
  if (!info.value?.pfx) return message.warning('无可下载的 PFX');
  const bytes = Uint8Array.from(atob(info.value.pfx), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/x-pkcs12' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cert.pfx';
  a.click();
  URL.revokeObjectURL(a.href);
}

function del(row: any) {
  dialog.warning({
    title: '删除订单',
    content: '确定删除该证书订单吗？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cert/orders/${row.id}`);
      if (res.code === 0) {
        message.success('删除成功');
        loadOrders();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadOrders();
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