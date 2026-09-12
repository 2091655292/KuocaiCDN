<template>
  <div>
    <n-card :bordered="false" style="max-width: 640px">
      <template #header>
        <div class="toolbar">
          <n-space align="center">
            <n-button quaternary circle @click="$router.back()"><template #icon><n-icon :component="ArrowBackOutline" /></template></n-button>
            <span class="title">域名到期提醒设置</span>
          </n-space>
        </div>
      </template>
      <n-form label-placement="left" label-width="150">
        <n-form-item label="到期提醒天数">
          <n-input v-model:value="form.expire_noticedays" placeholder="留空则不开启到期提醒" />
          <div class="hint">域名到期前多少天发送通知，可填写多个天数，用英文逗号隔开。例如填写 7,14 则在到期前 7 天与 14 天分别发送通知。</div>
        </n-form-item>
        <n-form-item label="邮件通知">
          <n-select v-model:value="form.expire_notice_mail" :options="onOffOptions" />
        </n-form-item>
        <n-form-item label="微信公众号通知">
          <n-select v-model:value="form.expire_notice_wxtpl" :options="onOffOptions" />
        </n-form-item>
        <n-form-item label="Telegram 机器人通知">
          <n-select v-model:value="form.expire_notice_tgbot" :options="onOffOptions" />
        </n-form-item>
        <n-form-item label="群机器人 Webhook">
          <n-select v-model:value="form.expire_notice_webhook" :options="onOffOptions" />
        </n-form-item>
        <n-form-item label="自定义 Webhook">
          <n-select v-model:value="form.expire_notice_custom_webhook" :options="onOffOptions" />
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
  expire_noticedays: '',
  expire_notice_mail: '0',
  expire_notice_wxtpl: '0',
  expire_notice_tgbot: '0',
  expire_notice_webhook: '0',
  expire_notice_custom_webhook: '0',
});

const onOffOptions = [
  { label: '关闭', value: '0' },
  { label: '开启', value: '1' },
];

async function load() {
  const res = await api<any>('GET', '/expire/settings');
  if (res.code === 0) Object.assign(form, res.data);
  else message.error(res.msg);
}

async function save() {
  saving.value = true;
  const res = await api('POST', '/expire/settings', { ...form });
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