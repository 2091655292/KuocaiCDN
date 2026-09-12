<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">{{ isEdit ? '编辑' : '添加' }}优选IP任务</span>
          <n-button @click="$router.push('/optimize-tasks')">
            <template #icon><n-icon :component="ArrowBackOutline" /></template>
            返回
          </n-button>
        </div>
      </template>

      <n-form label-placement="left" label-width="140" style="max-width: 720px">
        <n-form-item label="域名选择" required>
          <n-space :size="4" style="width: 100%">
            <n-input v-model:value="form.rr" placeholder="主机记录" style="width: 200px" />
            <span>.</span>
            <n-select v-model:value="form.did" :options="domainOptions" placeholder="主域名" filterable style="flex: 1" />
          </n-space>
        </n-form-item>

        <n-form-item label="CDN服务商" required>
          <n-radio-group v-model:value="form.cdn_type">
            <n-radio-button v-for="(v, k) in cdnTypeList" :key="k" :value="Number(k)">{{ v }}</n-radio-button>
          </n-radio-group>
        </n-form-item>

        <n-form-item label="解析线路类型" required>
          <n-radio-group v-model:value="form.type">
            <n-radio-button :value="0">
              电信/联通/移动
              <n-tooltip trigger="hover">用于已在CF添加，需优化三网访问速度的域名</n-tooltip>
            </n-radio-button>
            <n-radio-button :value="1">
              默认/联通/移动
              <n-tooltip trigger="hover">将电信优选IP解析到默认线路，用于给其他域名提供CNAME服务</n-tooltip>
            </n-radio-button>
          </n-radio-group>
        </n-form-item>

        <n-form-item label="解析IP类型" required>
          <n-space>
            <n-checkbox v-for="o in ipTypeList" :key="o.value" :checked="ipTypeSelect.includes(o.value)" :disabled="o.value === 'v6' && isXingpingcn" @update:checked="(v: boolean) => toggleIpType(o.value, v)">
              {{ o.label }}<span v-if="o.value === 'v6' && isXingpingcn" class="tip-text">(xingpingcn.top不支持)</span>
            </n-checkbox>
          </n-space>
        </n-form-item>

        <n-form-item label="每线路解析数量" required>
          <n-input-number v-model:value="form.recordnum" :min="1" :max="50" style="width: 220px" />
        </n-form-item>

        <n-form-item label="TTL" required>
          <n-input-number v-model:value="form.ttl" :min="1" :max="3600" style="width: 220px" />
        </n-form-item>

        <n-form-item label="备注">
          <n-input v-model:value="form.remark" placeholder="可留空" />
        </n-form-item>

        <n-alert v-show="form.type === 0" type="info" style="margin-bottom: 12px">
          提示：所选域名需保留一个默认线路的解析记录，指向所选CDN服务商提供的CNAME地址，其他线路的解析记录需要删除，添加任务后将自动添加电信/联通/移动线路的解析记录。
        </n-alert>
        <n-alert v-show="form.type === 1" type="info" style="margin-bottom: 12px">
          提示：所选域名需删除全部解析记录，添加任务后将自动为当前域名添加解析记录。
        </n-alert>

        <n-form-item>
          <n-button type="primary" :loading="saving" @click="submit">提交</n-button>
        </n-form-item>
      </n-form>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMessage } from 'naive-ui';
import { ArrowBackOutline } from '@vicons/ionicons5';
import { api } from '../api';

const route = useRoute();
const router = useRouter();
const message = useMessage();

const isEdit = computed(() => !!route.params.id && route.path.includes('/edit'));
const editId = computed(() => Number(route.params.id));

const domainOptions = ref<any[]>([]);
const saving = ref(false);
const optimizeIpApi = ref('0');
const ipTypeSelect = ref<string[]>(['v4']);

const cdnTypeList: Record<number, string> = { 1: 'CloudFlare', 2: 'CloudFront', 4: 'EdgeOne' };
const ipTypeList = [
  { value: 'v4', label: 'IPv4(A记录)' },
  { value: 'v6', label: 'IPv6(AAAA记录)' },
];

const isXingpingcn = computed(() => optimizeIpApi.value === '2');

const form = reactive<any>({
  rr: '',
  did: null,
  type: 0,
  cdn_type: 1,
  ip_type: 'v4',
  recordnum: 2,
  ttl: 600,
  remark: '',
});

function toggleIpType(v: string, checked: boolean) {
  if (checked) {
    if (v === 'v6' && isXingpingcn.value) return;
    if (!ipTypeSelect.value.includes(v)) ipTypeSelect.value.push(v);
  } else {
    ipTypeSelect.value = ipTypeSelect.value.filter((x) => x !== v);
  }
  form.ip_type = ipTypeSelect.value.join(',') || 'v4';
}

async function loadDomains() {
  const res = await api<any>('GET', '/optimize/domains');
  if (res.code === 0) domainOptions.value = res.data.map((d: any) => ({ label: d.name, value: d.id }));
}

async function loadSettings() {
  const res = await api<any>('GET', '/optimize/settings');
  if (res.code === 0) optimizeIpApi.value = res.data.optimize_ip_api;
}

async function loadTask() {
  const res = await api<any>('GET', `/optimize/tasks/${editId.value}`);
  if (res.code === 0) {
    const t = res.data;
    form.rr = t.rr;
    form.did = t.did;
    form.type = t.type;
    form.cdn_type = t.cdn_type;
    form.ip_type = t.ip_type;
    form.recordnum = t.recordnum;
    form.ttl = t.ttl;
    form.remark = t.remark || '';
    ipTypeSelect.value = String(t.ip_type || 'v4').split(',').filter(Boolean);
  } else message.error(res.msg);
}

async function submit() {
  if (!form.did || !form.rr || !form.ip_type || !form.recordnum || !form.ttl) {
    return message.warning('必填项不能为空');
  }
  saving.value = true;
  const body = { ...form, ip_type: ipTypeSelect.value.join(',') };
  const res = isEdit.value ? await api('PUT', `/optimize/tasks/${editId.value}`, body) : await api('POST', '/optimize/tasks', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    router.push('/optimize-tasks');
  } else message.error(res.msg);
}

onMounted(async () => {
  await loadSettings();
  await loadDomains();
  if (isEdit.value) await loadTask();
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
.tip-text {
  color: #999;
  font-size: 12px;
}
</style>