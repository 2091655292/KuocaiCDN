<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">{{ isEdit ? '编辑' : '添加' }}容灾切换策略</span>
          <n-button @click="$router.push('/dm-tasks')">
            <template #icon><n-icon :component="ArrowBackOutline" /></template>
            返回
          </n-button>
        </div>
      </template>

      <n-form label-placement="left" label-width="140" style="max-width: 720px">
        <n-form-item label="域名选择" :required>
          <n-space :size="4" style="width: 100%">
            <n-input v-model:value="form.rr" placeholder="主机记录" style="width: 200px" />
            <span>.</span>
            <n-select v-model:value="form.did" :options="domainOptions" placeholder="主域名" filterable style="flex: 1" @update:value="onDomainChange" />
          </n-space>
        </n-form-item>

        <n-form-item label="解析记录" :required>
          <n-space style="width: 100%">
            <n-select v-model:value="form.recordid" :options="recordOptions" placeholder="解析记录" filterable style="flex: 1" @update:value="onRecordChange" />
            <n-button @click="getRecordList" :loading="loadingRecords">获取</n-button>
          </n-space>
        </n-form-item>

        <n-form-item label="切换设置" :required>
          <n-radio-group v-model:value="form.type">
            <n-radio-button v-for="o in typeOptions" :key="o.value" :value="o.value">{{ o.label }}</n-radio-button>
          </n-radio-group>
        </n-form-item>

        <n-form-item v-show="form.type === 2" label="备用解析记录" :required>
          <n-input v-model:value="form.backup_value" placeholder="支持填写IP或CNAME地址" />
        </n-form-item>

        <n-form-item v-show="form.type === 2 && dnstype === 'cloudflare'" label="Cloudflare代理">
          <n-checkbox v-model:checked="form.cdn">切换时同时开启Cloudflare代理模式</n-checkbox>
        </n-form-item>

        <n-form-item v-show="form.type <= 2" label="检测协议" :required>
          <n-radio-group v-model:value="form.checktype">
            <n-radio-button v-for="o in checktypeOptions" :key="o.value" :value="o.value" :disabled="o.disabled">{{ o.label }}</n-radio-button>
          </n-radio-group>
        </n-form-item>

        <n-form-item v-show="form.type <= 2 && form.checktype < 2" label="指定检测IP">
          <n-input v-model:value="form.checkurl" placeholder="留空默认为解析记录值IP" />
        </n-form-item>

        <n-form-item v-show="form.type <= 2 && form.checktype === 1" label="TCP检测端口" :required>
          <n-input-number v-model:value="form.tcpport" :min="1" :max="65535" style="width: 220px" />
        </n-form-item>

        <n-form-item v-show="form.type <= 2 && form.checktype === 2" label="检测URL地址" :required>
          <n-input v-model:value="form.checkurl" placeholder="以http(s)://开头的完整地址，状态码须为2xx/3xx" />
        </n-form-item>

        <n-form-item v-show="form.type <= 2 && form.checktype === 2" label="使用代理请求">
          <n-radio-group v-model:value="form.proxy">
            <n-radio :value="0">否</n-radio>
            <n-radio :value="1">是</n-radio>
          </n-radio-group>
        </n-form-item>

        <n-form-item v-show="form.type <= 2 && form.checktype > 0" label="最大超时时间" :required>
          <n-input-number v-model:value="form.timeout" :min="1" style="width: 220px">
            <template #suffix>秒</template>
          </n-input-number>
        </n-form-item>

        <n-form-item v-show="form.type === 3" label="同域名正常数量" :required>
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-input-number v-model:value="form.cycle" :min="0" style="width: 220px" />
            </template>
            与暂停解析配合使用，当同域名正常记录数量&lt;=几条时开启解析
          </n-tooltip>
        </n-form-item>

        <n-form-item label="检测间隔" :required>
          <n-input-number v-model:value="form.frequency" :min="1" style="width: 220px">
            <template #suffix>秒</template>
          </n-input-number>
        </n-form-item>

        <n-form-item v-show="form.type <= 2" label="确认次数" :required>
          <n-input-number v-model:value="form.cycle" :min="1" style="width: 220px" />
        </n-form-item>

        <n-form-item label="备注">
          <n-input v-model:value="form.remark" placeholder="可留空" />
        </n-form-item>

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
const recordOptions = ref<any[]>([]);
const dnstype = ref<string | null>(null);
const loadingRecords = ref(false);
const saving = ref(false);
const pingDisabled = ref(false);

const form = reactive<any>({
  rr: '',
  did: null,
  recordid: null,
  recordinfo: '',
  main_value: '',
  type: 1,
  backup_value: '',
  checktype: 1,
  tcpport: 80,
  checkurl: '',
  frequency: 5,
  timeout: 2,
  cycle: 3,
  proxy: 0,
  cdn: false,
  remark: '',
});

const typeOptions = [
  { value: 0, label: '无操作' },
  { value: 1, label: '暂停解析' },
  { value: 2, label: '切换备用解析' },
  { value: 3, label: '条件开启解析' },
];
const checktypeOptions = computed(() => [
  { value: 0, label: 'PING', disabled: pingDisabled.value },
  { value: 1, label: 'TCP', disabled: false },
  { value: 2, label: 'HTTP(S)', disabled: false },
]);

async function loadDomains() {
  const res = await api<any>('GET', '/dmonitor/domains');
  if (res.code === 0) {
    domainOptions.value = res.data.map((d: any) => ({ label: d.name, value: d.id, type: d.type }));
  }
}

function onDomainChange() {
  const d = domainOptions.value.find((x) => x.value === form.did);
  dnstype.value = d ? d.type : null;
}

async function getRecordList() {
  if (!form.did) return message.warning('请先选择域名');
  if (!form.rr) return message.warning('主机记录不能为空');
  loadingRecords.value = true;
  const res = await api<any>('GET', `/domains/${form.did}/records`, { subdomain: form.rr, pagesize: 100 });
  loadingRecords.value = false;
  if (res.code === 0) {
    const list = res.data.list || [];
    recordOptions.value = list.map((r: any) => ({ label: `${r.Value} (${r.Type})`, value: r.RecordId, record: r }));
    message.success('获取到 ' + list.length + ' 条解析记录');
    if (form.recordid) {
      const found = list.find((r: any) => r.RecordId === form.recordid);
      if (found) fillRecord(found);
    }
  } else {
    message.error(res.msg);
  }
}

function fillRecord(record: any) {
  form.recordinfo = JSON.stringify({ Line: record.Line, TTL: record.TTL });
  form.main_value = typeof record.Value === 'object' ? (Array.isArray(record.Value) ? record.Value[0] : record.Value) : record.Value;
}

function onRecordChange() {
  const opt = recordOptions.value.find((x: any) => x.value === form.recordid);
  if (opt && opt.record) fillRecord(opt.record);
}

async function loadTask() {
  const res = await api<any>('GET', `/dmonitor/tasks/${editId.value}`);
  if (res.code === 0) {
    const t = res.data;
    form.rr = t.rr;
    form.did = t.did;
    form.recordid = t.recordid;
    form.recordinfo = t.recordinfo || '';
    form.main_value = t.main_value;
    form.type = t.type;
    form.backup_value = t.backup_value || '';
    form.checktype = t.checktype;
    form.tcpport = t.tcpport ?? 80;
    form.checkurl = t.checkurl || '';
    form.frequency = t.frequency;
    form.timeout = t.timeout;
    form.cycle = t.cycle;
    form.proxy = t.proxy;
    form.cdn = t.cdn === 1;
    form.remark = t.remark || '';
    onDomainChange();
    // 填充已选解析记录
    let info: any = {};
    try {
      info = JSON.parse(t.recordinfo || '{}');
    } catch {}
    recordOptions.value = [{ label: t.main_value, value: t.recordid, record: { RecordId: t.recordid, Value: t.main_value, Line: info.Line, TTL: info.TTL } }];
  } else {
    message.error(res.msg);
  }
}

async function submit() {
  if (!form.did || !form.rr || !form.recordid || !form.main_value || !form.frequency || !form.cycle) {
    return message.warning('必填项不能为空');
  }
  if (form.checktype > 0 && form.timeout > form.frequency) {
    return message.warning('为保障容灾切换任务正常运行，最大超时时间不能大于检测间隔');
  }
  if (form.type === 2 && form.backup_value === form.main_value) {
    return message.warning('主备地址不能相同');
  }
  saving.value = true;
  const body = {
    did: form.did,
    rr: form.rr,
    recordid: form.recordid,
    type: form.type,
    main_value: form.main_value,
    backup_value: form.backup_value,
    checktype: form.checktype,
    checkurl: form.checkurl,
    tcpport: form.tcpport,
    frequency: form.frequency,
    cycle: form.cycle,
    timeout: form.timeout,
    proxy: form.proxy,
    cdn: form.cdn,
    remark: form.remark,
    recordinfo: form.recordinfo,
  };
  const res = isEdit.value ? await api('PUT', `/dmonitor/tasks/${editId.value}`, body) : await api('POST', '/dmonitor/tasks', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    router.push('/dm-tasks');
  } else {
    message.error(res.msg);
  }
}

onMounted(async () => {
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
</style>