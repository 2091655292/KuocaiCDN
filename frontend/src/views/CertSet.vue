<template>
  <div>
    <n-card :bordered="false" style="max-width: 640px">
      <template #header>
        <div class="toolbar">
          <n-space align="center">
            <n-button quaternary circle @click="$router.back()"><template #icon><n-icon :component="ArrowBackOutline" /></template></n-button>
            <span class="title">SSL 证书计划任务设置</span>
          </n-space>
        </div>
      </template>

      <n-h4>自动续签</n-h4>
      <n-form label-placement="left" label-width="150">
        <n-form-item label="到期前续签天数">
          <n-input-number v-model:value="form.cert_renewdays" :min="1" style="width:200px" />
          <div class="hint">证书到期前多少天自动续签（仅对开启自动续签的证书生效）</div>
        </n-form-item>
      </n-form>
      <n-divider />

      <n-h4>自动部署时段</n-h4>
      <n-form label-placement="left" label-width="150">
        <n-form-item label="运行时段（小时）">
          <n-space align="center">
            <n-select v-model:value="form.deploy_hour_start" :options="hourOptions" style="width:100px" />
            <span>—</span>
            <n-select v-model:value="form.deploy_hour_end" :options="hourOptions" style="width:100px" />
          </n-space>
        </n-form-item>
      </n-form>
      <n-divider />

      <n-h4>通知设置</n-h4>
      <n-form label-placement="left" label-width="150">
        <n-form-item label="邮件通知">
          <n-select v-model:value="form.cert_notice_mail" :options="noticeOptions" />
        </n-form-item>
        <n-form-item label="微信公众号通知">
          <n-select v-model:value="form.cert_notice_wxtpl" :options="noticeOptions" />
        </n-form-item>
        <n-form-item label="Telegram 通知">
          <n-select v-model:value="form.cert_notice_tgbot" :options="noticeOptions" />
        </n-form-item>
        <n-form-item label="群机器人 Webhook">
          <n-select v-model:value="form.cert_notice_webhook" :options="onOffOptions" />
        </n-form-item>
        <n-form-item label="自定义 Webhook">
          <n-select v-model:value="form.cert_notice_custom_webhook" :options="noticeOptions" />
        </n-form-item>
      </n-form>

      <template #footer>
        <n-space justify="end">
          <n-button @click="$router.back()">返回</n-button>
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
        </n-space>
      </template>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { ArrowBackOutline } from '@vicons/ionicons5';
import { api } from '../api';

const message = useMessage();
const saving = ref(false);
const form = reactive<any>({
  cert_renewdays: 7,
  deploy_hour_start: '0',
  deploy_hour_end: '23',
  cert_notice_mail: '0',
  cert_notice_wxtpl: '0',
  cert_notice_tgbot: '0',
  cert_notice_webhook: '0',
  cert_notice_custom_webhook: '0',
});

const hourOptions = Array.from({ length: 24 }, (_, i) => ({ label: String(i), value: String(i) }));
const onOffOptions = [
  { label: '关闭', value: '0' },
  { label: '开启', value: '1' },
];
const noticeOptions = [
  { label: '关闭', value: '0' },
  { label: '开启', value: '1' },
  { label: '开启（仅失败时）', value: '2' },
];

async function load() {
  const res = await api<any>('GET', '/cert/settings');
  if (res.code === 0) Object.assign(form, res.data);
  else message.error(res.msg);
}

async function save() {
  saving.value = true;
  const res = await api('POST', '/cert/settings', { ...form });
  saving.value = false;
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}

onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; align-items: center; justify-content: space-between; }
.title { font-size: 16px; font-weight: 600; }
.hint { color: #18a058; font-size: 12px; margin-top: 4px; }
</style>