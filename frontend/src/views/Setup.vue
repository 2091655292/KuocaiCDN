<template>
  <div class="setup-wrap">
    <n-card class="setup-card" :bordered="false">
      <div class="setup-head">
        <n-icon size="40" :component="ServerOutline" color="#3b6df0" />
        <h2>系统安装</h2>
        <p>聚合 DNS 管理系统 · 初始化配置</p>
      </div>

      <n-alert v-if="detected" type="info" style="margin-bottom: 16px">
        检测到数据库已存在数据（彩虹 DNS），本次安装将绑定现有数据库，不会删除或覆盖原有数据。
      </n-alert>
      <n-alert v-else-if="checked" type="success" style="margin-bottom: 16px">
        数据库连接成功，将进行全新安装。
      </n-alert>

      <n-form :model="form" label-placement="top">
        <n-form-item label="数据库主机">
          <n-input v-model:value="form.db_host" placeholder="127.0.0.1 或容器服务名" />
        </n-form-item>
        <n-form-item label="数据库端口">
          <n-input-number v-model:value="form.db_port" :min="1" :max="65535" style="width: 100%" />
        </n-form-item>
        <n-form-item label="数据库用户名">
          <n-input v-model:value="form.db_user" placeholder="数据库账号" />
        </n-form-item>
        <n-form-item label="数据库密码">
          <n-input v-model:value="form.db_password" type="password" show-password-on="click" placeholder="数据库密码" />
        </n-form-item>
        <n-form-item label="数据库名">
          <n-input v-model:value="form.db_name" placeholder="需提前创建好的数据库名" />
        </n-form-item>
        <n-form-item label="表前缀">
          <n-input v-model:value="form.db_prefix" placeholder="默认 dnsmgr_，绑定彩虹 DNS 请填其前缀" />
        </n-form-item>

        <n-divider title-placement="left">管理员账号（绑定已有数据时无需填写）</n-divider>

        <n-form-item label="管理员账号">
          <n-input v-model:value="form.admin_username" placeholder="仅全新安装时需要" />
        </n-form-item>
        <n-form-item label="管理员密码">
          <n-input v-model:value="form.admin_password" type="password" show-password-on="click" placeholder="仅全新安装时需要" />
        </n-form-item>

        <n-space vertical>
          <n-button block :loading="checking" @click="onCheck">测试数据库连接</n-button>
          <n-button type="primary" block :loading="installing" @click="onInstall">立即安装</n-button>
        </n-space>
      </n-form>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import { ServerOutline } from '@vicons/ionicons5';
import { api } from '../api';

const router = useRouter();
const message = useMessage();
const checking = ref(false);
const installing = ref(false);
const checked = ref(false);
const detected = ref(false);
const form = reactive({
  db_host: '127.0.0.1',
  db_port: 3306,
  db_user: '',
  db_password: '',
  db_name: 'dnsmgr',
  db_prefix: 'dnsmgr_',
  admin_username: 'admin',
  admin_password: '',
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function onCheck() {
  if (!form.db_host || !form.db_user || !form.db_name) {
    message.warning('请完整填写数据库主机、用户名和数据库名');
    return;
  }
  checking.value = true;
  try {
    const res = await api<any>('POST', '/setup/check', form);
    if (res.code === 0) {
      checked.value = true;
      detected.value = !!res.data.initialized;
      message.success(res.msg);
    } else {
      checked.value = false;
      detected.value = false;
      message.error(res.msg);
    }
  } catch (e: any) {
    message.error(e.message || '网络错误');
  } finally {
    checking.value = false;
  }
}

async function onInstall() {
  if (!form.db_host || !form.db_user || !form.db_name) {
    message.warning('请完整填写数据库连接信息');
    return;
  }
  if (!detected.value && (!form.admin_username || !form.admin_password)) {
    message.warning('全新安装需要设置管理员账号和密码，或先点击「测试连接」检测已有数据');
    return;
  }
  installing.value = true;
  try {
    const res = await api<any>('POST', '/setup/install', form);
    if (res.code === 0) {
      message.success(res.msg);
      await waitRestart();
    } else {
      message.error(res.msg);
    }
  } catch (e: any) {
    message.error(e.message || '网络错误');
  } finally {
    installing.value = false;
  }
}

async function waitRestart() {
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    try {
      const res = await fetch('/api/setup/status');
      const json = await res.json();
      if (json?.data?.installed) {
        message.success('安装完成，请登录');
        router.push('/login');
        return;
      }
    } catch {
      // 进程重启中，继续等待
    }
  }
  message.warning('应用仍在启动中，请稍后刷新页面');
}

onMounted(async () => {
  try {
    const res = await api<any>('GET', '/setup/status');
    if (res.code === 0 && res.data?.installed) {
      router.replace('/login');
    }
  } catch {
    /* ignore */
  }
});
</script>

<style scoped>
.setup-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #eef2ff 0%, #dbeafe 50%, #e0f2fe 100%);
  padding: 16px;
}
.setup-card {
  width: 100%;
  max-width: 520px;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(59, 109, 240, 0.15);
}
.setup-head {
  text-align: center;
  margin-bottom: 20px;
}
.setup-head h2 {
  margin: 12px 0 4px;
  font-size: 20px;
}
.setup-head p {
  margin: 0;
  color: #888;
  font-size: 13px;
}
</style>