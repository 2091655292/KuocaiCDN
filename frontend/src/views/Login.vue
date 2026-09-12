<template>
  <div class="login-wrap">
    <n-card class="login-card" :bordered="false">
      <div class="login-head">
        <n-icon size="40" :component="GlobeOutline" color="#3b6df0" />
        <h2>聚合 DNS 管理系统</h2>
        <p>多厂商 DNS 与 CDN 一体化管理</p>
      </div>
      <n-form v-if="!needTotp" :model="form" @keyup.enter="onLogin">
        <n-form-item label="用户名">
          <n-input v-model:value="form.username" placeholder="请输入用户名" size="large" />
        </n-form-item>
        <n-form-item label="密码">
          <n-input v-model:value="form.password" type="password" show-password-on="click" placeholder="请输入密码" size="large" />
        </n-form-item>
        <n-button type="primary" size="large" block :loading="loading" @click="onLogin">登 录</n-button>
        <n-button text style="margin-top: 12px; width: 100%" @click="router.push('/register')">没有账号？注册一个</n-button>
      </n-form>
      <div v-else>
        <n-alert type="info" style="margin-bottom: 16px">该账户已开启两步验证，请输入动态口令</n-alert>
        <n-form @keyup.enter="onTotp">
          <n-form-item label="动态口令">
            <n-input v-model:value="totpCode" placeholder="请输入 6 位动态口令" size="large" maxlength="6" />
          </n-form-item>
          <n-button type="primary" size="large" block :loading="loading" @click="onTotp">验 证</n-button>
        </n-form>
        <n-button style="margin-top:12px" text @click="resetLogin">返回登录</n-button>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import { GlobeOutline } from '@vicons/ionicons5';
import { api, setToken, setUser } from '../api';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const message = useMessage();
const auth = useAuthStore();
const loading = ref(false);
const form = reactive({ username: '', password: '' });
const needTotp = ref(false);
const preToken = ref('');
const totpCode = ref('');

async function doSuccess(res: any) {
  setToken(res.data.token);
  setUser(res.data.user);
  auth.setAuth(res.data.token, res.data.user);
  message.success(res.msg);
  router.push('/dashboard');
}

async function onLogin() {
  if (!form.username || !form.password) {
    message.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    const res = await api<any>('POST', '/auth/login', form);
    if (res.code === 0) {
      await doSuccess(res);
    } else if (res.vcode === 2) {
      needTotp.value = true;
      preToken.value = res.data?.pre_token || '';
      totpCode.value = '';
    } else {
      message.error(res.msg);
    }
  } catch (e: any) {
    message.error(e.message || '网络错误');
  } finally {
    loading.value = false;
  }
}

async function onTotp() {
  if (!totpCode.value) {
    message.warning('请输入动态口令');
    return;
  }
  loading.value = true;
  try {
    const res = await api<any>('POST', '/auth/totp', { pre_token: preToken.value, code: totpCode.value });
    if (res.code === 0) {
      await doSuccess(res);
    } else {
      message.error(res.msg);
    }
  } catch (e: any) {
    message.error(e.message || '网络错误');
  } finally {
    loading.value = false;
  }
}

function resetLogin() {
  needTotp.value = false;
  preToken.value = '';
  totpCode.value = '';
  form.password = '';
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #eef2ff 0%, #dbeafe 50%, #e0f2fe 100%);
  padding: 16px;
}
.login-card {
  width: 100%;
  max-width: 400px;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(59, 109, 240, 0.15);
}
.login-head {
  text-align: center;
  margin-bottom: 24px;
}
.login-head h2 {
  margin: 12px 0 4px;
  font-size: 20px;
}
.login-head p {
  margin: 0;
  color: #888;
  font-size: 13px;
}
</style>