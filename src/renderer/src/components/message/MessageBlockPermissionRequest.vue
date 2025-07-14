<template>
  <div class="my-1">
    <!-- Collapsed view for completed requests or compact display -->
    <div
      v-if="!block.extra?.needsUserAction || block.status !== 'pending'"
      class="flex flex-col h-min-[40px] hover:bg-muted select-none cursor-pointer pt-3 overflow-hidden w-[380px] break-all shadow-sm my-2 items-start gap-3 rounded-lg border bg-card text-card-foreground"
    >
      <div class="flex flex-row items-center gap-2 w-full">
        <div class="flex-grow w-0 pl-2">
          <h4
            class="text-xs font-medium leading-none text-accent-foreground flex flex-row gap-2 items-center"
          >
            <span v-if="block.tool_call?.server_icons" class="text-base leading-none">
              {{ block.tool_call.server_icons }}
            </span>
            <Icon v-else icon="lucide:shield-check" class="w-4 h-4 text-muted-foreground" />
            {{ block.tool_call?.server_name ? `${block.tool_call.server_name} · ` : '' }}
            {{ block.tool_call?.name ?? '' }}
          </h4>
        </div>
        <div class="text-xs text-muted-foreground">{{ getStatusText() }}</div>
        <div class="flex-shrink-0 pr-2 rounded-lg rounded-l-none flex justify-center items-center">
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
          {{ block.tool_call?.name }}
        </h4>
        <Icon :icon="getPermissionIcon()" :class="['w-3 h-3', getPermissionIconClass()]" />
        <span class="text-xs" :class="getPermissionTextClass()">
          {{ getPermissionTypeText() }}
        </span>
      </div>

      <!-- Description -->
      <p class="text-xs text-muted-foreground mb-3">{{ getFormattedDescription() }}</p>

      <!-- Action buttons -->
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { usePresenter } from '@/composables/usePresenter'
import { AssistantMessageBlock } from '@shared/chat'

const { t } = useI18n()
const threadPresenter = usePresenter('threadPresenter')

const props = defineProps<{
  block: AssistantMessageBlock
  messageId: string
  conversationId: string
}>()

const isProcessing = ref(false)

const getPermissionIcon = () => {
  const permissionType = props.block.extra?.permissionType as string
  switch (permissionType) {
    case 'read':
      return 'lucide:eye'
    case 'write':
      return 'lucide:edit'
    case 'all':
      return 'lucide:unlock'
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
      return t('components.messageBlockPermissionRequest.granted')
    case 'denied':
      return t('components.messageBlockPermissionRequest.denied')
    case 'error':
      return 'Error'
    default:
      return 'Pending'
  }
}

const grantPermission = async () => {
  if (!props.block.tool_call?.id) return

  isProcessing.value = true
  try {
    await threadPresenter.handlePermissionResponse(
      props.messageId,
      props.block.tool_call.id,
      true,
      (props.block.extra?.permissionType as 'read' | 'write' | 'all') || 'write',
      true
    )
  } catch (error) {
    console.error('Failed to grant permission:', error)
  } finally {
    isProcessing.value = false
  }
}

const denyPermission = async () => {
  if (!props.block.tool_call?.id) return

  isProcessing.value = true
  try {
    await threadPresenter.handlePermissionResponse(
      props.messageId,
      props.block.tool_call.id,
      false,
      (props.block.extra?.permissionType as 'read' | 'write' | 'all') || 'write',
      false
    )
  } catch (error) {
    console.error('Failed to deny permission:', error)
  } finally {
    isProcessing.value = false
  }
}
</script>

<style scoped></style>
