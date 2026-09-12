<template>
  <div>
    <n-card :bordered="false">
      <template #header>
        <div class="toolbar">
          <span class="title">{{ isEdit ? '编辑' : '添加' }}定时切换策略</span>
          <n-button @click="$router.push('/schedule-tasks')">
            <template #icon><n-icon :component="ArrowBackOutline" /></template>
            返回
          </n-button>
        </div>
      </template>

      <n-form label-placement="left" label-width="140" style="max-width: 760px">
        <n-form-item label="域名选择" required>
          <n-space :size="4" style="width: 100%">
            <n-input v-model:value="form.rr" placeholder="主机记录" style="width: 200px" />
            <span>.</span>
            <n-select v-model:value="form.did" :options="domainOptions" placeholder="主域名" filterable style="flex: 1" @update:value="onDomainChange" />
          </n-space>
        </n-form-item>

        <n-form-item label="解析记录" required>
          <n-space style="width: 100%">
            <n-select v-model:value="form.recordid" :options="recordOptions" placeholder="解析记录" filterable style="flex: 1" @update:value="onRecordChange" />
            <n-button @click="getRecordList" :loading="loadingRecords">获取</n-button>
          </n-space>
        </n-form-item>

        <n-form-item label="执行方式" required>
          <n-radio-group v-model:value="form.type">
            <n-radio-button :value="0">单次执行</n-radio-button>
            <n-radio-button :value="1">周期执行</n-radio-button>
          </n-radio-group>
        </n-form-item>

        <n-form-item v-show="form.type === 0" label="时间设置" required>
          <input v-model="form.switchtime" type="datetime-local" class="native-input" />
        </n-form-item>

        <n-form-item v-show="form.type === 1" label="时间设置" required>
          <n-space>
            <n-select v-model:value="form.cycle" :options="cycleOptions" style="width: 120px" />
            <n-select v-if="form.cycle === 1" v-model:value="form.switchdate" :options="weekdayOptions" style="width: 120px" />
            <n-input-number v-else-if="form.cycle === 2" v-model:value="switchdateNum" :min="1" :max="31" style="width: 120px" placeholder="日期1~31" />
            <input v-if="form.cycle !== 2" v-model="form.switchtime" type="time" class="native-input" />
            <input v-else v-model="form.switchtime" type="time" class="native-input" />
          </n-space>
        </n-form-item>

        <n-form-item label="切换设置" required>
          <n-radio-group v-model:value="form.switchtype">
            <n-radio-button :value="0">修改解析</n-radio-button>
            <n-radio-button :value="1">启用解析</n-radio-button>
            <n-radio-button :value="2">暂停解析</n-radio-button>
            <n-radio-button v-if="form.type === 0" :value="3">删除解析</n-radio-button>
          </n-radio-group>
        </n-form-item>

        <n-form-item v-show="form.switchtype === 0" label="记录值" required>
          <n-input v-model:value="form.value" placeholder="支持填写IP或CNAME地址" />
        </n-form-item>

        <n-form-item v-show="form.switchtype === 0 && dnstype === 'cloudflare'" label="线路">
          <n-radio-group v-model:value="form.line">
            <n-radio value="">不修改</n-radio>
            <n-radio value="0">改为仅DNS模式</n-radio>
            <n-radio value="1">改为代理模式</n-radio>
          </n-radio-group>
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
const switchdateNum = ref<number | null>(null);

const form = reactive<any>({
  rr: '',
  did: null,
  recordid: null,
  recordinfo: '',
  type: 0,
  cycle: 0,
  switchtype: 0,
  switchdate: '',
  switchtime: '',
  value: '',
  line: '',
  remark: '',
});

const cycleOptions = [
  { label: '每天', value: 0 },
  { label: '每周', value: 1 },
  { label: '每月', value: 2 },
];
const weekdayOptions = [
  { label: '周日', value: '0' },
  { label: '周一', value: '1' },
  { label: '周二', value: '2' },
  { label: '周三', value: '3' },
  { label: '周四', value: '4' },
  { label: '周五', value: '5' },
  { label: '周六', value: '6' },
];

async function loadDomains() {
  const res = await api<any>('GET', '/schedule/domains');
  if (res.code === 0) domainOptions.value = res.data.map((d: any) => ({ label: d.name, value: d.id, type: d.type }));
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
  } else message.error(res.msg);
}

function fillRecord(record: any) {
  form.recordinfo = JSON.stringify({ Value: record.Value, Line: record.Line, TTL: record.TTL });
}

function onRecordChange() {
  const opt = recordOptions.value.find((x: any) => x.value === form.recordid);
  if (opt && opt.record) fillRecord(opt.record);
}

async function loadTask() {
  const res = await api<any>('GET', `/schedule/tasks/${editId.value}`);
  if (res.code === 0) {
    const t = res.data;
    form.rr = t.rr;
    form.did = t.did;
    form.recordid = t.recordid;
    form.recordinfo = t.recordinfo || '';
    form.type = t.type;
    form.cycle = t.cycle;
    form.switchtype = t.switchtype;
    form.switchdate = String(t.switchdate ?? '');
    form.switchtime = t.switchtime || '';
    form.value = t.value || '';
    form.line = t.line || '';
    form.remark = t.remark || '';
    if (form.cycle === 2) switchdateNum.value = parseInt(t.switchdate) || null;
    onDomainChange();
    let info: any = {};
    try {
      info = JSON.parse(t.recordinfo || '{}');
    } catch {}
    recordOptions.value = [{ label: info.Value || t.value, value: t.recordid, record: { RecordId: t.recordid, Value: info.Value, Line: info.Line, TTL: info.TTL } }];
  } else message.error(res.msg);
}

async function submit() {
  if (!form.did || !form.rr || !form.recordid) return message.warning('必填项不能为空');
  const body: any = { ...form };
  if (form.type === 1 && form.cycle === 2) body.switchdate = String(switchdateNum.value ?? 1);
  saving.value = true;
  const res = isEdit.value ? await api('PUT', `/schedule/tasks/${editId.value}`, body) : await api('POST', '/schedule/tasks', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    router.push('/schedule-tasks');
  } else message.error(res.msg);
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
.native-input {
  height: 34px;
  padding: 0 10px;
  border: 1px solid #d9d9d9;
  border-radius: 3px;
  font-size: 14px;
  color: #333;
  background: #fff;
}
</style>