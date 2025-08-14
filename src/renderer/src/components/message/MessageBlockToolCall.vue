<template>
  <div class="my-1">
    <div
      class="flex flex-col h-min-[40px] hover:bg-muted select-none cursor-pointer pt-3 overflow-hidden w-[380px] break-all shadow-sm my-2 items-start gap-3 rounded-lg border bg-card text-card-foreground"
      @click="toggleExpanded"
    >
      <div class="flex flex-row items-center gap-2 w-full">
        <div class="flex-grow w-0 pl-2">
          <h4
            class="text-xs font-medium leading-none text-accent-foreground flex flex-row gap-2 items-center"
          >
            <span v-if="block.tool_call?.server_icons" class="text-base leading-none">{{
              `${block.tool_call?.server_icons}  `
            }}</span>
            <Icon v-else icon="lucide:hammer" class="w-4 h-4 text-muted-foreground" />
            {{ block.tool_call?.server_name ? `${block.tool_call?.server_name} · ` : ''
            }}{{ block.tool_call?.name ?? '' }}
          </h4>
        </div>
        <div class="text-xs text-muted-foreground">{{ getToolCallStatus() }}</div>
        <div class="flex-shrink-0 pr-2 rounded-lg rounded-l-none flex justify-center items-center">
          <Icon
            v-if="block.status === 'loading'"
            icon="lucide:loader-2"
            class="w-4 h-4 animate-spin text-muted-foreground"
          />
          <Icon
            v-else-if="block.status === 'success'"
            icon="lucide:check"
            class="w-4 h-4 bg-green-500 rounded-full text-white p-0.5 dark:bg-green-800"
          />
          <Icon
            v-else-if="block.status === 'error'"
            icon="lucide:x"
            class="w-4 h-4 text-white p-0.5 bg-red-500 rounded-full dark:bg-red-800"
          />
          <Icon
            v-else-if="showPermissionIcon()"
            icon="lucide:hand"
            class="w-4 h-4 p-0.5 bg-yellow-500 text-white rounded-full dark:bg-yellow-800"
          />
          <Icon
            v-else
            :icon="isExpanded ? 'lucide:chevron-up' : 'lucide:chevron-down'"
            class="w-4 h-4 text-muted-foreground"
          />
        </div>
      </div>
      <!-- <transition
        enter-active-class="transition-all duration-200"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition-all duration-200"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div
          v-if="simpleIn"
          class="flex-row w-full gap-1 bg-muted dark:bg-background text-muted-foreground transition-colors duration-200 inline-flex max-w-[33rem] items-center cursor-pointer select-none"
        >
          <div class="text-xs inline-flex px-2 py-1 flex-row gap-2 items-center max-w-64">
            <Icon icon="lucide:arrow-up-from-dot" class="w-3 h-3 text-muted-foreground shrink-0" />
            <span class="truncate">{{ simpleIn }}</span>
          </div>
        </div>
        <div v-else class="h-0"></div>
      </transition> -->
      <div class="h-0"></div>
    </div>

    <!-- 详细内容区域 -->
    <transition
      enter-active-class="transition-all duration-200"
      enter-from-class="opacity-0 -translate-y-4 scale-95"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition-all duration-200"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 -translate-y-4 scale-95"
    >
      <div
        v-if="isExpanded || block.tool_call?.direct_return"
        class="rounded-lg border bg-card text-card-foreground px-2 py-3 mt-2 mb-4"
      >
        <div class="space-y-4">
          <!-- 参数 -->
          <!-- <div v-if="block.tool_call?.params && (isExpanded || !block.tool_call?.direct_return)" class="space-y-2">
            <h5 class="text-xs font-medium text-accent-foreground flex flex-row gap-2 items-center">
              <Icon icon="lucide:arrow-up-from-dot" class="w-4 h-4 text-muted-foreground" />
              {{ t('toolCall.params') }}
            </h5>
            <div class="text-sm rounded-md p-2">
              <MarkdownRenderer v-if="isMarkdownResponse(block.tool_call.params)" :content="getMarkdownContent(block.tool_call.params)" />
              <JsonObject v-else :data="parseJson(block.tool_call.params)" />
            </div>
          </div> -->

          <hr v-if="isExpanded || !block.tool_call?.direct_return" />

          <!-- 响应 -->
          <div v-if="block.tool_call?.response" class="space-y-2">
            <h5 class="text-xs font-medium text-accent-foreground flex flex-row gap-2 items-center">
              <Icon icon="lucide:arrow-down-to-dot" class="w-4 h-4 text-muted-foreground" />
              {{ t('toolCall.responseData') }}
            </h5>
            <div class="text-sm rounded-md p-3">
              <!-- <MarkdownRenderer v-if="isMarkdownResponse(block.tool_call.response)" :content="getMarkdownContent(block.tool_call.response)" /> -->
              <!-- <JsonObject v-else :data="parseJson(block.tool_call.response)" /> -->
              <MarkdownRenderer  :content="getMarkdownContent(block.tool_call.response)" />
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { AssistantMessageBlock } from '@shared/chat'
import { ref, onMounted, watch } from 'vue'
import { JsonObject } from '@/components/json-viewer'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'
import TurndownService from 'turndown';

// 创建一个安全的翻译函数
const t = (() => {
  try {
    const { t } = useI18n()
    return t
  } catch (e) {
    // 如果 i18n 未初始化，提供默认翻译
    return (key: string) => {
      if (key === 'toolCall.calling') return '工具调用中'
      if (key === 'toolCall.response') return '工具响应'
      if (key === 'toolCall.end') return '工具调用完成'
      if (key === 'toolCall.error') return '工具调用错误'
      if (key === 'toolCall.title') return '工具调用'
      if (key === 'toolCall.clickToView') return '点击查看详情'
      if (key === 'toolCall.functionName') return '函数名称'
      if (key === 'toolCall.params') return '参数'
      if (key === 'toolCall.responseData') return '响应数据'
      return key
    }
  }
})()

const props = defineProps<{
  block: AssistantMessageBlock
  messageId?: string
  threadId?: string
}>()

const isExpanded = ref(false)

// 在组件挂载时检查direct_return属性
onMounted(() => {
  console.log("pMessageBlockToolCall-block.tool_call",props.block.tool_call?.direct_return)
  if (props.block.tool_call?.direct_return === true) {
    isExpanded.value = true
  }
})

// 监听direct_return属性变化
watch(() => props.block.tool_call?.direct_return, (newVal) => {
  if (newVal === true) {
    isExpanded.value = true
  }
})

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value
}

const getToolCallStatus = () => {
  if (!props.block.tool_call) return ''

  if (props.block.status === 'error') {
    return t('toolCall.error')
  }

  if (props.block.status === 'loading') {
    return props.block.tool_call.response ? t('toolCall.response') : t('toolCall.calling')
  }

  if (props.block.status === 'success') {
    return t('toolCall.end')
  }

  return t('toolCall.title')
}

// 辅助函数，用于判断是否显示权限图标
const showPermissionIcon = () => {
  // 这里保留原有逻辑，暂时默认不显示
  return false
}

// 解析JSON为对象
const parseJson = (jsonStr: string) => {
  try {
    const parsed = JSON.parse(jsonStr)
    if (parsed) {
      if (typeof parsed === 'object' || Array.isArray(parsed)) {
        return parsed
      } else {
        return { raw: parsed }
      }
    }
    return parsed
  } catch (e) {
    return { raw: jsonStr }
  }
}
//JSON转换markdown方法 
function csvToMarkdownTable(csvString: string): string {
  // 按行分割，并去掉空行
  const lines = csvString
    .trim()
    .split(/\r?\n/)
    .filter(line => line.trim())

  if (lines.length === 0) return ''

  // 解析每行
  const rows = lines.map(line =>
    line
      .split(',')
      .map(cell => cell.trim()) // 去掉首尾空格
  )

  // 表头
  const header = rows[0]
  const separator = header.map(() => '---') // 分隔符

  // 组合表格
  const table = [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...rows.slice(1).map(row => `| ${row.join(' | ')} |`)
  ]

  return table.join('\n')
}
// 提取Markdown内容
const getMarkdownContent = (content: string) => {
  if (!content) return ''
  
  try {
    console.log("getMarkdownContent-content",content)
    const markdownContent = csvToMarkdownTable(content);
    return markdownContent
  } catch (e) {
    // 不是JSON格式，直接返回原始内容
    return content
  }
}

// const simpleIn = computed(() => {
//   if (!props.block.tool_call) return false
//   if (props.block.tool_call.params) {
//     const params = parseJson(props.block.tool_call.params)
//     const strArr: string[] = []
//     for (const key in params) {
//       strArr.push(`${params[key]}`)
//     }
//     return strArr.join(', ')
//   }
//   return ''
// })
</script>

<style scoped>
pre {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  font-size: 0.85em;
}
</style>
