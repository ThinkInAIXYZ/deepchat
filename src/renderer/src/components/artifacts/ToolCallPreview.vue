<template>
  <!-- 此文件已经废弃，只用于兼容展示旧的tool_call 请勿修改此文件 -->
  <!-- This file is deprecated and is only for compatibility to display old tool_calls. Please do not modify this file -->
  <div>
    <div
      class="flex w-[360px] h-[40px] max-w-full break-all shadow-sm my-2 items-center gap-2 rounded-lg border bg-card text-card-foreground"
    >
      <div class="grow w-0 pl-2">
        <h4
          class="text-xs font-medium leading-none text-accent-foreground flex flex-row gap-2 items-center"
        >
          <Icon icon="lucide:hammer" class="w-4 h-4 text-muted-foreground" />
          {{ props.block.tool_call?.name ?? '' }}
        </h4>
      </div>
      <div class="text-xs text-muted-foreground">{{ getToolCallStatus() }}</div>
      <div class="shrink-0 px-2 rounded-lg rounded-l-none flex justify-center items-center">
        <Icon
          v-if="block.loading && (blockStatus === 'loading' || !blockStatus)"
          icon="lucide:loader-2"
          class="w-4 h-4 animate-spin text-muted-foreground"
        />
        <Icon
          v-else-if="block.tool_call && block.tool_call.status === 'end'"
          icon="lucide:check"
          class="w-4 h-4 bg-green-500 rounded-full text-white p-0.5 dark:bg-green-800"
        />
        <Icon
          v-else-if="block.tool_call && isBlockError()"
          icon="lucide:x"
          class="w-4 h-4 text-white p-0.5 bg-red-500 rounded-full dark:bg-red-800"
        />
        <Icon
          v-else-if="showPermissionIcon()"
          icon="lucide:hand"
          class="w-4 h-4 p-0.5 bg-yellow-500 text-white rounded-full dark:bg-yellow-800"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import type { ProcessedPart } from '@/composables/useArtifacts'

// 创建一个安全的翻译函数
const t = (() => {
  try {
    const { t } = useI18n()
    return t
  } catch (e) {
    // 如果 i18n 未初始化，提供默认翻译
    return (key: string) => {
      if (key === 'toolCall.calling') return '工具调用中'
      if (key === 'toolCall.response') return '工具响应中'
      if (key === 'toolCall.end') return '工具调用完成'
      if (key === 'toolCall.error') return '工具调用错误'
      if (key === 'toolCall.title') return '工具调用'
      if (key === 'toolCall.clickToView') return '点击查看详情'
      if (key === 'toolCall.functionName') return '函数名称'
      return key
    }
  }
})()

const props = defineProps<{
  block: ProcessedPart
  blockStatus?: string
}>()

const isBlockError = () => {
  if (props.block.tool_call?.status === 'error') {
    return true
  }
  if (props.blockStatus !== 'loading' && props.block.loading) {
    return true
  }
  if (props.blockStatus !== 'loading' && props.block.tool_call?.status === 'calling') {
    return true
  }
  if (props.blockStatus !== 'loading' && props.block.tool_call?.status === 'response') {
    return true
  }
  return false
}
const getToolCallStatus = () => {
  if (!props.block.tool_call) return ''
  if (isBlockError()) {
    return t('toolCall.error')
  }
  switch (props.block.tool_call.status) {
    case 'calling':
      return t('toolCall.calling')
    case 'response':
      return t('toolCall.response')
    case 'end':
      return t('toolCall.end')
    case 'error':
      return t('toolCall.error')
    default:
      // 处理其他可能的状态，包括未来可能添加的'permission'
      return t(`toolCall.${props.block.tool_call.status}`) || ''
  }
}

// 辅助函数，用于判断是否显示权限图标
const showPermissionIcon = () => {
  // 这里只是示意，实际上需要根据具体的业务逻辑来实现
  // 例如，可以根据某些属性来判断是否需要显示权限图标
  return false // 暂时默认不显示，等待后续实现
}
</script>
