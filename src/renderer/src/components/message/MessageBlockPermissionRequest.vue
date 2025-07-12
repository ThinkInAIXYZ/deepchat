<template>
  <div
    class="permission-request-block border rounded-lg my-2 transition-all duration-300"
    :class="[
      block.extra?.needsUserAction && block.status === 'pending'
        ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4'
        : 'border-gray-200 bg-gray-50 dark:bg-gray-800/20 dark:border-gray-700 p-2'
    ]"
  >
    <!-- Expanded view for pending permissions -->
    <div v-if="block.extra?.needsUserAction && block.status === 'pending'">
      <!-- Permission request header -->
      <div class="flex items-center gap-2 mb-3">
        <Icon icon="lucide:shield-alert" class="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <h3 class="font-medium text-amber-800 dark:text-amber-200 text-sm">
          {{ t('components.messageBlockPermissionRequest.title') }}
        </h3>
      </div>

      <!-- Tool and server information -->
      <div
        class="flex items-start gap-3 mb-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-amber-100 dark:border-amber-800"
      >
        <div class="flex-shrink-0">
          <span
            v-if="block.tool_call?.server_icons"
            class="text-xl"
            :title="block.tool_call.server_name"
            >{{ block.tool_call.server_icons }}</span
          >
          <Icon v-else icon="lucide:tool" class="w-6 h-6 text-gray-400" />
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="font-medium text-gray-900 dark:text-white text-sm">
            {{ block.tool_call?.name }}
          </h4>
          <p class="text-xs text-gray-600 dark:text-gray-400">{{ block.tool_call?.server_name }}</p>
          <div class="flex items-center gap-2 mt-1">
            <Icon :icon="getPermissionIcon()" :class="['w-3 h-3', getPermissionIconClass()]" />
            <span class="text-xs font-medium" :class="getPermissionTextClass()">
              {{ getPermissionTypeText() }}
            </span>
          </div>
        </div>
      </div>

      <!-- Permission description -->
      <p class="text-xs text-gray-700 dark:text-gray-300 mb-3">{{ block.content }}</p>

      <!-- Action area -->
      <div class="space-y-2">
        <!-- Remember choice option -->
        <div class="flex items-center space-x-2">
          <input
            id="remember"
            v-model="rememberChoice"
            type="checkbox"
            class="h-3 w-3 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label for="remember" class="text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
            {{ t('components.messageBlockPermissionRequest.rememberChoice') }}
          </label>
        </div>

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
            class="flex-1 h-7 text-xs bg-blue-600 hover:bg-blue-700"
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

    <!-- Collapsed view for completed requests -->
    <div v-else class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span
          v-if="block.tool_call?.server_icons"
          class="text-sm"
          :title="block.tool_call.server_name"
          >{{ block.tool_call.server_icons }}</span
        >
        <Icon v-else icon="lucide:tool" class="w-4 h-4 text-gray-400" />
        <span class="text-xs text-gray-600 dark:text-gray-400">
          {{ block.tool_call?.name }}
        </span>
        <Icon :icon="getPermissionIcon()" :class="['w-3 h-3', getPermissionIconClass()]" />
      </div>

      <div class="flex items-center gap-1 text-xs">
        <Icon :icon="getStatusIcon()" :class="['w-3 h-3', getStatusIconClass()]" />
        <span :class="getStatusTextClass()">
          {{ getStatusText() }}
        </span>
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

const rememberChoice = ref(false)
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

const getStatusIcon = () => {
  switch (props.block.status) {
    case 'granted':
      return 'lucide:check-circle'
    case 'denied':
      return 'lucide:x-circle'
    case 'error':
      return 'lucide:alert-circle'
    default:
      return 'lucide:clock'
  }
}

const getStatusIconClass = () => {
  switch (props.block.status) {
    case 'granted':
      return 'text-green-500'
    case 'denied':
      return 'text-red-500'
    case 'error':
      return 'text-red-500'
    default:
      return 'text-gray-500'
  }
}

const getStatusTextClass = () => {
  switch (props.block.status) {
    case 'granted':
      return 'text-green-700 dark:text-green-400'
    case 'denied':
      return 'text-red-700 dark:text-red-400'
    case 'error':
      return 'text-red-700 dark:text-red-400'
    default:
      return 'text-gray-700 dark:text-gray-400'
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
      rememberChoice.value
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

<style scoped>
.permission-request-block {
  border-left: 3px solid #f59e0b;
}
</style>
