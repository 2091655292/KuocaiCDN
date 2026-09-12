<template>
  <div>
    <n-card :bordered="false">
      <n-tabs type="line" animated>
        <!-- 通知设置 -->
        <n-tab-pane name="notice" tab="通知设置">
          <n-card title="发信邮箱" :bordered="false" size="small" style="margin-bottom:16px">
            <n-form label-placement="left" label-width="110">
              <n-form-item label="发信模式">
                <n-select v-model:value="cfg.mail_type" :options="mailTypeOptions" style="width: 260px" />
              </n-form-item>
              <template v-if="(cfg.mail_type || '0') === '0'">
                <n-form-item label="SMTP服务器"><n-input v-model:value="cfg.mail_smtp" /></n-form-item>
                <n-form-item label="SMTP端口"><n-input v-model:value="cfg.mail_port" /></n-form-item>
                <n-form-item label="邮箱账号"><n-input v-model:value="cfg.mail_name" /></n-form-item>
                <n-form-item label="邮箱密码"><n-input v-model:value="cfg.mail_pwd" type="password" show-password-on="click" /></n-form-item>
              </template>
              <template v-else>
                <n-form-item label="API_USER"><n-input v-model:value="cfg.mail_apiuser" /></n-form-item>
                <n-form-item label="API_KEY"><n-input v-model:value="cfg.mail_apikey" /></n-form-item>
                <n-form-item label="发信邮箱"><n-input v-model:value="cfg.mail_name" /></n-form-item>
              </template>
              <n-form-item label="收信邮箱">
                <n-input v-model:value="cfg.mail_recv" placeholder="不填默认为发信邮箱" />
              </n-form-item>
              <n-form-item>
                <n-space>
                  <n-button type="primary" :loading="saving" @click="saveMail">保存</n-button>
                  <n-button @click="testMail">发送测试邮件</n-button>
                </n-space>
              </n-form-item>
            </n-form>
          </n-card>

          <n-card title="微信公众号消息接口（WxPusher）" :bordered="false" size="small" style="margin-bottom:16px">
            <n-form label-placement="left" label-width="110">
              <n-form-item label="appToken"><n-input v-model:value="cfg.wechat_apptoken" /></n-form-item>
              <n-form-item label="用户UID"><n-input v-model:value="cfg.wechat_appuid" /></n-form-item>
              <n-form-item>
                <n-button type="primary" :loading="saving" @click="saveFields(['wechat_apptoken', 'wechat_appuid'])">保存</n-button>
              </n-form-item>
            </n-form>
          </n-card>

          <n-card title="Telegram机器人接口" :bordered="false" size="small" style="margin-bottom:16px">
            <n-form label-placement="left" label-width="110">
              <n-form-item label="Token"><n-input v-model:value="cfg.tgbot_token" /></n-form-item>
              <n-form-item label="Chat Id"><n-input v-model:value="cfg.tgbot_chatid" /></n-form-item>
              <n-form-item label="Topic Id"><n-input v-model:value="cfg.tgbot_topicid" placeholder="非必填" /></n-form-item>
              <n-form-item label="使用代理">
                <n-select v-model:value="cfg.tgbot_proxy" :options="tgbotProxyOptions" style="width: 200px" />
              </n-form-item>
              <n-form-item v-if="(cfg.tgbot_proxy || '0') === '2'" label="反代URL">
                <n-input v-model:value="cfg.tgbot_url" placeholder="默认为：https://api.telegram.org" />
              </n-form-item>
              <n-form-item>
                <n-space>
                  <n-button type="primary" :loading="saving" @click="saveFields(['tgbot_token', 'tgbot_chatid', 'tgbot_topicid', 'tgbot_proxy', 'tgbot_url'])">保存</n-button>
                  <n-button @click="testTgbot">发送测试消息</n-button>
                </n-space>
              </n-form-item>
            </n-form>
          </n-card>

          <n-card title="群机器人 Webhook（企微/钉钉/飞书）" :bordered="false" size="small" style="margin-bottom:16px">
            <n-form label-placement="left" label-width="110">
              <n-form-item label="Webhook地址"><n-input v-model:value="cfg.webhook_url" /></n-form-item>
              <n-form-item label="@用户手机号"><n-input v-model:value="cfg.webhook_user" placeholder="非必填，@全体填all" /></n-form-item>
              <n-form-item>
                <n-space>
                  <n-button type="primary" :loading="saving" @click="saveFields(['webhook_url', 'webhook_user'])">保存</n-button>
                  <n-button @click="testWebhook">发送测试消息</n-button>
                </n-space>
              </n-form-item>
            </n-form>
          </n-card>

          <n-card title="自定义 Webhook" :bordered="false" size="small">
            <n-form label-placement="left" label-width="110">
              <n-form-item label="Webhook地址">
                <n-input v-model:value="cfg.custom_webhook_url" placeholder="https://example.com/webhook" />
              </n-form-item>
              <n-form-item label="请求方式">
                <n-select v-model:value="cfg.custom_webhook_method" :options="methodOptions" style="width: 200px" />
              </n-form-item>
              <n-form-item label="Content-Type">
                <n-select v-model:value="cfg.custom_webhook_content_type" :options="contentTypeOptions" style="width: 220px" />
              </n-form-item>
              <n-form-item label="自定义Headers">
                <n-input v-model:value="cfg.custom_webhook_headers" type="textarea" :rows="3" placeholder="每行一个，格式：HeaderName: HeaderValue" />
              </n-form-item>
              <n-form-item label="请求Body">
                <n-input v-model:value="cfg.custom_webhook_body" type="textarea" :rows="4" placeholder='{"title":"{title}","content":"{content}"}' />
              </n-form-item>
              <n-form-item label="内容格式">
                <n-select v-model:value="cfg.custom_webhook_content_format" :options="contentFormatOptions" style="width: 200px" />
              </n-form-item>
              <n-form-item>
                <n-space>
                  <n-button type="primary" :loading="saving" @click="saveFields(customWebhookFields)">保存</n-button>
                  <n-button @click="testCustomWebhook">发送测试消息</n-button>
                </n-space>
              </n-form-item>
            </n-form>
          </n-card>
        </n-tab-pane>

        <!-- 登录设置 -->
        <n-tab-pane name="login" tab="登录设置">
          <n-card title="登录验证码设置" :bordered="false" size="small" style="max-width:520px">
            <n-form label-placement="left" label-width="110">
              <n-form-item label="开启图形验证码">
                <n-switch :value="cfg.vcode !== '2'" @update:value="setVcode" />
              </n-form-item>
            </n-form>
          </n-card>
        </n-tab-pane>

        <!-- 注册设置 -->
        <n-tab-pane name="register" tab="注册设置">
          <n-card title="注册配置" :bordered="false" size="small" style="max-width:520px;margin-bottom:16px">
            <n-form label-placement="left" label-width="110">
              <n-form-item label="开启注册">
                <n-switch :value="(cfg.register_enable || '0') === '1'" @update:value="setRegisterEnable" />
              </n-form-item>
              <n-form-item label="注册方式">
                <n-select v-model:value="cfg.register_mode" :options="registerModeOptions" style="width: 200px" />
              </n-form-item>
              <n-form-item>
                <n-button type="primary" :loading="saving" @click="saveRegister">保存</n-button>
              </n-form-item>
            </n-form>
          </n-card>

          <n-card title="注册码管理" :bordered="false" size="small">
            <template #header-extra>
              <n-button type="primary" size="small" @click="showGen = true">生成注册码</n-button>
            </template>
            <n-data-table
              :columns="regCodeColumns"
              :data="regCodes"
              :loading="regCodesLoading"
              :bordered="false"
              :row-key="(row: any) => row.id"
            />
          </n-card>
        </n-tab-pane>

        <!-- 代理设置 -->
        <n-tab-pane name="proxy" tab="代理设置">
          <n-card title="代理服务器设置" :bordered="false" size="small" style="max-width:520px">
            <n-form label-placement="left" label-width="110">
              <n-form-item label="代理IP"><n-input v-model:value="cfg.proxy_server" /></n-form-item>
              <n-form-item label="代理端口"><n-input v-model:value="cfg.proxy_port" /></n-form-item>
              <n-form-item label="代理账号"><n-input v-model:value="cfg.proxy_user" placeholder="没有请留空" /></n-form-item>
              <n-form-item label="代理密码"><n-input v-model:value="cfg.proxy_pwd" type="password" show-password-on="click" placeholder="没有请留空" /></n-form-item>
              <n-form-item label="代理协议">
                <n-select v-model:value="cfg.proxy_type" :options="proxyTypeOptions" style="width: 200px" />
              </n-form-item>
              <n-form-item>
                <n-space>
                  <n-button type="primary" :loading="saving" @click="saveFields(['proxy_server', 'proxy_port', 'proxy_user', 'proxy_pwd', 'proxy_type'])">保存</n-button>
                  <n-button @click="testProxy">测试连通性</n-button>
                </n-space>
              </n-form-item>
            </n-form>
          </n-card>
        </n-tab-pane>

        <!-- 计划任务 -->
        <n-tab-pane name="cron" tab="计划任务">
          <n-card title="计划任务设置" :bordered="false" size="small" style="max-width:520px">
            <n-alert type="info" style="margin-bottom:16px">
              本系统已内置定时调度器（容灾监控 / 优选IP / 定时切换解析），随服务启动自动运行，无需额外配置计划任务。以下为兼容旧版的外部触发方式。
            </n-alert>
            <n-form label-placement="left" label-width="110">
              <n-form-item label="外部触发方式">
                <n-switch :value="(cfg.cron_type || '0') === '1'" @update:value="setCronType" />
              </n-form-item>
              <n-form-item label="访问密钥">
                <n-input :value="cronKey" readonly />
              </n-form-item>
              <n-form-item label="触发地址">
                <n-input :value="cronUrl" readonly />
              </n-form-item>
            </n-form>
          </n-card>
        </n-tab-pane>
      </n-tabs>
    </n-card>

    <!-- 生成注册码弹窗 -->
    <n-modal v-model:show="showGen" preset="card" title="生成注册码" style="max-width:420px" :mask-closable="false">
      <n-form label-placement="top">
        <n-form-item label="生成数量">
          <n-input-number v-model:value="genForm.count" :min="1" :max="100" style="width: 100%" />
        </n-form-item>
        <n-form-item label="有效期（天）">
          <n-input-number v-model:value="genForm.days" :min="0" style="width: 100%" placeholder="0 表示永久有效" />
        </n-form-item>
        <n-form-item label="可用次数">
          <n-input-number v-model:value="genForm.maxUse" :min="0" style="width: 100%" placeholder="0 表示不限次数" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="genForm.remark" placeholder="选填" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showGen = false">取消</n-button>
          <n-button type="primary" :loading="genning" @click="doGen">生成</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 生成结果弹窗 -->
    <n-modal v-model:show="showResult" preset="card" title="注册码已生成" style="max-width:520px">
      <n-alert type="success" style="margin-bottom:12px">请保存下方注册码，关闭后可在列表中查看（已使用次数与状态）。</n-alert>
      <n-input v-model:value="resultText" type="textarea" :rows="8" readonly />
      <template #footer>
        <n-space justify="end">
          <n-button @click="copyResult">复制全部</n-button>
          <n-button type="primary" @click="showResult = false">关闭</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useMessage, NButton, NSpace, NTag } from 'naive-ui';
import { api } from '../api';

const message = useMessage();
const saving = ref(false);
const cfg = reactive<Record<string, string>>({});
const cronKey = ref('');

const showGen = ref(false);
const genning = ref(false);
const showResult = ref(false);
const resultText = ref('');
const genForm = reactive({ count: 1, days: 0, maxUse: 0, remark: '' });
const regCodes = ref<any[]>([]);
const regCodesLoading = ref(false);

const registerModeOptions = [
  { label: '邮箱验证码', value: 'email' },
  { label: '注册码', value: 'code' },
];

const mailTypeOptions = [
  { label: 'SMTP发信', value: '0' },
  { label: '搜狐Sendcloud', value: '1' },
  { label: '阿里云邮件推送', value: '2' },
];
const tgbotProxyOptions = [
  { label: '否', value: '0' },
  { label: '是', value: '1' },
  { label: '自定义反代URL', value: '2' },
];
const methodOptions = [
  { label: 'POST', value: 'POST' },
  { label: 'GET', value: 'GET' },
  { label: 'PUT', value: 'PUT' },
];
const contentTypeOptions = [
  { label: 'application/json', value: 'application/json' },
  { label: 'application/x-www-form-urlencoded', value: 'application/x-www-form-urlencoded' },
];
const contentFormatOptions = [
  { label: 'HTML', value: 'html' },
  { label: 'Markdown', value: 'markdown' },
  { label: '纯文本', value: 'text' },
];
const proxyTypeOptions = [
  { label: 'HTTP', value: 'http' },
  { label: 'HTTPS', value: 'https' },
  { label: 'SOCK4', value: 'sock4' },
  { label: 'SOCK5', value: 'sock5' },
  { label: 'SOCK5H', value: 'sock5h' },
];

const customWebhookFields = ['custom_webhook_url', 'custom_webhook_method', 'custom_webhook_content_type', 'custom_webhook_headers', 'custom_webhook_body', 'custom_webhook_content_format'];

const cronUrl = computed(() => {
  if (!cronKey.value) return '';
  return `${location.origin}/api/system/cron?key=${cronKey.value}`;
});

async function loadSettings() {
  const res = await api<any>('GET', '/system/settings');
  if (res.code === 0) Object.assign(cfg, res.data);
}

async function saveFields(fields: string[]) {
  const body: Record<string, string> = {};
  for (const f of fields) body[f] = cfg[f] ?? '';
  saving.value = true;
  const res = await api('POST', '/system/settings', body);
  saving.value = false;
  if (res.code === 0) message.success('设置保存成功');
  else message.error(res.msg);
}

async function saveMail() {
  const fields = ['mail_type', 'mail_recv'];
  if ((cfg.mail_type || '0') === '0') fields.push('mail_smtp', 'mail_port', 'mail_name', 'mail_pwd');
  else fields.push('mail_apiuser', 'mail_apikey', 'mail_name');
  await saveFields(fields);
}

async function testMail() {
  const res = await api('POST', '/system/mailtest', {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}
async function testTgbot() {
  const res = await api('POST', '/system/tgbottest', {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}
async function testWebhook() {
  const res = await api('POST', '/system/webhooktest', {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}
async function testCustomWebhook() {
  const res = await api('POST', '/system/customwebhooktest', {});
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}
async function testProxy() {
  const res = await api('POST', '/system/proxytest', {
    proxy_server: cfg.proxy_server,
    proxy_port: cfg.proxy_port,
    proxy_user: cfg.proxy_user,
    proxy_pwd: cfg.proxy_pwd,
    proxy_type: cfg.proxy_type,
  });
  if (res.code === 0) message.success(res.msg);
  else message.error('连通性测试失败：' + res.msg);
}

async function setVcode(v: boolean) {
  cfg.vcode = v ? '1' : '2';
  await saveFields(['vcode']);
}
async function setCronType(v: boolean) {
  cfg.cron_type = v ? '1' : '0';
  await saveFields(['cron_type']);
}

async function loadCronKey() {
  const res = await api<any>('GET', '/system/cronkey');
  if (res.code === 0) cronKey.value = res.data.cron_key;
}

const regCodeColumns: any[] = [
  { title: '注册码', key: 'code', width: 180 },
  { title: '状态', key: 'status', width: 80, render: (row: any) => (row.status === 1 ? h(NTag, { type: 'success', size: 'small' }, { default: () => '启用' }) : h(NTag, { type: 'default', size: 'small' }, { default: () => '停用' })) },
  { title: '有效期至', key: 'expiretime', width: 160, render: (row: any) => (row.expiretime ? String(row.expiretime).slice(0, 16) : '永久') },
  { title: '使用', key: 'used', width: 90, render: (row: any) => `${row.used}${row.max_use > 0 ? '/' + row.max_use : '/∞'}` },
  { title: '备注', key: 'remark', ellipsis: { tooltip: true } },
  {
    title: '操作',
    key: 'actions',
    width: 160,
    render: (row: any) =>
      h(NSpace, { size: 'small' }, () => [
        h(
          NButton,
          { size: 'small', quaternary: true, type: row.status === 1 ? 'warning' : 'success', onClick: () => toggleCodeStatus(row) },
          { default: () => (row.status === 1 ? '停用' : '启用') }
        ),
        h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => deleteCode(row) }, { default: () => '删除' }),
      ]),
  },
];

async function loadRegCodes() {
  regCodesLoading.value = true;
  const res = await api<any>('GET', '/register/codes', { limit: 500, offset: 0 });
  regCodesLoading.value = false;
  if (res.code === 0) regCodes.value = res.data.list;
  else message.error(res.msg);
}

async function setRegisterEnable(v: boolean) {
  cfg.register_enable = v ? '1' : '0';
  await saveFields(['register_enable']);
}

async function saveRegister() {
  await saveFields(['register_enable', 'register_mode']);
}

async function doGen() {
  genning.value = true;
  const res = await api<any>('POST', '/register/codes', genForm);
  genning.value = false;
  if (res.code === 0) {
    showGen.value = false;
    resultText.value = (res.data.codes || []).join('\n');
    showResult.value = true;
    loadRegCodes();
  } else {
    message.error(res.msg);
  }
}

async function copyResult() {
  try {
    await navigator.clipboard.writeText(resultText.value);
    message.success('已复制到剪贴板');
  } catch {
    message.warning('复制失败，请手动选择复制');
  }
}

async function toggleCodeStatus(row: any) {
  const res = await api<any>('POST', '/register/codes/' + row.id + '/status', { status: row.status === 1 ? 0 : 1 });
  if (res.code === 0) {
    message.success(res.msg);
    loadRegCodes();
  } else message.error(res.msg);
}

async function deleteCode(row: any) {
  const res = await api<any>('DELETE', '/register/codes/' + row.id);
  if (res.code === 0) {
    message.success(res.msg);
    loadRegCodes();
  } else message.error(res.msg);
}

onMounted(() => {
  loadSettings();
  loadCronKey();
  loadRegCodes();
});
</script>