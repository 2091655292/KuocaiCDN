<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">域名管理</span>
          <n-space>
            <n-button v-if="checked.length" size="small" type="success" @click="batchNotice(1)">开启提醒</n-button>
            <n-button v-if="checked.length" size="small" @click="batchNotice(0)">关闭提醒</n-button>
            <n-button @click="router.push('/expire-notice')">到期提醒设置</n-button>
            <n-button type="primary" @click="showImport = true">
              <template #icon><n-icon :component="CloudDownloadOutline" /></template>
              导入域名
            </n-button>
            <n-button @click="showCategory = true">添加分类</n-button>
          </n-space>
        </div>
      </template>
      <n-data-table
        :columns="columns"
        :data="domains"
        :loading="loading"
        :pagination="false"
        :bordered="false"
        :row-key="(row: any) => row.id"
        @update:checked-row-keys="(k: any[]) => (checked = k)"
      />
      <n-empty v-if="!loading && !domains.length" description="暂无域名，点击「导入域名」从 DNS 账户接入" />
    </n-card>

    <!-- 导入域名弹窗 -->
    <n-modal v-model:show="showImport" preset="card" title="导入域名" style="max-width:640px" :mask-closable="false">
      <n-form label-placement="left" label-width="90">
        <n-form-item label="DNS 账户">
          <n-select v-model:value="importAid" :options="accountOptions" placeholder="选择账户" @update:value="loadPullDomains" />
        </n-form-item>
        <n-form-item label="云端域名">
          <n-checkbox-group v-model:value="checkedDomains">
            <n-space vertical v-if="pullDomains.length">
              <n-checkbox v-for="d in pullDomains" :key="d.DomainId" :value="d" :label="d.Domain" />
            </n-space>
            <n-empty v-else description="请先选择账户拉取域名列表" size="small" style="width:100%" />
          </n-checkbox-group>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showImport = false">取消</n-button>
          <n-button type="primary" :loading="importing" @click="doImport">导入所选</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 添加分类弹窗 -->
    <n-modal v-model:show="showCategory" preset="card" title="添加分类" style="max-width:400px">
      <n-input v-model:value="categoryName" placeholder="分类名称" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCategory = false">取消</n-button>
          <n-button type="primary" @click="doAddCategory">确定</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NSpace, NTag, NEllipsis, useMessage, useDialog } from 'naive-ui';
import { CloudDownloadOutline, RefreshOutline } from '@vicons/ionicons5';
import { api } from '../api';

const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const domains = ref<any[]>([]);
const checked = ref<string[]>([]);
const accountOptions = ref<any[]>([]);
const pullDomains = ref<any[]>([]);
const checkedDomains = ref<any[]>([]);
const importAid = ref<number | null>(null);
const showImport = ref(false);
const showCategory = ref(false);
const categoryName = ref('');
const importing = ref(false);

const columns = [
  { type: 'selection', width: 40 },
  { title: 'ID', key: 'id', width: 60 },
  { title: '域名', key: 'name', render: (row: any) => h(NEllipsis, { style: 'max-width:220px' }, { default: () => row.name }) },
  { title: '分类', key: 'category_name', width: 120 },
  { title: '记录数', key: 'recordcount', width: 90 },
  {
    title: '到期时间',
    key: 'expiretime',
    width: 200,
    render(row: any) {
      const val = row.expiretime || '';
      const expired = val && new Date(val) < new Date();
      const text = val ? String(val).slice(0, 19) : (row.checkstatus === 2 ? '查询失败' : '未查询');
      const color = expired ? '#d03050' : row.checkstatus === 2 ? '#f0a020' : undefined;
      return h(NSpace, { size: 4, align: 'center' }, {
        default: () => [
          h('span', { style: color ? { color } : undefined }, text || '-'),
          h(NButton, {
            size: 'tiny',
            quaternary: true,
            title: '刷新到期时间',
            onClick: () => updateDate(row),
          }, { icon: () => h(RefreshOutline) }),
        ],
      });
    },
  },
  {
    title: '到期提醒',
    key: 'is_notice',
    width: 100,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.is_notice == 1 ? 'success' : 'default', bordered: false, onClick: () => toggleNotice(row), style: 'cursor:pointer' }, { default: () => (row.is_notice == 1 ? '已开启' : '未开启') });
    },
  },
  { title: '添加时间', key: 'addtime', width: 170 },
  {
    title: '操作',
    key: 'actions',
    width: 200,
    render(row: any) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', type: 'primary', onClick: () => gotoRecords(row) }, { default: () => '解析记录' }),
          h(NButton, { size: 'small', type: 'error', onClick: () => delDomain(row) }, { default: () => '删除' }),
        ],
      });
    },
  },
];

async function loadDomains() {
  loading.value = true;
  const res = await api<any>('GET', '/domains');
  domains.value = res.code === 0 ? res.data : [];
  loading.value = false;
}

async function loadAccounts() {
  const res = await api<any>('GET', '/dns/accounts');
  if (res.code === 0) {
    accountOptions.value = res.data.map((a: any) => ({ label: `${a.id} - ${a.type}（${a.name}）`, value: a.id }));
  }
}

async function loadPullDomains(aid: number) {
  const res = await api<any>('GET', `/dns/accounts/${aid}/pull`);
  if (res.code === 0) pullDomains.value = res.data;
  else {
    pullDomains.value = [];
    message.error(res.msg);
  }
}

async function doImport() {
  if (!importAid.value || !checkedDomains.value.length) {
    message.warning('请选择账户和域名');
    return;
  }
  importing.value = true;
  const results = await Promise.all(
    checkedDomains.value.map((d: any) =>
      api('POST', '/domains', { aid: importAid.value, domain: d.Domain, thirdid: d.DomainId, recordcount: d.RecordCount || 0 }),
    ),
  );
  importing.value = false;
  const ok = results.filter((r: any) => r.code === 0).length;
  message.success(`成功导入 ${ok} 个域名`);
  checkedDomains.value = [];
  pullDomains.value = [];
  showImport.value = false;
  loadDomains();
}

async function doAddCategory() {
  if (!categoryName.value) return message.warning('请输入分类名');
  const res = await api('POST', '/domains/categories', { name: categoryName.value });
  if (res.code === 0) {
    message.success('添加成功');
    showCategory.value = false;
    categoryName.value = '';
  } else message.error(res.msg);
}

function gotoRecords(row: any) {
  window.open(`/domains/${row.id}/records`, '_self');
}

async function toggleNotice(row: any) {
  const target = row.is_notice == 1 ? 0 : 1;
  const res = await api('POST', '/domains/batch-notice', { ids: [row.id], is_notice: target });
  if (res.code === 0) {
    message.success(res.msg);
    loadDomains();
  } else message.error(res.msg);
}

async function batchNotice(isNotice: number) {
  if (!checked.value.length) return message.warning('请选择域名');
  const res = await api('POST', '/domains/batch-notice', { ids: checked.value.map(Number), is_notice: isNotice });
  if (res.code === 0) {
    message.success(res.msg);
    loadDomains();
  } else message.error(res.msg);
}

async function updateDate(row: any) {
  message.loading('正在查询 WHOIS 到期时间...');
  const res = await api('POST', `/domains/${row.id}/update-date`);
  message.destroyAll();
  if (res.code === 0) {
    message.success('刷新成功');
    loadDomains();
  } else message.error(res.msg);
}

function delDomain(row: any) {
  dialog.warning({
    title: '删除域名',
    content: `确定删除域名 ${row.name} 吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('DELETE', `/domains/${row.id}`);
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