<template>
  <div>
    <n-grid :cols="3" :x-gap="16" :y-gap="16">
      <n-grid-item>
        <n-card :bordered="false">
          <n-statistic label="调度运行状态">
            <n-tag :type="info.run_state === 1 ? 'success' : 'error'" size="large" bordered>
              {{ info.run_state === 1 ? '运行中' : '已停止' }}
            </n-tag>
          </n-statistic>
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card :bordered="false">
          <n-statistic label="累计检测次数" :value="info.run_count" />
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card :bordered="false">
          <n-statistic label="最近运行时间" :value="info.run_time || '无'" />
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card :bordered="false">
          <n-statistic label="24H 切换次数" :value="info.switch_count" />
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card :bordered="false">
          <n-statistic label="24H 告警次数" :value="info.fail_count" />
        </n-card>
      </n-grid-item>
    </n-grid>

    <n-card :bordered="false" style="margin-top: 16px" title="运行日志">
      <n-alert v-if="info.run_error" type="error" style="margin-bottom: 12px">运行错误：{{ info.run_error }}</n-alert>
      <n-space>
        <n-input-number v-model:value="days" :min="0" style="width: 200px" />
        <n-button type="warning" @click="clean">清理日志</n-button>
      </n-space>
      <n-text depth="3" style="display: block; margin-top: 8px">清理指定天数之前的切换日志记录</n-text>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useMessage, useDialog } from 'naive-ui';
import { api } from '../api';

const message = useMessage();
const dialog = useDialog();
const info = ref<any>({ run_count: 0, run_time: '无', run_state: 0, run_error: null, switch_count: 0, fail_count: 0 });
const days = ref(30);

async function load() {
  const res = await api<any>('GET', '/dmonitor/overview');
  if (res.code === 0) info.value = res.data;
}

function clean() {
  dialog.warning({
    title: '清理日志',
    content: '确定清理 ' + days.value + ' 天之前的切换日志吗？',
    positiveText: '清理',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('POST', '/dmonitor/clean', { days: days.value });
      if (res.code === 0) message.success(res.msg);
      else message.error(res.msg);
    },
  });
}

onMounted(load);
</script>