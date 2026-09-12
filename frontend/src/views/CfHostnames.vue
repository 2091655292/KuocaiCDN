<template>
  <div>
    <n-card :bordered="false" size="small">
      <div class="head">
        <n-space align="center">
          <n-button quaternary circle @click="$router.back()"><template #icon><n-icon :component="ArrowBackOutline" /></template></n-button>
          <span class="title">Cloudflare 自定义主机名 · {{ domainName || domainId }}</span>
          <n-tag v-if="fallbackOrigin" size="small" type="info">Fallback: {{ fallbackOrigin }}</n-tag>
        </n-space>
        <n-space size="small">
          <n-tag size="small" v-if="dcvUuid">DCV UUID: {{ dcvUuid }}</n-tag>
          <n-button size="small" @click="loadDcvUuid">获取 DCV UUID</n-button>
          <n-button size="small" @click="openFallback">Fallback 源站</n-button>
        </n-space>
      </div>
    </n-card>

    <n-card :bordered="false" size="small" style="margin-top: 12px">
      <n-space style="margin-bottom: 12px">
        <n-button type="primary" size="small" @click="openAdd">添加</n-button>
        <n-button size="small" @click="openBatchAdd">批量添加</n-button>
        <n-button size="small" :disabled="!selection.length" @click="openBatchEdit">批量编辑</n-button>
        <n-button size="small" :disabled="!selection.length" @click="batchRefresh">批量刷新验证</n-button>
        <n-button size="small" :disabled="!selection.length" @click="confirmBatchDelete">批量删除</n-button>
        <n-divider vertical />
        <n-button size="small" :disabled="!selection.length" @click="openBatchDcv">批量 DCV 委派</n-button>
        <n-button size="small" :disabled="!selection.length" @click="openBatchTxt('hostname')">批量主机名验证</n-button>
        <n-button size="small" :disabled="!selection.length" @click="openBatchTxt('cert')">批量证书验证</n-button>
        <n-button size="small" :disabled="!selection.length" @click="openCfOptimized(false)">CF 优选解析</n-button>
        <n-button size="small" @click="load"><template #icon><n-icon :component="RefreshOutline" /></template>刷新</n-button>
      </n-space>

      <n-data-table
        :columns="columns"
        :data="rows"
        :loading="loading"
        :row-key="(row: any) => row.id"
        :bordered="false"
        size="small"
        @update:checked-row-keys="(k: any[]) => (selection = k)"
      />
      <n-empty v-if="!loading && !rows.length" description="暂无自定义主机名" />
    </n-card>

    <!-- 单个添加/编辑 -->
    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? '编辑自定义主机名' : '添加自定义主机名'" style="max-width:560px" :mask-closable="false">
      <n-form label-placement="left" label-width="130">
        <n-form-item v-if="!editingId" label="主机名" required>
          <n-input v-model:value="form.hostname" placeholder="如 www.example.com" />
        </n-form-item>
        <n-form-item label="自定义源站">
          <n-input v-model:value="form.custom_origin_server" placeholder="留空使用 Fallback Origin" />
        </n-form-item>
        <n-form-item label="证书验证方法">
          <n-radio-group v-model:value="form.ssl_method">
            <n-radio value="txt">TXT</n-radio>
            <n-radio value="http">HTTP</n-radio>
          </n-radio-group>
        </n-form-item>
        <n-form-item label="最低 TLS 版本">
          <n-select v-model:value="form.min_tls_version" :options="tlsOptions" style="width:160px" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 批量添加 -->
    <n-modal v-model:show="showBatchAdd" preset="card" title="批量添加自定义主机名" style="max-width:560px" :mask-closable="false">
      <n-form label-placement="left" label-width="130">
        <n-form-item label="主机名列表" required>
          <n-input v-model:value="batchAddForm.hostnames" type="textarea" :rows="6" placeholder="每行一个主机名" />
        </n-form-item>
        <n-form-item label="自定义源站">
          <n-input v-model:value="batchAddForm.custom_origin_server" />
        </n-form-item>
        <n-form-item label="证书验证方法">
          <n-radio-group v-model:value="batchAddForm.ssl_method"><n-radio value="txt">TXT</n-radio><n-radio value="http">HTTP</n-radio></n-radio-group>
        </n-form-item>
        <n-form-item label="最低 TLS 版本">
          <n-select v-model:value="batchAddForm.min_tls_version" :options="tlsOptions" style="width:160px" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showBatchAdd = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="saveBatchAdd">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 批量编辑 -->
    <n-modal v-model:show="showBatchEdit" preset="card" title="批量编辑自定义主机名" style="max-width:560px" :mask-closable="false">
      <n-form label-placement="left" label-width="130">
        <n-form-item label="自定义源站">
          <n-input v-model:value="batchEditForm.custom_origin_server" placeholder="留空则清空源站" />
        </n-form-item>
        <n-form-item label="证书验证方法">
          <n-select v-model:value="batchEditForm.ssl_method" :options="[{label:'保持不变',value:''},{label:'TXT',value:'txt'},{label:'HTTP',value:'http'}]" style="width:160px" />
        </n-form-item>
        <n-form-item label="最低 TLS 版本">
          <n-select v-model:value="batchEditForm.min_tls_version" :options="[{label:'保持不变',value:''},...tlsOptions]" style="width:160px" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showBatchEdit = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="saveBatchEdit">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Fallback Origin -->
    <n-modal v-model:show="showFallback" preset="card" title="Fallback Origin" style="max-width:480px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item label="当前源站">
          <n-input :value="fallbackOrigin || '（未设置）'" disabled />
        </n-form-item>
        <n-form-item label="新源站">
          <n-input v-model:value="fallbackForm.origin" placeholder="如 origin.example.com" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button type="error" quaternary @click="clearFallback">清空</n-button>
          <n-button @click="showFallback = false">关闭</n-button>
          <n-button type="primary" :loading="saving" @click="saveFallback">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 批量添加 DNS 记录（DCV/TXT 通用） -->
    <n-modal v-model:show="showBatchRecord" preset="card" :title="batchRecord.title" style="max-width:640px" :mask-closable="false">
      <n-alert v-if="batchRecord.warning" type="warning" style="margin-bottom:12px">{{ batchRecord.warning }}</n-alert>
      <div v-for="(g, gi) in batchRecord.groups" :key="gi" class="bg">
        <div class="bg-title">DNS 域名：{{ g.domainName }}</div>
        <div class="bg-items">
          <div v-for="(it, ii) in g.items" :key="ii" class="bg-item">
            <div class="mono">{{ it.label }}</div>
            <div class="dim mono">{{ it.name }}  →  {{ it.value }}</div>
          </div>
        </div>
        <n-select v-model:value="g.domainId" :options="g.options" placeholder="选择解析服务商" size="small" style="max-width:360px" />
      </div>
      <n-empty v-if="!batchRecord.groups.length" description="没有可处理的主机名" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showBatchRecord = false">取消</n-button>
          <n-button type="primary" :loading="batchRecord.running" @click="runBatchRecord">开始处理</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- CF 优选 -->
    <n-modal v-model:show="showCfOptimized" preset="card" :title="cfOptimized.single ? 'CF 优选解析' : '批量 CF 优选解析'" style="max-width:680px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item label="最优目标">
          <n-radio-group v-model:value="cfOptimized.targetMode" @update:value="(v: string) => { if (v !== '_custom') cfOptimized.customValue = ''; }">
            <n-space vertical>
              <n-radio v-for="t in cfOptimized.targets" :key="t.value" :value="t.value">{{ t.value }} <span class="dim">{{ t.label }}</span></n-radio>
              <n-radio value="_custom">自定义</n-radio>
            </n-space>
          </n-radio-group>
          <n-space v-if="cfOptimized.targetMode === '_custom'" style="margin-top:8px">
            <n-select v-model:value="cfOptimized.customType" :options="[{label:'CNAME',value:'CNAME'},{label:'A',value:'A'},{label:'AAAA',value:'AAAA'}]" style="width:110px" />
            <n-input v-model:value="cfOptimized.customValue" placeholder="目标值（域名或IP）" style="width:250px" />
          </n-space>
        </n-form-item>
      </n-form>
      <n-divider />
      <div v-for="(g, gi) in cfOptimized.groups" :key="gi" class="bg">
        <div class="bg-title">DNS 域名：{{ g.domainName }}（{{ g.items.length }} 个主机名）</div>
        <n-space>
          <n-select v-model:value="g.domainId" :options="g.options" placeholder="选择解析服务商" size="small" style="width:260px" @update:value="() => loadGroupLines(g)" />
          <n-select v-model:value="g.line" :options="g.lineOptions" size="small" style="width:180px" />
        </n-space>
      </div>
      <n-empty v-if="!cfOptimized.groups.length" description="没有可处理的主机名" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCfOptimized = false">取消</n-button>
          <n-button type="primary" :loading="cfOptimized.running" @click="runCfOptimized">开始处理</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 详情 -->
    <n-modal v-model:show="showDetail" preset="card" :title="'验证详情 · ' + detailRow?.hostname" style="max-width:720px">
      <n-descriptions v-if="detailRow" :column="1" label-placement="left" bordered size="small">
        <n-descriptions-item label="主机名">{{ detailRow.hostname }}</n-descriptions-item>
        <n-descriptions-item label="自定义源站">{{ detailRow.custom_origin_server || '-' }}</n-descriptions-item>
        <n-descriptions-item label="状态">{{ detailRow.status || '-' }}</n-descriptions-item>
        <n-descriptions-item label="主机名验证">{{ detailRow.verification_status }}</n-descriptions-item>
        <n-descriptions-item label="证书状态">{{ detailRow.ssl_status }}</n-descriptions-item>
        <n-descriptions-item label="证书验证">{{ detailRow.ssl_validation_status }}</n-descriptions-item>
        <n-descriptions-item label="错误信息">{{ detailRow.validation_errors || '-' }}</n-descriptions-item>
      </n-descriptions>
      <template v-if="detailRow">
        <n-divider v-if="detailRow.ssl_validation_records?.length">证书验证记录</n-divider>
        <n-table v-if="detailRow.ssl_validation_records?.length" :bordered="true" size="small">
          <thead>
            <tr><th>状态</th><th>TXT 名称</th><th>TXT 值</th><th>CNAME 名称</th><th>CNAME 目标</th><th>HTTP 地址</th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in detailRow.ssl_validation_records" :key="i">
              <td>{{ r.status || '-' }}</td>
              <td class="mono">{{ r.txt_name || '-' }}</td>
              <td class="mono">{{ r.txt_value || '-' }}</td>
              <td class="mono">{{ r.cname_name || '-' }}</td>
              <td class="mono">{{ r.cname_target || '-' }}</td>
              <td class="mono">{{ r.http_url || '-' }}</td>
            </tr>
          </tbody>
        </n-table>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { ArrowBackOutline, RefreshOutline } from '@vicons/ionicons5';
import { api, getUser } from '../api';

const route = useRoute();
const message = useMessage();
const dialog = useDialog();
const domainId = Number(route.params.id);
const domainName = ref('');
const loading = ref(false);
const rows = ref<any[]>([]);
const selection = ref<string[]>([]);
const saving = ref(false);

const dcvUuid = ref('');
const fallbackOrigin = ref('');

const showEdit = ref(false);
const editingId = ref<string | null>(null);
const form = reactive<any>({ hostname: '', custom_origin_server: '', ssl_method: 'txt', min_tls_version: '1.0' });

const showBatchAdd = ref(false);
const batchAddForm = reactive<any>({ hostnames: '', custom_origin_server: '', ssl_method: 'txt', min_tls_version: '1.0' });

const showBatchEdit = ref(false);
const batchEditForm = reactive<any>({ custom_origin_server: '', ssl_method: '', min_tls_version: '' });

const showFallback = ref(false);
const fallbackForm = reactive<any>({ origin: '' });

const showDetail = ref(false);
const detailRow = ref<any>(null);

const tlsOptions = ['1.0', '1.1', '1.2', '1.3'].map((v) => ({ label: v, value: v }));

const columns: any[] = [
  { type: 'selection', width: 40 },
  { title: '主机名', key: 'hostname', minWidth: 180, render: (row: any) => h(NEllipsis, { style: 'max-width:220px' }, { default: () => row.hostname }) },
  { title: '自定义源站', key: 'custom_origin_server', minWidth: 140, render: (row: any) => h(NEllipsis, { style: 'max-width:160px' }, { default: () => row.custom_origin_server || '-' }) },
  { title: '验证方法', key: 'ssl_method', width: 90, render: (row: any) => (row.ssl_method ? row.ssl_method.toUpperCase() : '-') },
  { title: 'TLS', key: 'ssl_min_tls_version', width: 60, render: (row: any) => row.ssl_min_tls_version || '-' },
  { title: '证书状态', key: 'ssl_status', width: 100, render: (row: any) => statusTag(row.ssl_status) },
  { title: '证书验证', key: 'ssl_validation_status', width: 120, render: (row: any) => statusTag(row.ssl_validation_status) },
  { title: '主机名验证', key: 'verification_status', width: 110, render: (row: any) => statusTag(row.verification_status) },
  { title: '创建时间', key: 'created_on', width: 160, render: (row: any) => (row.created_on ? fmt(row.created_on) : '-') },
  {
    title: '操作',
    key: 'actions',
    width: 240,
    render(row: any) {
      return h(NSpace, { size: 2 }, {
        default: () => [
          h(NButton, { size: 'tiny', type: 'primary', onClick: () => openEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'tiny', onClick: () => refreshOne(row) }, { default: () => '刷新验证' }),
          h(NButton, { size: 'tiny', onClick: () => openCfOptimized(true, row.hostname) }, { default: () => '优选' }),
          h(NButton, { size: 'tiny', onClick: () => showDetailOf(row) }, { default: () => '详情' }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => delOne(row) }, { default: () => '删除' }),
        ],
      });
    },
  },
];

function fmt(s: string) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('zh-CN', { hour12: false });
}

function statusTag(v: string) {
  const val = (v || '-').toUpperCase();
  let type: any = 'default';
  if (val === 'ACTIVE') type = 'success';
  else if (val === 'PENDING') type = 'warning';
  else if (val.indexOf('ERROR') >= 0 || val === 'FAILED') type = 'error';
  return h(NTag, { size: 'small', type, bordered: false }, { default: () => val });
}

async function load() {
  loading.value = true;
  const res = await api<any>('GET', `/cloudflare/domains/${domainId}/hostnames`);
  if (res.code === 0) rows.value = res.data;
  else message.error(res.msg);
  loading.value = false;
}

async function loadDomainInfo() {
  const res = await api<any>('GET', '/domains');
  if (res.code === 0) {
    const d = res.data.find((x: any) => x.id === domainId);
    if (d) domainName.value = d.name;
  }
}

async function loadDcvUuid() {
  const res = await api<any>('GET', `/cloudflare/domains/${domainId}/dcv-uuid`);
  if (res.code === 0 && res.data.uuid) {
    dcvUuid.value = res.data.uuid;
    message.success('已获取 DCV 委派 UUID');
  } else message.error(res.msg || '获取失败');
}

async function loadFallback() {
  const res = await api<any>('GET', `/cloudflare/domains/${domainId}/fallback`);
  if (res.code === 0) fallbackOrigin.value = res.data.origin || '';
}

function openAdd() {
  editingId.value = null;
  Object.assign(form, { hostname: '', custom_origin_server: '', ssl_method: 'txt', min_tls_version: '1.0' });
  showEdit.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  Object.assign(form, { custom_origin_server: row.custom_origin_server || '', ssl_method: row.ssl_method || 'txt', min_tls_version: row.ssl_min_tls_version || '1.0' });
  showEdit.value = true;
}

async function save() {
  if (!editingId.value && !form.hostname) return message.warning('主机名不能为空');
  saving.value = true;
  const body = { custom_origin_server: form.custom_origin_server, ssl_method: form.ssl_method, min_tls_version: form.min_tls_version };
  const res = editingId.value
    ? await api('PUT', `/cloudflare/domains/${domainId}/hostnames/${editingId.value}`, body)
    : await api('POST', `/cloudflare/domains/${domainId}/hostnames`, { ...body, hostname: form.hostname });
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    load();
  } else message.error(res.msg);
}

function openBatchAdd() {
  Object.assign(batchAddForm, { hostnames: '', custom_origin_server: '', ssl_method: 'txt', min_tls_version: '1.0' });
  showBatchAdd.value = true;
}

async function saveBatchAdd() {
  if (!batchAddForm.hostnames.trim()) return message.warning('请输入主机名列表');
  saving.value = true;
  const res = await api('POST', `/cloudflare/domains/${domainId}/hostnames/batch_add`, { ...batchAddForm });
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showBatchAdd.value = false;
    load();
  } else message.error(res.msg);
}

function openBatchEdit() {
  Object.assign(batchEditForm, { custom_origin_server: '', ssl_method: '', min_tls_version: '' });
  showBatchEdit.value = true;
}

async function saveBatchEdit() {
  saving.value = true;
  const res = await api('POST', `/cloudflare/domains/${domainId}/hostnames/batch_update`, {
    hostname_ids: selection.value.join(','),
    ...batchEditForm,
  });
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showBatchEdit.value = false;
    load();
  } else message.error(res.msg);
}

function refreshOne(row: any) {
  dialog.info({ title: '刷新验证', content: `确定重新向 Cloudflare 发起 ${row.hostname} 的验证吗？`, positiveText: '确定', negativeText: '取消', onPositiveClick: async () => {
    const res = await api('POST', `/cloudflare/domains/${domainId}/hostnames/${row.id}/refresh`);
    if (res.code === 0) { message.success(res.msg); load(); } else message.error(res.msg);
  } });
}

function batchRefresh() {
  dialog.info({ title: '批量刷新验证', content: `确定重新发起 ${selection.value.length} 个主机名的验证吗？`, positiveText: '确定', negativeText: '取消', onPositiveClick: async () => {
    for (const id of selection.value) await api('POST', `/cloudflare/domains/${domainId}/hostnames/${id}/refresh`);
    message.success('已重新发起验证');
    load();
  } });
}

function delOne(row: any) {
  dialog.warning({ title: '删除自定义主机名', content: `确定删除 ${row.hostname} 吗？`, positiveText: '删除', negativeText: '取消', onPositiveClick: async () => {
    const res = await api('DELETE', `/cloudflare/domains/${domainId}/hostnames/${row.id}?hostname=${encodeURIComponent(row.hostname)}`);
    if (res.code === 0) { message.success(res.msg); load(); } else message.error(res.msg);
  } });
}

function confirmBatchDelete() {
  dialog.warning({ title: '批量删除', content: `确定删除选中的 ${selection.value.length} 个主机名吗？`, positiveText: '删除', negativeText: '取消', onPositiveClick: async () => {
    const res = await api('POST', `/cloudflare/domains/${domainId}/hostnames/batch_delete`, { hostname_ids: selection.value });
    if (res.code === 0) { message.success(res.msg); load(); } else message.error(res.msg);
  } });
}

function openFallback() {
  fallbackForm.origin = '';
  showFallback.value = true;
}

async function saveFallback() {
  if (!fallbackForm.origin.trim()) return message.warning('请输入源站');
  saving.value = true;
  const res = await api('PUT', `/cloudflare/domains/${domainId}/fallback`, { origin: fallbackForm.origin });
  saving.value = false;
  if (res.code === 0) { message.success(res.msg); fallbackOrigin.value = res.data.origin; showFallback.value = false; } else message.error(res.msg);
}

function clearFallback() {
  dialog.warning({ title: '清空 Fallback Origin', content: '确定清空吗？', positiveText: '清空', negativeText: '取消', onPositiveClick: async () => {
    const res = await api('DELETE', `/cloudflare/domains/${domainId}/fallback`);
    if (res.code === 0) { message.success(res.msg); fallbackOrigin.value = ''; showFallback.value = false; } else message.error(res.msg);
  } });
}

function showDetailOf(row: any) {
  detailRow.value = row;
  showDetail.value = true;
}

// ==================== 批量添加 DNS 记录（DCV / TXT） ====================

interface Group { domainName: string; domainId: string | null; options: any[]; items: any[]; }
interface BatchRecordState { title: string; warning: string; groups: Group[]; running: boolean; }

const showBatchRecord = ref(false);
const batchRecord = reactive<BatchRecordState>({ title: '', warning: '', groups: [], running: false });

async function resolveTargets(name: string): Promise<any[]> {
  const res = await api<any>('POST', `/cloudflare/domains/${domainId}/hostnames/txt-targets`, { hostname: name });
  return res.code === 0 && res.data?.candidates ? res.data.candidates : [];
}

function groupByDomain(items: { label: string; name: string; value: string; candidates: any[] }[]) {
  const groups: Record<string, Group> = {};
  for (const it of items) {
    const domainName = it.candidates.length ? it.candidates[0].domain_name : '未知域名';
    if (!groups[domainName]) groups[domainName] = { domainName, domainId: null, options: [], items: [] };
    groups[domainName].items.push(it);
    for (const c of it.candidates) {
      if (!groups[domainName].options.find((o: any) => o.value === c.domain_id)) {
        groups[domainName].options.push({ label: `${c.domain_name} (${c.account_type_name})`, value: c.domain_id });
      }
    }
  }
  return Object.values(groups);
}

async function openBatchDcv() {
  if (!dcvUuid.value) { await loadDcvUuid(); if (!dcvUuid.value) return; }
  const items: any[] = [];
  for (const id of selection.value) {
    const row = rows.value.find((r) => r.id === id);
    if (!row) continue;
    const name = `_acme-challenge.${row.hostname}`;
    const candidates = await resolveTargets(name);
    items.push({ label: row.hostname, name, value: `${row.hostname}.${dcvUuid.value}.dcv.cloudflare.com`, candidates, type: 'CNAME' });
  }
  if (!items.length) return message.warning('没有可处理的主机名');
  batchRecord.title = `批量 DCV 委派（UUID: ${dcvUuid.value}）`;
  batchRecord.warning = '将为每个主机名添加 _acme-challenge CNAME 记录';
  batchRecord.groups = groupByDomain(items);
  batchRecord.running = false;
  showBatchRecord.value = true;
}

async function openBatchTxt(kind: 'hostname' | 'cert') {
  const items: any[] = [];
  const skipped: string[] = [];
  for (const id of selection.value) {
    const row = rows.value.find((r) => r.id === id);
    if (!row) continue;
    let name = '';
    let value = '';
    if (kind === 'hostname') {
      name = row.ownership_verification?.name || '';
      value = row.ownership_verification?.value || '';
    } else {
      const rec = row.ssl_validation_records?.find((r: any) => r.txt_name || r.txt_value);
      name = rec?.txt_name || row.ssl?.txt_name || '';
      value = rec?.txt_value || row.ssl?.txt_value || '';
    }
    if (!name || !value) { skipped.push(row.hostname); continue; }
    const candidates = await resolveTargets(name);
    items.push({ label: row.hostname, name, value, candidates, type: 'TXT' });
  }
  if (!items.length) return message.warning('所选主机名都没有验证信息，请先刷新获取');
  batchRecord.title = kind === 'hostname' ? '批量主机名 TXT 验证' : '批量证书 TXT 验证';
  batchRecord.warning = skipped.length ? `有 ${skipped.length} 个主机名无法获取验证信息已跳过：${skipped.join(', ')}` : '';
  batchRecord.groups = groupByDomain(items);
  batchRecord.running = false;
  showBatchRecord.value = true;
}

async function runBatchRecord() {
  for (const g of batchRecord.groups) {
    if (!g.domainId) return message.warning('请为所有 DNS 域名选择解析服务商');
  }
  batchRecord.running = true;
  let ok = 0;
  let fail = 0;
  const errors: string[] = [];
  for (const g of batchRecord.groups) {
    for (const it of g.items) {
      const cand = it.candidates.find((c: any) => String(c.domain_id) === String(g.domainId));
      if (!cand) { fail++; errors.push(`${it.label}: 未找到解析域名`); continue; }
      const line = await getDefaultLine(g.domainId!);
      const res = await api('POST', `/domains/${g.domainId}/records`, { name: cand.record_name, type: it.type, value: it.value, line, ttl: 600, mx: 1, weight: 0, remark: 'Cloudflare 验证' });
      if (res.code === 0) ok++;
      else { fail++; errors.push(`${it.label}: ${res.msg}`); }
    }
  }
  batchRecord.running = false;
  showBatchRecord.value = false;
  dialog.info({ title: '处理完成', content: `成功 ${ok} 个，失败 ${fail} 个` + (errors.length ? '\n\n失败详情：\n' + errors.join('\n') : ''), positiveText: '确定' });
}

async function getDefaultLine(targetDomainId: number): Promise<string> {
  const res = await api<any>('GET', `/domains/${targetDomainId}/lines`);
  if (res.code === 0 && res.data) {
    const keys = Object.keys(res.data);
    if (keys.length) return res.data[keys[0]];
  }
  return '0';
}

// ==================== CF 优选 ====================

interface CfGroup { domainName: string; domainId: string | null; line: string; options: any[]; lineOptions: any[]; items: any[]; }
const showCfOptimized = ref(false);
const cfOptimized = reactive<any>({ single: false, singleHostname: '', targets: [], targetMode: '', customType: 'CNAME', customValue: '', groups: [] as CfGroup[], running: false });

async function loadCfOptimizedTargets() {
  const list: any[] = [];
  const res = await api<any>('GET', '/optimize/tasks', { offset: 0, limit: 100 });
  if (res.code === 0 && res.data?.list) {
    for (const row of res.data.list) {
      if (row.cdn_type == 1 && row.active == 1 && row.rr && row.domain) {
        list.push({ value: `${row.rr}.${row.domain}`, label: row.remark || `${row.rr}.${row.domain}` });
      }
    }
  }
  return list;
}

async function openCfOptimized(single: boolean, hostname?: string) {
  cfOptimized.single = single;
  cfOptimized.singleHostname = hostname || '';
  cfOptimized.targets = await loadCfOptimizedTargets();
  cfOptimized.targetMode = '';
  cfOptimized.customType = 'CNAME';
  cfOptimized.customValue = '';
  cfOptimized.groups = [];
  cfOptimized.running = false;

  const hostnames = single ? [hostname!] : selection.value.map((id) => rows.value.find((r) => r.id === id)?.hostname).filter(Boolean);
  const items: any[] = [];
  for (const h of hostnames) {
    const candidates = await resolveTargets(h);
    items.push({ hostname: h, candidates });
  }
  const groups: Record<string, CfGroup> = {};
  for (const it of items) {
    const domainName = it.candidates.length ? it.candidates[0].domain_name : '未知域名';
    if (!groups[domainName]) groups[domainName] = { domainName, domainId: null, line: '', options: [], lineOptions: [], items: [] };
    groups[domainName].items.push(it);
    for (const c of it.candidates) {
      if (!groups[domainName].options.find((o: any) => o.value === c.domain_id)) {
        groups[domainName].options.push({ label: `${c.domain_name} (${c.account_type_name})`, value: c.domain_id });
      }
    }
  }
  cfOptimized.groups = Object.values(groups);
  if (!cfOptimized.groups.length) return message.warning('没有可处理的主机名');
  showCfOptimized.value = true;
}

async function loadGroupLines(g: CfGroup) {
  g.lineOptions = [];
  if (!g.domainId) return;
  const res = await api<any>('GET', `/domains/${g.domainId}/lines`);
  if (res.code === 0 && res.data) {
    g.lineOptions = Object.entries(res.data).map(([label, code]) => ({ label, value: code as string }));
    if (g.lineOptions.length) g.line = g.lineOptions[0].value;
  }
}

function cfOptimizedTargetValue(): { value: string; type: string } | null {
  if (cfOptimized.targetMode === '_custom') {
    if (!cfOptimized.customValue.trim()) { message.warning('请输入自定义目标值'); return null; }
    return { value: cfOptimized.customValue.trim(), type: cfOptimized.customType };
  }
  if (!cfOptimized.targetMode) { message.warning('请选择 CNAME 目标'); return null; }
  return { value: cfOptimized.targetMode, type: 'CNAME' };
}

async function runCfOptimized() {
  const target = cfOptimizedTargetValue();
  if (!target) return;
  for (const g of cfOptimized.groups) {
    if (!g.domainId) return message.warning('请为所有 DNS 域名选择解析服务商');
  }
  cfOptimized.running = true;
  let ok = 0;
  let fail = 0;
  const errors: string[] = [];
  for (const g of cfOptimized.groups) {
    const line = g.line || (await getDefaultLine(g.domainId!));
    for (const it of g.items) {
      const cand = it.candidates.find((c: any) => String(c.domain_id) === String(g.domainId));
      if (!cand) { fail++; errors.push(`${it.hostname}: 未找到解析域名`); continue; }
      const res = await api('POST', `/domains/${g.domainId}/records`, { name: cand.record_name, type: target.type, value: target.value, line, ttl: 600, mx: 1, weight: 0, remark: 'Cloudflare 优选解析' });
      if (res.code === 0) ok++;
      else { fail++; errors.push(`${it.hostname}: ${res.msg}`); }
    }
  }
  cfOptimized.running = false;
  showCfOptimized.value = false;
  dialog.info({ title: '优选解析完成', content: `成功 ${ok} 个，失败 ${fail} 个` + (errors.length ? '\n\n失败详情：\n' + errors.join('\n') : ''), positiveText: '确定' });
}

onMounted(() => {
  load();
  loadDomainInfo();
  loadFallback();
});
</script>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; }
.title { font-size: 16px; font-weight: 600; }
.bg { border: 1px solid #e5e5e5; border-radius: 4px; padding: 12px; margin-bottom: 12px; }
.bg-title { font-weight: 600; margin-bottom: 8px; }
.bg-items { margin-bottom: 10px; }
.bg-item { background: #fafafa; border-radius: 4px; padding: 8px; margin-bottom: 6px; }
.mono { font-family: monospace; word-break: break-all; font-size: 12px; }
.dim { color: #888; font-size: 12px; }
</style>