<template>
  <div>
    <n-card :bordered="false" style="max-width: 560px">
      <template #header>
        <div class="toolbar">
          <n-space align="center">
            <n-button quaternary circle @click="$router.back()"><template #icon><n-icon :component="ArrowBackOutline" /></template></n-button>
            <span class="title">安全设置 · TOTP 两步验证</span>
          </n-space>
        </div>
      </template>

      <n-result v-if="!enabled" status="info" title="未开启两步验证" description="开启后将使用动态口令进行二次验证，提升账户安全性">
        <template #footer>
          <n-button type="primary" :loading="loading" @click="generate">开启两步验证</n-button>
        </template>
      </n-result>

      <div v-if="step === 'bind'">
        <n-alert type="info" style="margin-bottom: 16px">请使用 Google Authenticator / Microsoft Authenticator 等 APP 扫描二维码，或手动输入密钥</n-alert>
        <n-space vertical align="center" style="width:100%">
          <div class="qr-box">
            <img v-if="qrcode" :src="qrDataUrl" alt="TOTP 二维码" />
            <n-spin v-else />
          </div>
          <n-input-group style="max-width: 380px">
            <n-input :value="secret" readonly />
            <n-button @click="copySecret">复制</n-button>
          </n-input-group>
          <n-input v-model:value="code" placeholder="输入 APP 显示的 6 位动态口令" maxlength="6" style="max-width: 380px" @keyup.enter="bind" />
          <n-space>
            <n-button @click="step = ''">取消</n-button>
            <n-button type="primary" :loading="loading" @click="bind">确认绑定</n-button>
          </n-space>
        </n-space>
      </div>

      <n-result v-if="enabled && step !== 'bind'" status="success" title="已开启两步验证" description="登录时将要求输入动态口令">
        <template #footer>
          <n-button type="error" :loading="loading" @click="close">关闭两步验证</n-button>
        </template>
      </n-result>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useMessage, useDialog } from 'naive-ui';
import { ArrowBackOutline } from '@vicons/ionicons5';
import { api } from '../api';
import QRCode from 'qrcode';

const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const step = ref('');
const enabled = ref(false);
const secret = ref('');
const qrcode = ref('');
const code = ref('');

const qrDataUrl = ref('');

async function refreshQr() {
  qrDataUrl.value = await QRCode.toDataURL(qrcode.value, { width: 200, margin: 1 });
}

async function generate() {
  loading.value = true;
  const res = await api<any>('POST', '/auth/totp-config', { action: 'generate' });
  loading.value = false;
  if (res.code === 0) {
    secret.value = res.data.secret;
    qrcode.value = res.data.qrcode;
    code.value = '';
    step.value = 'bind';
    await refreshQr();
  } else message.error(res.msg);
}

async function bind() {
  if (!code.value) return message.warning('请输入动态口令');
  loading.value = true;
  const res = await api('POST', '/auth/totp-config', { action: 'bind', secret: secret.value, code: code.value });
  loading.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    enabled.value = true;
    step.value = '';
  } else message.error(res.msg);
}

function close() {
  dialog.warning({
    title: '关闭两步验证',
    content: '确定要关闭 TOTP 两步验证吗？',
    positiveText: '关闭',
    negativeText: '取消',
    onPositiveClick: async () => {
      loading.value = true;
      const res = await api('POST', '/auth/totp-config', { action: 'close' });
      loading.value = false;
      if (res.code === 0) {
        message.success(res.msg);
        enabled.value = false;
      } else message.error(res.msg);
    },
  });
}

function copySecret() {
  navigator.clipboard?.writeText(secret.value).then(() => message.success('已复制')).catch(() => message.warning('复制失败，请手动复制'));
}

onMounted(async () => {
  const res = await api<any>('GET', '/auth/me');
  if (res.code === 0) enabled.value = res.data.totp_open == 1;
});
</script>

<style scoped>
.toolbar { display: flex; align-items: center; justify-content: space-between; }
.title { font-size: 16px; font-weight: 600; }
.qr-box {
  width: 220px;
  height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #eee;
  border-radius: 8px;
}
.qr-box img { width: 100%; height: 100%; }
</style>