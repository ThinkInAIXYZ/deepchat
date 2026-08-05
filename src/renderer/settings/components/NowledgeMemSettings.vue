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
          <DcInlineError
            v-if="!isBaseUrlValid"
            :error="t('settings.knowledgeBase.nowledgeMem.invalidBaseUrl')"
          />
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
            <DcButton
              variant="ghost"
              size="icon-sm"
              :icon="showApiKey ? 'lucide:eye-off' : 'lucide:eye'"
              :label="$t('settings.knowledgeBase.nowledgeMem.apiKey')"
              :tooltip="$t('settings.knowledgeBase.nowledgeMem.apiKey')"
              class="absolute right-2 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0 hover:bg-transparent"
              @click="showApiKey = !showApiKey"
            />
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
              <DcButton
                variant="outline"
                size="icon"
                icon="lucide:minus"
                icon-size="3"
                :label="$t('common.decrease')"
                :tooltip="$t('common.decrease')"
                class="h-8 w-8"
                @click="decreaseTimeout"
                :disabled="formDisabled || timeoutSeconds <= minTimeoutSeconds"
              />
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
              <DcButton
                variant="outline"
                size="icon"
                icon="lucide:plus"
                icon-size="3"
                :label="$t('common.increase')"
                :tooltip="$t('common.increase')"
                class="h-7 w-7"
                @click="increaseTimeout"
                :disabled="formDisabled || timeoutSeconds >= maxTimeoutSeconds"
              />
              <span class="text-xs text-muted-foreground ml-1">{{
                $t('settings.knowledgeBase.nowledgeMem.seconds')
              }}</span>
            </div>
          </div>
        </div>
        <!-- Save Configuration Button -->
        <div class="flex flex-wrap items-center gap-2">
          <DcSubmitButton
            data-testid="nowledge-mem-save-button"
            :status="saveStatus"
            variant="default"
            size="sm"
            class="text-xs"
            :disabled="!isDirty || !isConfigValid"
            @click="saveConfiguration"
          >
            {{ $t('settings.knowledgeBase.nowledgeMem.saveConfig') }}
          </DcSubmitButton>

          <DcSubmitButton
            data-testid="nowledge-mem-reset-button"
            :status="resetStatus"
            variant="outline"
            size="sm"
            class="text-xs"
            @click="resetConfiguration"
          >
            {{ $t('settings.knowledgeBase.nowledgeMem.resetConfig') }}
          </DcSubmitButton>
          <DcSubmitButton
            data-testid="nowledge-mem-test-button"
            :status="testStatus"
            variant="outline"
            size="sm"
            class="text-xs"
            :disabled="!isConfigValid"
            @click="testConnection"
          >
            {{ $t('settings.knowledgeBase.nowledgeMem.testConnection') }}
          </DcSubmitButton>
        </div>
        <DcInlineError v-if="operationError" :error="operationError" class="mt-2" />
        <div
          v-if="loadError"
          role="alert"
          class="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <span>{{ loadError }}</span>
          <DcButton size="sm" variant="ghost" :disabled="loadingConfig" @click="loadConfiguration">
            {{ t('common.retry') }}
          </DcButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createNowledgeMemClient } from '@api/NowledgeMemClient'
import { DcButton } from '@dc-ui/components/button'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { DcSubmitButton, useDcFormSubmit } from '@dc-ui/components/form'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'
import type { NowledgeMemConfig } from '@shared/contracts/routes'

const nowledgeMemClient = createNowledgeMemClient()
const { t } = useI18n()

const loadingConfig = ref(false)
const loadError = ref<string | null>(null)
const showApiKey = ref(false)
const showConfigPanel = ref(false)
const operationError = ref<string | null>(null)
const { status: saveStatus, run: runSave } = useDcFormSubmit()
const { status: testStatus, run: runTest } = useDcFormSubmit()
const { status: resetStatus, run: runReset } = useDcFormSubmit()
const anyOperationPending = computed(
  () =>
    saveStatus.value === 'submitting' ||
    testStatus.value === 'submitting' ||
    resetStatus.value === 'submitting'
)

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
const formDisabled = computed(() => loadingConfig.value || anyOperationPending.value)
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
  if (loadingConfig.value || anyOperationPending.value) return
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

const testConnection = () => {
  if (formDisabled.value || !isConfigValid.value) return

  operationError.value = null
  void runTest(async () => {
    const result = await nowledgeMemClient.testConnection(normalizeConfig(config))
    if (!result.success) {
      throw new Error(t('settings.knowledgeBase.nowledgeMem.connectionFailed'))
    }
  }).catch((error: unknown) => {
    logOperationFailure('test connection', error)
    operationError.value = t('settings.knowledgeBase.nowledgeMem.connectionFailed')
  })
}

const saveConfiguration = () => {
  if (formDisabled.value || !isDirty.value || !isConfigValid.value) return

  operationError.value = null
  void runSave(async () => {
    const savedConfig = normalizeConfig(
      await nowledgeMemClient.updateConfig(normalizeConfig(config))
    )
    Object.assign(config, savedConfig)
    persistedConfig.value = savedConfig
    loadError.value = null
  }).catch((error: unknown) => {
    logOperationFailure('save configuration', error)
    operationError.value = t('settings.knowledgeBase.nowledgeMem.configSaveFailed')
  })
}

const resetConfiguration = () => {
  if (formDisabled.value) return
  operationError.value = null
  void runReset(async () => {
    const savedConfig = normalizeConfig(await nowledgeMemClient.updateConfig(defaultConfig))
    Object.assign(config, savedConfig)
    persistedConfig.value = savedConfig
    loadError.value = null
  }).catch((error: unknown) => {
    logOperationFailure('reset configuration', error)
    operationError.value = t('settings.knowledgeBase.nowledgeMem.configResetFailed')
  })
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

const discardDraft = () => {
  Object.assign(config, persistedConfig.value)
}

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'nowledge-mem-settings',
  onDiscard: discardDraft
})
const stopLeaveRiskSync = watch(
  [anyOperationPending, isDirty],
  ([busy, dirty]) => {
    leaveGuardLease.setRisk(busy ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

onMounted(() => {
  void loadConfiguration()
})

onBeforeUnmount(() => {
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>
