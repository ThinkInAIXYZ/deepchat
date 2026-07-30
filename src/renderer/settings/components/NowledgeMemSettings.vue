<template>
  <div class="border rounded-lg overflow-hidden">
    <div
      data-testid="nowledge-mem-panel-toggle"
      class="flex items-center p-4 hover:bg-accent cursor-default"
      @click="toggleNowledgeMemConfigPanel"
    >
      <div class="flex-1">
        <div class="flex items-center">
          <img src="@/assets/images/nowledge-mem.png" class="h-5 mr-2" />
          <span class="text-base font-medium">{{
            $t('settings.knowledgeBase.nowledgeMem.title')
          }}</span>
        </div>
        <p class="text-sm text-muted-foreground mt-1">
          {{ $t('settings.knowledgeBase.nowledgeMem.description') }}
        </p>
      </div>
    </div>
    <div v-if="showConfigPanel" class="border-t p-4 space-y-4">
      <!-- Configuration Section -->
      <div class="space-y-3">
        <div class="text-sm font-medium">
          {{ $t('settings.knowledgeBase.nowledgeMem.configuration') }}
        </div>

        <!-- Base URL -->
        <div class="space-y-2">
          <Label for="baseUrl">
            {{ $t('settings.knowledgeBase.nowledgeMem.baseUrl') }}
          </Label>
          <Input
            id="baseUrl"
            data-testid="nowledge-mem-base-url-input"
            v-model="config.baseUrl"
            :disabled="formDisabled"
            :aria-invalid="!isBaseUrlValid"
            type="url"
            placeholder="http://127.0.0.1:14242"
          />
          <p v-if="!isBaseUrlValid" role="alert" class="text-xs text-destructive">
            {{ t('settings.knowledgeBase.nowledgeMem.invalidBaseUrl') }}
          </p>
        </div>

        <!-- API Key -->
        <div class="space-y-2">
          <Label for="apiKey">
            {{ $t('settings.knowledgeBase.nowledgeMem.apiKey') }}
          </Label>
          <div class="relative">
            <Input
              id="apiKey"
              data-testid="nowledge-mem-api-key-input"
              v-model="config.apiKey"
              :disabled="formDisabled"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="Your API key (optional)"
              style="padding-right: 2.5rem !important"
            />
            <Button
              variant="ghost"
              size="sm"
              class="absolute right-2 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0 hover:bg-transparent"
              @click="showApiKey = !showApiKey"
            >
              <Icon
                :icon="showApiKey ? 'lucide:eye-off' : 'lucide:eye'"
                class="w-4 h-4 text-muted-foreground hover:text-foreground"
              />
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t('settings.knowledgeBase.nowledgeMem.apiKeyHint') }}
          </p>
        </div>

        <!-- Timeout -->
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-4">
            <Label for="timeout" class="flex-1">
              {{ $t('settings.knowledgeBase.nowledgeMem.timeout') }}
            </Label>
            <div class="shrink-0 flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                class="h-8 w-8"
                @click="decreaseTimeout"
                :disabled="formDisabled || timeoutSeconds <= minTimeoutSeconds"
              >
                <Icon icon="lucide:minus" class="h-3 w-3" />
              </Button>
              <div class="relative">
                <div
                  v-if="!isEditingTimeout"
                  @click="startEditingTimeout"
                  class="min-w-16 h-8 flex items-center justify-center text-sm font-semibold hover:bg-accent rounded px-2"
                >
                  {{ timeoutSeconds }}
                </div>
                <Input
                  v-else
                  id="timeout"
                  ref="timeoutInputRef"
                  type="number"
                  :min="minTimeoutSeconds"
                  :max="maxTimeoutSeconds"
                  :step="timeoutStep"
                  :model-value="timeoutSeconds"
                  :disabled="formDisabled"
                  @update:model-value="handleTimeoutChange"
                  @blur="stopEditingTimeout"
                  @keydown.enter="stopEditingTimeout"
                  @keydown.escape="stopEditingTimeout"
                  class="min-w-16 h-8 text-center text-sm font-semibold rounded px-2"
                  :class="{ 'bg-accent': isEditingTimeout }"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                class="h-7 w-7"
                @click="increaseTimeout"
                :disabled="formDisabled || timeoutSeconds >= maxTimeoutSeconds"
              >
                <Icon icon="lucide:plus" class="h-3 w-3" />
              </Button>
              <span class="text-xs text-muted-foreground ml-1">{{
                $t('settings.knowledgeBase.nowledgeMem.seconds')
              }}</span>
            </div>
          </div>
        </div>
        <!-- Save Configuration Button -->
        <div class="flex flex-wrap items-center gap-2">
          <Button
            data-testid="nowledge-mem-save-button"
            @click="saveConfiguration"
            :disabled="formDisabled || !isDirty || !isConfigValid"
            variant="default"
            size="sm"
            class="text-xs"
          >
            {{ $t('settings.knowledgeBase.nowledgeMem.saveConfig') }}
          </Button>

          <Button
            data-testid="nowledge-mem-reset-button"
            @click="resetConfiguration"
            :disabled="formDisabled"
            variant="outline"
            size="sm"
            class="text-xs"
          >
            {{ $t('settings.knowledgeBase.nowledgeMem.resetConfig') }}
          </Button>
          <Button
            data-testid="nowledge-mem-test-button"
            @click="testConnection"
            :disabled="formDisabled || !isConfigValid"
            variant="outline"
            size="sm"
            class="text-xs"
          >
            {{ $t('settings.knowledgeBase.nowledgeMem.testConnection') }}
          </Button>
          <InlineOperationFeedback
            :snapshot="operationFeedback"
            :retry-label="t('common.retry')"
            @retry="retryOperation"
          />
        </div>
        <div
          v-if="loadError"
          role="alert"
          class="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <span>{{ loadError }}</span>
          <Button size="sm" variant="ghost" :disabled="loadingConfig" @click="loadConfiguration">
            {{ t('common.retry') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import { createNowledgeMemClient } from '@api/NowledgeMemClient'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Icon } from '@iconify/vue'
import InlineOperationFeedback from '@renderer-notifications/InlineOperationFeedback.vue'
import { createRendererSurfaceFeedbackController } from '@renderer-notifications/rendererNotificationRuntime'
import { useSurfaceFeedback } from '@renderer-notifications/useSurfaceFeedback'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'
import type { NowledgeMemConfig } from '@shared/contracts/routes'

const nowledgeMemClient = createNowledgeMemClient()
const { t } = useI18n()
const feedbackController = createRendererSurfaceFeedbackController('settings')
const { snapshot: operationFeedback, setActive: setFeedbackSurfaceActive } =
  useSurfaceFeedback(feedbackController)
const operationId = `settings.nowledgeMem.configuration:${nanoid(8)}`

type RetryOperation = 'save' | 'reset' | 'test'

const loadingConfig = ref(false)
const loadError = ref<string | null>(null)
const retryKind = ref<RetryOperation | null>(null)
const showApiKey = ref(false)
const showConfigPanel = ref(false)

const defaultConfig: NowledgeMemConfig = {
  baseUrl: 'http://127.0.0.1:14242',
  apiKey: '',
  timeout: 30000
}
const config = reactive<NowledgeMemConfig>({ ...defaultConfig })
const persistedConfig = ref<NowledgeMemConfig>({ ...defaultConfig })

const minTimeoutSeconds = 5
const maxTimeoutSeconds = 120
const timeoutStep = 5
const isEditingTimeout = ref(false)
const timeoutInputRef = ref<{ dom: HTMLInputElement }>()
const operationPending = computed(() => operationFeedback.value.status === 'pending')
const formDisabled = computed(() => loadingConfig.value || operationPending.value)
const configSignature = computed(() =>
  JSON.stringify({
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey ?? '',
    timeout: config.timeout
  })
)
const persistedSignature = computed(() => JSON.stringify(persistedConfig.value))
const isDirty = computed(() => configSignature.value !== persistedSignature.value)
const isBaseUrlValid = computed(() => {
  try {
    const url = new URL(config.baseUrl.trim())
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
})
const isConfigValid = computed(
  () =>
    isBaseUrlValid.value &&
    Number.isInteger(config.timeout) &&
    config.timeout >= minTimeoutSeconds * 1000 &&
    config.timeout <= maxTimeoutSeconds * 1000
)

// Computed property for timeout in seconds for UI
const timeoutSeconds = computed({
  get: () => Math.round(config.timeout / 1000),
  set: (value: number) => {
    config.timeout = value * 1000
  }
})

const toggleNowledgeMemConfigPanel = () => {
  showConfigPanel.value = !showConfigPanel.value
}

const loadConfiguration = async () => {
  if (loadingConfig.value || operationPending.value) return
  loadingConfig.value = true
  loadError.value = null
  try {
    const savedConfig = await nowledgeMemClient.getConfig()
    const normalized = normalizeConfig(savedConfig)
    Object.assign(config, normalized)
    persistedConfig.value = normalized
  } catch (error) {
    console.error('Failed to load nowledge-mem config:', error)
    loadError.value = t('settings.knowledgeBase.nowledgeMem.configLoadFailed')
  } finally {
    loadingConfig.value = false
  }
}

const handleTimeoutChange = (value: string | number) => {
  const numericValue = typeof value === 'string' ? parseInt(value, 10) : value
  if (isNaN(numericValue)) return
  const clampedValue = Math.min(Math.max(numericValue, minTimeoutSeconds), maxTimeoutSeconds)
  timeoutSeconds.value = clampedValue
}

const increaseTimeout = () => {
  handleTimeoutChange(timeoutSeconds.value + timeoutStep)
}

const decreaseTimeout = () => {
  handleTimeoutChange(timeoutSeconds.value - timeoutStep)
}

const startEditingTimeout = () => {
  if (formDisabled.value) return
  isEditingTimeout.value = true
}

const stopEditingTimeout = () => {
  isEditingTimeout.value = false
}

watch(
  () => isEditingTimeout.value,
  async (isEditing) => {
    if (isEditing) {
      await nextTick()
      timeoutInputRef.value?.dom?.focus?.()
    }
  }
)

const testConnection = async () => {
  if (formDisabled.value || !isConfigValid.value) return
  retryKind.value = 'test'
  feedbackController.begin(operationId, t('common.testing'))

  try {
    const result = await nowledgeMemClient.testConnection(normalizeConfig(config))
    if (!result.success) {
      feedbackController.fail({
        code: 'settings.nowledgeMem.connectionFailed',
        title: t('settings.knowledgeBase.nowledgeMem.testConnection'),
        description: t('settings.knowledgeBase.nowledgeMem.connectionFailed')
      })
      return
    }
    retryKind.value = null
    feedbackController.succeed({
      code: 'settings.nowledgeMem.connectionSucceeded',
      title: t('settings.knowledgeBase.nowledgeMem.connectionSucceeded')
    })
  } catch (error) {
    logOperationFailure('test connection', error)
    feedbackController.fail({
      code: 'settings.nowledgeMem.connectionFailed',
      title: t('settings.knowledgeBase.nowledgeMem.testConnection'),
      description: t('settings.knowledgeBase.nowledgeMem.connectionFailed')
    })
  }
}

const saveConfiguration = async () => {
  if (formDisabled.value || !isDirty.value || !isConfigValid.value) return
  retryKind.value = 'save'
  feedbackController.begin(operationId, t('common.saving'))

  try {
    const savedConfig = normalizeConfig(
      await nowledgeMemClient.updateConfig(normalizeConfig(config))
    )
    Object.assign(config, savedConfig)
    persistedConfig.value = savedConfig
    loadError.value = null
    retryKind.value = null
    feedbackController.succeed({
      code: 'settings.nowledgeMem.configurationSaved',
      title: t('settings.knowledgeBase.nowledgeMem.configSaved')
    })
  } catch (error) {
    logOperationFailure('save configuration', error)
    feedbackController.fail({
      code: 'settings.nowledgeMem.configurationSaveFailed',
      title: t('settings.knowledgeBase.nowledgeMem.configSaveFailed')
    })
  }
}

const resetConfiguration = async () => {
  if (formDisabled.value) return
  retryKind.value = 'reset'
  feedbackController.begin(operationId, t('common.saving'))
  try {
    const savedConfig = normalizeConfig(await nowledgeMemClient.updateConfig(defaultConfig))
    Object.assign(config, savedConfig)
    persistedConfig.value = savedConfig
    loadError.value = null
    retryKind.value = null
    feedbackController.succeed({
      code: 'settings.nowledgeMem.configurationReset',
      title: t('settings.knowledgeBase.nowledgeMem.configReset')
    })
  } catch (error) {
    logOperationFailure('reset configuration', error)
    feedbackController.fail({
      code: 'settings.nowledgeMem.configurationResetFailed',
      title: t('settings.knowledgeBase.nowledgeMem.configResetFailed')
    })
  }
}

const normalizeConfig = (value: NowledgeMemConfig): NowledgeMemConfig => ({
  baseUrl: value.baseUrl.trim().replace(/\/+$/, ''),
  apiKey: value.apiKey ?? '',
  timeout: value.timeout
})

const redactDiagnosticText = (value: string) =>
  config.apiKey ? value.replaceAll(config.apiKey, '[redacted]') : value

const createRedactedDiagnosticError = (error: unknown, seen = new WeakSet<object>()): Error => {
  if (!(error instanceof Error)) {
    return new Error(redactDiagnosticText(String(error)))
  }
  if (seen.has(error)) {
    return new Error('[circular error cause]')
  }

  seen.add(error)
  const diagnosticError = new Error(redactDiagnosticText(error.message))
  diagnosticError.name = redactDiagnosticText(error.name)
  if (error.stack) {
    diagnosticError.stack = redactDiagnosticText(error.stack)
  }
  if (error.cause !== undefined) {
    diagnosticError.cause =
      error.cause instanceof Error
        ? createRedactedDiagnosticError(error.cause, seen)
        : typeof error.cause === 'string'
          ? redactDiagnosticText(error.cause)
          : '[redacted non-error cause]'
  }
  return diagnosticError
}

const logOperationFailure = (operation: string, error: unknown) => {
  console.error(`[NowledgeMemSettings] ${operation} failed`, createRedactedDiagnosticError(error))
}

const retryOperation = () => {
  if (operationPending.value) return
  if (retryKind.value === 'save') {
    void saveConfiguration()
  } else if (retryKind.value === 'reset') {
    void resetConfiguration()
  } else if (retryKind.value === 'test') {
    void testConnection()
  }
}

const discardDraft = () => {
  Object.assign(config, persistedConfig.value)
  retryKind.value = null
  if (operationFeedback.value.status !== 'pending' && operationFeedback.value.status !== 'idle') {
    feedbackController.clearSettled()
  }
}

const leaveGuardLease = settingsLeaveGuard.register({
  id: `nowledge-mem-settings:${operationId}`,
  onDiscard: discardDraft
})
const stopLeaveRiskSync = watch(
  [operationPending, isDirty],
  ([busy, dirty]) => {
    leaveGuardLease.setRisk(busy ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)
const stopStaleFeedbackSync = watch(
  configSignature,
  () => {
    if (
      operationPending.value ||
      configSignature.value === persistedSignature.value ||
      operationFeedback.value.status === 'idle'
    ) {
      return
    }
    retryKind.value = null
    feedbackController.clearSettled()
  },
  { flush: 'sync' }
)
const stopSurfaceSync = watch(showConfigPanel, setFeedbackSurfaceActive, {
  immediate: true,
  flush: 'sync'
})

onMounted(() => {
  void loadConfiguration()
})

onBeforeUnmount(() => {
  stopLeaveRiskSync()
  stopStaleFeedbackSync()
  stopSurfaceSync()
  leaveGuardLease.release()
})
</script>
