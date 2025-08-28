<template>
  <div class="space-y-4 p-4 border rounded-lg bg-muted/30">
    <div class="flex items-center justify-between">
      <div class="space-y-1">
        <h4 class="text-sm font-medium">{{ t('settings.rateLimit.title') }}</h4>
        <p class="text-xs text-muted-foreground">
          {{ t('settings.rateLimit.description') }}
        </p>
      </div>
      <Switch :checked="rateLimitEnabled" @update:checked="handleEnabledChange" />
    </div>

    <div v-if="rateLimitEnabled" class="space-y-3">
      <div class="space-y-2">
        <Label class="text-xs font-medium">
          {{ t('settings.rateLimit.intervalLimit') }}
        </Label>
        <div class="flex items-center space-x-2">
          <Input
            v-model.number="intervalValue"
            type="number"
            min="0"
            max="3600"
            step="0.1"
            class="w-20"
            @blur="handleIntervalChange"
            @keyup.enter="handleIntervalChange"
          />
          <span class="text-xs text-muted-foreground">
            {{ t('settings.rateLimit.intervalUnit') }}
          </span>
        </div>
        <div class="text-xs text-muted-foreground">
          {{ t('settings.rateLimit.intervalHelper') }}
        </div>
      </div>

      <!-- 状态显示 -->
      <div v-if="status" class="space-y-2 text-xs">
        <div class="flex justify-between">
          <span class="text-muted-foreground">{{ t('settings.rateLimit.lastRequestTime') }}:</span>
          <span class="font-mono">{{ formatLastRequestTime() }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-muted-foreground">{{ t('settings.rateLimit.queueLength') }}:</span>
          <span class="font-mono">{{ status.queueLength }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-muted-foreground">{{ t('settings.rateLimit.nextAllowedTime') }}:</span>
          <span class="font-mono">{{ formatNextAllowedTime() }}</span>
        </div>
      </div>
    </div>

    <!-- 确认对话框 -->
    <AlertDialog :open="showConfirmDialog" @update:open="showConfirmDialog = $event">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('settings.rateLimit.confirmDisableTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('settings.rateLimit.confirmDisableMessage') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="cancelDisableRateLimit">
            {{ t('common.cancel') }}
          </AlertDialogCancel>
          <AlertDialogAction @click="confirmDisableRateLimit">
            {{ t('settings.rateLimit.confirmDisable') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePresenter } from '@/composables/usePresenter'
import { RATE_LIMIT_EVENTS } from '@/events'
import type { LLM_PROVIDER } from '@shared/presenter'
import { useToast } from '@/components/ui/toast/use-toast'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'

const props = defineProps<{
  provider: LLM_PROVIDER
}>()

const emit = defineEmits<{
  configChanged: []
}>()

const { t } = useI18n()
const llmPresenter = usePresenter('llmproviderPresenter')
const { toast } = useToast()

const rateLimitEnabled = ref(props.provider.rateLimit?.enabled ?? false)
const intervalValue = ref(convertQpsToInterval(props.provider.rateLimit?.qpsLimit ?? 0.1))
const previousValidValue = ref(intervalValue.value) // 保存上一个有效值
const showConfirmDialog = ref(false)
const status = ref<{
  currentQps: number
  queueLength: number
  lastRequestTime?: number
} | null>(null)

function convertQpsToInterval(qps: number): number {
  return 1 / qps
}

function convertIntervalToQps(interval: number): number {
  return 1 / interval
}

const handleEnabledChange = async (enabled: boolean) => {
  rateLimitEnabled.value = enabled
  await updateRateLimitConfig()
  // 根据启用状态控制轮询
  startStatusPolling()
}

const handleIntervalChange = async () => {
  if (intervalValue.value <= 0) {
    showConfirmDialog.value = true
    return
  }

  if (intervalValue.value > 3600) {
    intervalValue.value = 3600
  }
  previousValidValue.value = intervalValue.value
  await updateRateLimitConfig()
}

const confirmDisableRateLimit = async () => {
  rateLimitEnabled.value = false
  showConfirmDialog.value = false
  await updateRateLimitConfig()
  toast({
    title: t('settings.rateLimit.disabled'),
    description: t('settings.rateLimit.disabledDescription')
  })
}

const cancelDisableRateLimit = () => {
  intervalValue.value = previousValidValue.value
  showConfirmDialog.value = false
}

const updateRateLimitConfig = async () => {
  try {
    const qpsValue = convertIntervalToQps(intervalValue.value)
    await llmPresenter.updateProviderRateLimit(props.provider.id, rateLimitEnabled.value, qpsValue)
    emit('configChanged')
    await loadStatus()
  } catch (error) {
    console.error('Failed to update rate limit config:', error)
  }
}

// 加载状态
const loadStatus = async () => {
  try {
    const rateLimitStatus = await llmPresenter.getProviderRateLimitStatus(props.provider.id)
    status.value = {
      currentQps: rateLimitStatus.currentQps,
      queueLength: rateLimitStatus.queueLength,
      lastRequestTime: rateLimitStatus.lastRequestTime
    }
  } catch (error) {
    console.error('Failed to load rate limit status:', error)
  }
}

// 格式化时间显示
const formatLastRequestTime = () => {
  if (!status.value?.lastRequestTime || status.value.lastRequestTime === 0) {
    return t('settings.rateLimit.never')
  }
  const diff = Date.now() - status.value.lastRequestTime
  if (diff < 1000) return t('settings.rateLimit.justNow')
  if (diff < 60000) return `${Math.floor(diff / 1000)}${t('settings.rateLimit.secondsAgo')}`
  return `${Math.floor(diff / 60000)}${t('settings.rateLimit.minutesAgo')}`
}

const formatNextAllowedTime = () => {
  if (
    !rateLimitEnabled.value ||
    !status.value?.lastRequestTime ||
    status.value.lastRequestTime === 0
  ) {
    return t('settings.rateLimit.immediately')
  }

  const nextAllowedTime = status.value.lastRequestTime + intervalValue.value * 1000
  const now = Date.now()

  if (nextAllowedTime <= now) {
    return t('settings.rateLimit.immediately')
  }

  const waitTime = Math.ceil((nextAllowedTime - now) / 1000)
  return `${waitTime}${t('settings.rateLimit.secondsLater')}`
}

const handleRateLimitEvent = (data: any) => {
  if (data.providerId === props.provider.id) {
    loadStatus()
  }
}

let statusInterval: ReturnType<typeof setInterval> | null = null

const startStatusPolling = () => {
  if (statusInterval) {
    clearInterval(statusInterval)
  }
  if (rateLimitEnabled.value) {
    statusInterval = setInterval(loadStatus, 1000)
  }
}

const stopStatusPolling = () => {
  if (statusInterval) {
    clearInterval(statusInterval)
    statusInterval = null
  }
}

onMounted(() => {
  loadStatus()

  window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.CONFIG_UPDATED, handleRateLimitEvent)
  window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.REQUEST_EXECUTED, handleRateLimitEvent)
  window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.REQUEST_QUEUED, handleRateLimitEvent)

  // 只有在速率限制启用时才开始轮询
  startStatusPolling()

  onUnmounted(() => {
    stopStatusPolling()
    window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.CONFIG_UPDATED)
    window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.REQUEST_EXECUTED)
    window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.REQUEST_QUEUED)
  })
})

// 监听 intervalValue 变化，保存有效值
watch(intervalValue, (newValue) => {
  if (newValue > 0) {
    previousValidValue.value = newValue
  }
})

watch(rateLimitEnabled, () => {
  startStatusPolling()
})

// 监听 provider 变化
watch(
  () => props.provider,
  (newProvider) => {
    rateLimitEnabled.value = newProvider.rateLimit?.enabled ?? false
    intervalValue.value = convertQpsToInterval(newProvider.rateLimit?.qpsLimit ?? 0.1)
    previousValidValue.value = intervalValue.value
    loadStatus()
  },
  { deep: true }
)
</script>
