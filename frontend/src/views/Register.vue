<template>
  <div class="login-wrap">
    <n-card class="register-card" :bordered="false">
      <div class="login-head">
        <n-icon size="40" :component="GlobeOutline" color="#3b6df0" />
        <h2>注册账号</h2>
        <p>聚合 DNS 管理系统</p>
      </div>

      <n-alert v-if="!loading && !config.enable" type="warning" style="margin-bottom: 16px">
        注册功能暂未开放，请联系管理员获取账号。
      </n-alert>

      <template v-else-if="!loading">
        <n-form :model="form" label-placement="top">
          <n-form-item label="用户名">
            <n-input v-model:value="form.username" placeholder="3-32 位字母、数字、下划线、点或横线" size="large" />
          </n-form-item>
          <n-form-item label="密码">
            <n-input v-model:value="form.password" type="password" show-password-on="click" placeholder="至少 6 位" size="large" />
          </n-form-item>
          <n-form-item label="确认密码">
            <n-input v-model:value="form.password2" type="password" show-password-on="click" placeholder="再次输入密码" size="large" />
          </n-form-item>

          <template v-if="config.mode === 'email'">
            <n-form-item label="邮箱">
              <n-input v-model:value="form.email" placeholder="用于接收验证码" size="large" />
            </n-form-item>
            <n-form-item label="邮箱验证码">
              <n-input-group>
                <n-input v-model:value="form.code" placeholder="6 位验证码" size="large" maxlength="6" />
                <n-button size="large" :disabled="countdown > 0 || sending" @click="onSendCode">
                  {{ countdown > 0 ? countdown + 's' : sending ? '发送中' : '发送验证码' }}
                </n-button>
              </n-input-group>
            </n-form-item>
          </template>

          <template v-else>
            <n-form-item label="注册码">
              <n-input v-model:value="form.reg_code" placeholder="请输入管理员提供的注册码" size="large" />
            </n-form-item>
            <n-form-item label="邮箱（可选）">
              <n-input v-model:value="form.email" placeholder="选填，用于接收通知" size="large" />
            </n-form-item>
          </template>

          <n-button type="primary" size="large" block :loading="registering" @click="onRegister">注 册</n-button>
        </n-form>
        <n-button text style="margin-top: 12px; width: 100%" @click="router.push('/login')">已有账号？返回登录</n-button>
      </template>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import { GlobeOutline } from '@vicons/ionicons5';
import { api } from '../api';

const router = useRouter();
const message = useMessage();
const loading = ref(true);
const registering = ref(false);
const sending = ref(false);
const countdown = ref(0);
const config = reactive<{ enable: boolean; mode: string }>({ enable: false, mode: 'email' });
const form = reactive({ username: '', password: '', password2: '', email: '', code: '', reg_code: '' });

let timer: any = null;

onMounted(async () => {
  try {
    const res = await api<any>('GET', '/register/config');
    if (res.code === 0) {
      config.enable = res.data.enable;
      config.mode = res.data.mode || 'email';
    }
  } catch {
    /* ignore */
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

async function onSendCode() {
  if (!form.email) {
    message.warning('请先填写邮箱地址');
    return;
  }
  sending.value = true;
  try {
    const res = await api<any>('POST', '/register/send-code', { email: form.email });
    if (res.code === 0) {
      message.success(res.msg);
      countdown.value = 60;
      timer = setInterval(() => {
        countdown.value--;
        if (countdown.value <= 0) clearInterval(timer);
      }, 1000);
    } else {
      message.error(res.msg);
    }
  } catch (e: any) {
    message.error(e.message || '网络错误');
  } finally {
    sending.value = false;
  }
}

async function onRegister() {
  if (form.username.length < 3) return message.warning('用户名至少 3 个字符');
  if (form.password.length < 6) return message.warning('密码至少 6 位');
  if (form.password !== form.password2) return message.warning('两次输入的密码不一致');
  if (config.mode === 'email' && !form.code) return message.warning('请输入邮箱验证码');
  if (config.mode === 'code' && !form.reg_code) return message.warning('请输入注册码');

  registering.value = true;
  try {
    const body: Record<string, string> = { username: form.username, password: form.password };
    if (config.mode === 'email') {
      body.email = form.email;
      body.code = form.code;
    } else {
      body.reg_code = form.reg_code;
      if (form.email) body.email = form.email;
    }
    const res = await api<any>('POST', '/register', body);
    if (res.code === 0) {
      message.success(res.msg);
      router.push('/login');
    } else {
      message.error(res.msg);
    }
  } catch (e: any) {
    message.error(e.message || '网络错误');
  } finally {
    registering.value = false;
  }
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
.register-card {
  width: 100%;
  max-width: 420px;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(59, 109, 240, 0.15);
}
.login-head {
  text-align: center;
  margin-bottom: 20px;
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