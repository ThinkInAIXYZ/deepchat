<template>
  <div class="flex flex-col w-full">
    <div
      class="inline-flex max-w-full sm:max-w-2xl min-h-7 py-1.5 bg-accent hover:bg-accent/40 border rounded-lg items-center gap-2 px-2 text-xs leading-4 transition-colors duration-150 select-none cursor-pointer overflow-hidden"
      @click="toggleExpanded"
    >
      <Icon :icon="statusIconName" :class="['w-3.5 h-3.5 shrink-0', statusIconClass]" />
      <div
        class="flex items-center gap-1 font-mono font-medium text-foreground/80 leading-none min-w-0"
      >
        <span class="truncate text-xs" :title="primaryLabel">
          {{ primaryLabelDisplay }}
        </span>
        <span v-if="functionLabel" class="text-muted-foreground">.</span>
        <span v-if="functionLabel" class="truncate text-xs" :title="functionLabel">
          {{ functionLabelDisplay }}
        </span>
      </div>
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
        v-if="isExpanded"
        class="rounded-lg border bg-muted text-card-foreground px-2 py-3 mt-2 mb-4 max-w-full sm:max-w-2xl"
      >
        <div class="space-y-4">
          <!-- 参数 -->
          <div v-if="block.tool_call?.params" class="space-y-2">
            <h5 class="text-xs font-medium text-accent-foreground flex flex-row gap-2 items-center">
              <Icon icon="lucide:arrow-up-from-dot" class="w-4 h-4 text-foreground" />
              {{ t('toolCall.params') }}
            </h5>
            <div class="text-sm rounded-md p-2">
              <JsonObject :data="parseJson(block.tool_call.params)" />
            </div>
          </div>

          <hr />

          <!-- 响应 -->
          <div v-if="block.tool_call?.response" class="space-y-2">
            <h5 class="text-xs font-medium text-accent-foreground flex flex-row gap-2 items-center">
              <Icon icon="lucide:arrow-down-to-dot" class="w-4 h-4 text-foreground" />
              {{ t('toolCall.responseData') }}
            </h5>
            <div class="text-sm rounded-md p-3">
              <JsonObject :data="parseJson(block.tool_call.response)" />
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
import { computed, ref } from 'vue'
import { JsonObject } from '@/components/json-viewer'

const { t } = useI18n()

const props = defineProps<{
  block: AssistantMessageBlock
  messageId?: string
  threadId?: string
}>()

const isExpanded = ref(false)

const statusVariant = computed(() => {
  if (props.block.status === 'error') return 'error'
  if (props.block.status === 'success') return 'success'
  if (props.block.status === 'loading') return 'running'
  return 'neutral'
})

const primaryLabel = computed(() => {
  if (!props.block.tool_call) return t('toolCall.title')
  let serverName = props.block.tool_call.server_name
  if (props.block.tool_call.server_name?.includes('/')) {
    serverName = props.block.tool_call.server_name.split('/').pop()
  }
  return serverName || props.block.tool_call.name || t('toolCall.title')
})

const functionLabel = computed(() => {
  const toolCall = props.block.tool_call
  return toolCall?.name ?? t('toolCall.functionName')
})

const truncateLabel = (value: string, maxLength = 60) => {
  if (!value) return ''
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`
}

const primaryLabelDisplay = computed(() => truncateLabel(primaryLabel.value))
const functionLabelDisplay = computed(() => truncateLabel(functionLabel.value))

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value
}

const statusIconName = computed(() => {
  if (!props.block.tool_call) return 'lucide:circle-small'
  switch (statusVariant.value) {
    case 'error':
      return 'lucide:x'
    case 'success':
    case 'neutral':
      return 'lucide:circle-small'
    default:
      return 'lucide:circle-small'
  }
})

const statusIconClass = computed(() => {
  switch (statusVariant.value) {
    case 'error':
      return 'text-destructive'
    case 'success':
      return 'text-emerald-500'
    case 'running':
      return 'text-muted-foreground animate-pulse'
    default:
      return 'text-muted-foreground'
  }
})

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
.message-tool-call {
  min-height: 28px;
  padding-top: 6px;
  padding-bottom: 6px;
}

pre {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  font-size: 0.85em;
}
</style>
