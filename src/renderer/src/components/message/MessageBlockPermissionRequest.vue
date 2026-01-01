<template>
  <div class="my-1">
    <!-- Collapsed view for completed requests or compact display -->
    <div
      v-if="!block.extra?.needsUserAction || block.status !== 'pending'"
      class="flex flex-col h-min-[40px] hover:bg-muted select-none cursor-pointer pt-3 overflow-hidden w-[380px] break-all shadow-sm my-2 items-start gap-3 rounded-lg border bg-card text-card-foreground"
    >
      <div class="flex flex-row items-center gap-2 w-full">
        <div class="grow w-0 pl-2">
          <h4
            class="text-xs font-medium leading-none text-accent-foreground flex flex-row gap-2 items-center"
          >
            <span v-if="block.tool_call?.server_icons" class="text-base leading-none">
              {{ block.tool_call.server_icons }}
            </span>
            <Icon v-else icon="lucide:shield-check" class="w-4 h-4 text-muted-foreground" />
            {{ block.tool_call?.server_name ? `${block.tool_call.server_name} · ` : '' }}
            {{ truncatedName }}
          </h4>
        </div>
        <div class="text-xs text-muted-foreground">{{ getStatusText() }}</div>
        <div class="shrink-0 pr-2 rounded-lg rounded-l-none flex justify-center items-center">
          <Icon :icon="getStatusIcon()" :class="['w-4 h-4', getStatusIconClass()]" />
        </div>
      </div>
      <div class="h-0"></div>
    </div>

    <!-- Expanded view for pending permissions -->
    <div
      v-else
      class="flex flex-col h-min-[40px] overflow-hidden w-[380px] break-all shadow-sm my-2 rounded-lg border bg-card text-card-foreground p-3"
    >
      <!-- Header -->
      <div class="flex items-center gap-2 mb-2">
        <span v-if="block.tool_call?.server_icons" class="text-base">
          {{ block.tool_call.server_icons }}
        </span>
        <Icon
          v-else
          icon="lucide:shield-alert"
          class="w-4 h-4 text-amber-600 dark:text-amber-400"
        />
        <h4 class="text-xs font-medium text-accent-foreground">
          {{ truncatedName }}
        </h4>
        <Icon :icon="getPermissionIcon()" :class="['w-3 h-3', getPermissionIconClass()]" />
        <span class="text-xs" :class="getPermissionTextClass()">
          {{ getPermissionTypeText() }}
        </span>
      </div>

      <!-- Description -->
      <p v-if="!isCommandPermission" class="text-xs text-muted-foreground mb-3">
        {{ getFormattedDescription() }}
      </p>
      <div v-else class="mb-3">
        <div class="rounded-md border bg-muted/60 px-2 py-1.5 text-xs font-mono text-foreground">
          {{ displayCommand }}
        </div>
        <div class="mt-2 flex items-center gap-2">
          <span class="text-[10px] uppercase tracking-wide text-muted-foreground">
            {{ t('components.messageBlockPermissionRequest.riskLabel') }}
          </span>
          <span :class="['text-[10px] font-semibold px-2 py-0.5 rounded-full', riskBadgeClass]">
            {{ riskLabel }}
          </span>
        </div>
        <p class="mt-2 text-xs text-muted-foreground">
          {{ suggestionText }}
        </p>
      </div>

      <!-- Action buttons -->
      <div v-if="!isCommandPermission" class="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          class="flex-1 h-7 text-xs"
          :disabled="isProcessing"
          @click="denyPermission"
        >
          <Icon icon="lucide:x" class="w-3 h-3 mr-1" />
          {{ t('components.messageBlockPermissionRequest.deny') }}
        </Button>
        <Button
          size="sm"
          class="flex-1 h-7 text-xs"
          :disabled="isProcessing"
          @click="grantPermission"
        >
          <Icon v-if="isProcessing" icon="lucide:loader-2" class="w-3 h-3 mr-1 animate-spin" />
          <Icon v-else icon="lucide:check" class="w-3 h-3 mr-1" />
          {{ t('components.messageBlockPermissionRequest.allow') }}
        </Button>
      </div>
      <TooltipProvider v-else :delayDuration="200">
        <div class="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            class="flex-1 h-7 text-xs"
            :disabled="isProcessing"
            @click="denyPermission"
          >
            <Icon icon="lucide:x" class="w-3 h-3 mr-1" />
            {{ t('components.messageBlockPermissionRequest.deny') }}
          </Button>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="outline"
                size="sm"
                class="flex-1 h-7 text-xs"
                :disabled="isProcessing"
                @click="grantPermissionOnce"
              >
                <Icon
                  v-if="isProcessing"
                  icon="lucide:loader-2"
                  class="w-3 h-3 mr-1 animate-spin"
                />
                <Icon v-else icon="lucide:check" class="w-3 h-3 mr-1" />
                {{ t('components.messageBlockPermissionRequest.allowOnce') }}
              </Button>
            </TooltipTrigger>
            <TooltipContent class="max-w-xs text-xs">
              {{ t('components.messageBlockPermissionRequest.allowOnceTooltip') }}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                size="sm"
                class="flex-1 h-7 text-xs"
                :disabled="isProcessing || !rememberable"
                @click="grantPermissionForSession"
              >
                <Icon
                  v-if="isProcessing"
                  icon="lucide:loader-2"
                  class="w-3 h-3 mr-1 animate-spin"
                />
                <Icon v-else icon="lucide:check-circle" class="w-3 h-3 mr-1" />
                {{ t('components.messageBlockPermissionRequest.allowForSession') }}
              </Button>
            </TooltipTrigger>
            <TooltipContent class="max-w-xs text-xs">
              {{ t('components.messageBlockPermissionRequest.allowForSessionTooltip') }}
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { usePresenter } from '@/composables/usePresenter'
import { AssistantMessageBlock } from '@shared/chat'

const { t } = useI18n()
const agentPresenter = usePresenter('agentPresenter')

const props = defineProps<{
  block: AssistantMessageBlock
  messageId: string
  conversationId: string
}>()

const isProcessing = ref(false)
const rememberable = computed(() => props.block.extra?.rememberable !== false)
const isCommandPermission = computed(() => props.block.extra?.permissionType === 'command')

// Truncate name to max 200 characters
const MAX_NAME_LENGTH = 200
const truncatedName = computed(() => {
  const name = props.block.tool_call?.name ?? ''
  const ellipsis = '...'

  if (MAX_NAME_LENGTH <= ellipsis.length) {
    return ellipsis.slice(0, MAX_NAME_LENGTH)
  }

  if (name.length > MAX_NAME_LENGTH) {
    return name.slice(0, MAX_NAME_LENGTH - ellipsis.length) + ellipsis
  }

  return name
})

const getPermissionIcon = () => {
  const permissionType = props.block.extra?.permissionType as string
  switch (permissionType) {
    case 'read':
      return 'lucide:eye'
    case 'write':
      return 'lucide:edit'
    case 'all':
      return 'lucide:unlock'
    case 'command':
      return 'lucide:terminal'
    default:
      return 'lucide:lock'
  }
}

const getPermissionIconClass = () => {
  const permissionType = props.block.extra?.permissionType as string
  switch (permissionType) {
    case 'read':
      return 'text-blue-500'
    case 'write':
      return 'text-orange-500'
    case 'all':
      return 'text-red-500'
    case 'command':
      return 'text-amber-500'
    default:
      return 'text-gray-500'
  }
}

const getPermissionTextClass = () => {
  const permissionType = props.block.extra?.permissionType as string
  switch (permissionType) {
    case 'read':
      return 'text-blue-700 dark:text-blue-400'
    case 'write':
      return 'text-orange-700 dark:text-orange-400'
    case 'all':
      return 'text-red-700 dark:text-red-400'
    case 'command':
      return 'text-amber-700 dark:text-amber-400'
    default:
      return 'text-gray-700 dark:text-gray-400'
  }
}

const getPermissionTypeText = () => {
  const permissionType = props.block.extra?.permissionType as string
  return t(`components.messageBlockPermissionRequest.type.${permissionType}`)
}

const getFormattedDescription = () => {
  const content = props.block.content

  // 处理 undefined content
  if (!content) {
    return ''
  }

  // 检查是否是 i18n key
  if (content.startsWith('components.messageBlockPermissionRequest.description.')) {
    const permissionRequestStr = props.block.extra?.permissionRequest
    if (permissionRequestStr && typeof permissionRequestStr === 'string') {
      try {
        const req = JSON.parse(permissionRequestStr) as { toolName?: string; serverName?: string }
        return t(content, {
          toolName: req.toolName || '',
          serverName: req.serverName || ''
        })
      } catch (error) {
        console.error('Failed to parse permissionRequest:', error)
        // 回退到使用 extra 字段中的信息
        return t(content, {
          toolName: (props.block.extra?.toolName as string) || '',
          serverName: (props.block.extra?.serverName as string) || ''
        })
      }
    }
  }

  // 向后兼容：直接返回原文本
  return content
}

const commandInfo = computed(() => {
  const rawInfo = props.block.extra?.commandInfo
  if (typeof rawInfo === 'string') {
    try {
      return JSON.parse(rawInfo) as {
        command?: string
        riskLevel?: string
        suggestion?: string
      }
    } catch (error) {
      console.error('Failed to parse commandInfo:', error)
    }
  }

  const rawRequest = props.block.extra?.permissionRequest
  if (typeof rawRequest === 'string') {
    try {
      const request = JSON.parse(rawRequest) as {
        command?: string
        commandInfo?: {
          command?: string
          riskLevel?: string
          suggestion?: string
        }
      }
      if (request.commandInfo) {
        return request.commandInfo
      }
      if (request.command) {
        return { command: request.command }
      }
    } catch (error) {
      console.error('Failed to parse permissionRequest for command info:', error)
    }
  }

  const rawParams = props.block.tool_call?.params
  if (typeof rawParams === 'string') {
    try {
      const parsed = JSON.parse(rawParams) as { command?: string }
      if (parsed.command) {
        return { command: parsed.command }
      }
    } catch (error) {
      console.error('Failed to parse tool_call params for command:', error)
    }
  }

  return null
})

const displayCommand = computed(() => commandInfo.value?.command || '')
const riskLevel = computed(() => {
  const rawLevel = commandInfo.value?.riskLevel
  if (
    rawLevel === 'low' ||
    rawLevel === 'medium' ||
    rawLevel === 'high' ||
    rawLevel === 'critical'
  ) {
    return rawLevel
  }
  return 'medium'
})
const riskLabel = computed(() =>
  t(`components.messageBlockPermissionRequest.riskLevel.${riskLevel.value}`)
)
const riskBadgeClass = computed(() => {
  switch (riskLevel.value) {
    case 'low':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200'
    case 'medium':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200'
    case 'high':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-200'
    case 'critical':
      return 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200 motion-safe:animate-pulse'
    default:
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200'
  }
})

const suggestionText = computed(() => {
  const suggestion = commandInfo.value?.suggestion
  if (suggestion) {
    if (suggestion.startsWith('components.')) {
      return t(suggestion)
    }
    return suggestion
  }
  return t(`components.messageBlockPermissionRequest.suggestion.${riskLevel.value}`)
})

const getStatusIcon = () => {
  switch (props.block.status) {
    case 'granted':
      return 'lucide:check'
    case 'denied':
      return 'lucide:x'
    case 'error':
      return 'lucide:alert'
    default:
      return 'lucide:clock'
  }
}

const getStatusIconClass = () => {
  switch (props.block.status) {
    case 'granted':
      return 'bg-green-500 rounded-full text-white p-0.5 dark:bg-green-800'
    case 'denied':
      return 'text-white p-0.5 bg-red-500 rounded-full dark:bg-red-800'
    case 'error':
      return 'text-white p-0.5 bg-red-500 rounded-full dark:bg-red-800'
    default:
      return 'text-muted-foreground'
  }
}

const getStatusText = () => {
  switch (props.block.status) {
    case 'granted':
    case 'success':
      return t('components.messageBlockPermissionRequest.granted')
    case 'denied':
      return t('components.messageBlockPermissionRequest.denied')
    case 'error':
      return 'Error'
    default:
      return 'Pending'
  }
}

const resolvedPermissionType = computed(() => {
  const permissionType = props.block.extra?.permissionType
  if (
    permissionType === 'read' ||
    permissionType === 'write' ||
    permissionType === 'all' ||
    permissionType === 'command'
  ) {
    return permissionType
  }
  return 'write'
})

const submitPermission = async (granted: boolean, remember: boolean) => {
  if (!props.block.tool_call?.id) return

  isProcessing.value = true
  try {
    await agentPresenter.handlePermissionResponse(
      props.messageId,
      props.block.tool_call.id,
      granted,
      resolvedPermissionType.value,
      remember
    )
  } catch (error) {
    console.error('Failed to handle permission response:', error)
  } finally {
    isProcessing.value = false
  }
}

const grantPermission = async () => {
  await submitPermission(true, rememberable.value)
}

const grantPermissionOnce = async () => {
  await submitPermission(true, false)
}

const grantPermissionForSession = async () => {
  await submitPermission(true, true)
}

const denyPermission = async () => {
  await submitPermission(false, false)
}
</script>

<style scoped></style>
