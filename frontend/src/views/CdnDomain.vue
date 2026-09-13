<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">CDN 域名</span>
          <n-space>
            <n-button @click="window.location.href = '/cdn-zones'">站点设置</n-button>
            <n-button type="primary" @click="openAdd">
              <template #icon><n-icon :component="AddOutline" /></template>
              接入域名
            </n-button>
            <n-button @click="showSync = true">
              <template #icon><n-icon :component="CloudDownloadOutline" /></template>
              同步云端
            </n-button>
          </n-space>
        </div>
      </template>
      <n-data-table :columns="columns" :data="domains" :loading="loading" :bordered="false" />
      <n-empty class="list-empty" v-if="!loading && !domains.length" description="暂无 CDN 加速域名" />
    </n-card>

    <!-- 接入域名弹窗 -->
    <n-modal v-model:show="showAdd" preset="card" title="接入加速域名" style="max-width:600px" :mask-closable="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item label="CDN 账户">
          <n-select v-model:value="form.aid" :options="accountOptions" @update:value="onAccountChange" />
        </n-form-item>
        <n-form-item v-if="isZoneType" label="站点">
          <n-select v-model:value="form.zone_id" :options="zoneOptions" placeholder="选择站点" />
        </n-form-item>
        <n-form-item label="联动域名">
          <n-select v-model:value="form.did" :options="dnsDomainOptions" placeholder="彩虹 DNS 域名（用于联动解析）" />
        </n-form-item>
        <n-form-item label="加速域名">
          <n-input v-model:value="form.name" placeholder="如 www.example.com" />
        </n-form-item>
        <n-form-item label="源站地址">
          <n-input v-model:value="form.origin" placeholder="IP 或域名" />
        </n-form-item>
        <n-form-item label="源站类型">
          <n-radio-group v-model:value="form.origin_type">
            <n-radio value="ipaddr">IP 源站</n-radio>
            <n-radio value="domain">域名源站</n-radio>
          </n-radio-group>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAdd = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="doAdd">提交接入</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 同步云端弹窗 -->
    <n-modal v-model:show="showSync" preset="card" title="同步云端已有加速域名" style="max-width:440px">
      <n-form label-placement="left" label-width="90">
        <n-form-item label="CDN 账户">
          <n-select v-model:value="syncAid" :options="accountOptions" />
        </n-form-item>
        <n-form-item label="联动域名">
          <n-select v-model:value="syncDid" :options="[{ label: '全部', value: 0 }, ...dnsDomainOptions]" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showSync = false">取消</n-button>
          <n-button type="primary" :loading="syncing" @click="doSync">开始同步</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { AddOutline, CloudDownloadOutline } from '@vicons/ionicons5';
import { api } from '../api';

const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const domains = ref<any[]>([]);
const accountOptions = ref<any[]>([]);
const accountTypes = ref<Record<number, string>>({});
const dnsDomainOptions = ref<any[]>([]);
const zoneOptions = ref<any[]>([]);

const showAdd = ref(false);
const showSync = ref(false);
const saving = ref(false);
const syncing = ref(false);
const syncAid = ref<number | null>(null);
const syncDid = ref<number>(0);
const form = reactive<any>({ aid: null, did: null, zone_id: null, name: '', origin: '', origin_type: 'ipaddr' });

const isZoneType = computed(() => accountTypes.value[form.aid] === 'tencent_edgeone' || accountTypes.value[form.aid] === 'aliyun_esa');

const columns = [
  { title: 'ID', key: 'id', width: 60 },
  {
    title: '加速域名',
    key: 'name',
    minWidth: 170,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.name });
    },
  },
  { title: '线路', key: 'routename', width: 140 },
  {
    title: '源站',
    key: 'origin',
    minWidth: 160,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.origin || '' });
    },
  },
  {
    title: 'CNAME',
    key: 'cname',
    minWidth: 180,
    render(row: any) {
      return h(NEllipsis, { expandTrigger: 'click' }, { default: () => row.cname || '' });
    },
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render(row: any) {
      return h(NTag, { type: row.status === 'offline' ? 'default' : 'success', size: 'small' }, { default: () => row.status });
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 160,
    render(row: any) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'tiny', type: 'primary', onClick: () => (window.location.href = `/cdn-domains/${row.id}/setting`) }, { default: () => '配置' }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => '删除' }),
        ],
      });
    },
  },
];

async function loadDomains() {
  loading.value = true;
  const res = await api<any>('GET', '/cdn/domains');
  domains.value = res.code === 0 ? res.data : [];
  loading.value = false;
}

async function loadAccounts() {
  const res = await api<any>('GET', '/cdn/accounts');
  if (res.code === 0) {
    accountOptions.value = res.data.map((a: any) => ({ label: `${a.id} - ${a.typename}（${a.name}）`, value: a.id }));
    for (const a of res.data) accountTypes.value[a.id] = a.type;
  }
}

async function loadDnsDomains() {
  const res = await api<any>('GET', '/domains');
  if (res.code === 0) dnsDomainOptions.value = res.data.map((d: any) => ({ label: d.name, value: d.id }));
}

async function onAccountChange(aid: number) {
  form.zone_id = null;
  zoneOptions.value = [];
  const type = accountTypes.value[aid];
  if (type === 'tencent_edgeone' || type === 'aliyun_esa') {
    const res = await api<any>('GET', `/cdn/accounts/${aid}/zones`);
    if (res.code === 0) zoneOptions.value = res.data.map((z: any) => ({ label: z.zoneName, value: z.zoneId }));
  }
}

function openAdd() {
  Object.assign(form, { aid: null, did: null, zone_id: null, name: '', origin: '', origin_type: 'ipaddr' });
  zoneOptions.value = [];
  showAdd.value = true;
}

async function doAdd() {
  if (!form.aid || !form.did || !form.name || !form.origin) return message.warning('请填写完整的账户、联动域名、加速域名和源站');
  if (isZoneType.value && !form.zone_id) return message.warning('请选择站点');
  saving.value = true;
  const res = await api('POST', '/cdn/domains', form);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showAdd.value = false;
    loadDomains();
  } else message.error(res.msg);
}

async function doSync() {
  if (!syncAid.value) return message.warning('请选择 CDN 账户');
  syncing.value = true;
  const res = await api('POST', '/cdn/sync', { aid: syncAid.value, did: syncDid.value });
  syncing.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showSync.value = false;
    loadDomains();
  } else message.error(res.msg);
}

function del(row: any) {
  dialog.warning({
    title: '删除加速域名',
    content: `确定删除 ${row.name} 吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('DELETE', `/cdn/domains/${row.id}`);
      if (res.code === 0) {
        message.success('删除成功');
        loadDomains();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadDomains();
  loadAccounts();
  loadDnsDomains();
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