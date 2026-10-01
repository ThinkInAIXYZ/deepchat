<template>
  <div class="flex flex-col gap-4">
    <div v-if="provider.id === 'openai'" class="flex flex-col gap-2">
      <Label>{{ t('settings.provider.openaiAuthMethod') }}</Label>
      <div class="flex flex-wrap gap-2">
        <DcButton
          data-testid="openai-api-key-mode-button"
          :variant="isOpenAIChatGPTMode ? 'outline' : 'default'"
          size="sm"
          :disabled="isSaving || isDirty"
          @click="$emit('auth-mode-change', 'api-key')"
        >
          {{ t('settings.provider.openaiApiKeyMode') }}
        </DcButton>
        <DcButton
          data-testid="openai-chatgpt-mode-button"
          :variant="isOpenAIChatGPTMode ? 'default' : 'outline'"
          size="sm"
          :disabled="isSaving || isDirty"
          @click="$emit('auth-mode-change', 'chatgpt')"
        >
          {{ t('settings.provider.openaiChatGPTMode') }}
        </DcButton>
      </div>
      <p v-if="isOpenAIChatGPTMode" class="text-xs leading-5 text-muted-foreground">
        {{ t('settings.provider.openaiChatGPTBackendNotice') }}
      </p>
    </div>
    <div
      v-if="provider.id === 'openai' && !isOpenAIChatGPTMode"
      class="w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900"
    >
      <div class="flex items-start gap-2">
        <Icon icon="lucide:triangle-alert" class="h-4 w-4 mt-0.5 shrink-0" />
        <p class="text-sm font-medium leading-5">
          {{ t('settings.provider.openaiResponsesNotice') }}
        </p>
      </div>
    </div>

    <!-- API URL 配置 -->
    <div v-if="!isOpenAIChatGPTMode" class="flex flex-col items-start gap-2">
      <div class="flex justify-between items-center w-full">
        <Label :for="`${provider.id}-url`" class="flex-1">API URL</Label>
        <DcButton
          v-if="provider.custom"
          variant="destructive"
          size="sm"
          class="text-xs rounded-lg"
          @click="$emit('delete-provider')"
        >
          <Icon icon="lucide:trash-2" class="w-4 h-4 mr-1" />{{ t('settings.provider.delete') }}
        </DcButton>
      </div>
      <div v-if="showLockedBaseUrl" class="flex w-full items-center gap-2">
        <div
          :id="`${provider.id}-url`"
          class="flex h-9 flex-1 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground"
        >
          <span class="truncate">
            {{ apiHost || t('settings.provider.urlPlaceholder') }}
          </span>
        </div>
        <DcButton
          variant="outline"
          size="sm"
          class="shrink-0 text-xs"
          @click="requestBaseUrlUnlock"
        >
          {{ t('settings.provider.modifyBaseUrl') }}
        </DcButton>
      </div>
      <Input
        v-else
        :id="`${provider.id}-url`"
        :model-value="apiHost"
        :placeholder="t('settings.provider.urlPlaceholder')"
        :disabled="isSaving"
        @keyup.enter="saveConnection"
        @update:model-value="apiHost = String($event)"
      />
      <div class="text-xs text-muted-foreground">
        <TooltipProvider v-if="hasDefaultBaseUrl && !showLockedBaseUrl" :delayDuration="200">
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                class="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                :aria-label="t('settings.provider.urlFormatFill')"
                @click="fillDefaultBaseUrl"
              >
                {{
                  t('settings.provider.urlFormat', {
                    defaultUrl: defaultBaseUrl
                  })
                }}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {{ t('settings.provider.urlFormatFill') }}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span v-else-if="showLockedBaseUrl">
          {{ t('settings.provider.baseUrlLockedHint') }}
        </span>
        <span v-else>
          {{
            t('settings.provider.urlFormat', {
              defaultUrl: defaultBaseUrl
            })
          }}
        </span>
      </div>
    </div>

    <GitHubCopilotOAuth
      v-if="provider.id === 'github-copilot'"
      :provider="provider"
      @auth-success="handleOAuthSuccess"
      @auth-error="handleOAuthError"
    />

    <OpenAICodexOAuth
      v-else-if="provider.id === 'openai-codex' || isOpenAIChatGPTMode"
      :provider="provider"
      @auth-success="handleOAuthSuccess"
      @auth-error="handleOAuthError"
    />

    <div v-else class="flex flex-col items-start gap-4">
      <GrokOAuth
        v-if="isGrokOAuthAvailable"
        :provider="provider"
        @auth-success="handleOAuthSuccess"
        @auth-error="handleOAuthError"
      />

      <div
        v-if="isGrokOAuthAvailable"
        class="w-full border-t border-border pt-3 text-xs text-muted-foreground"
      >
        {{ t('settings.provider.xaiGrokApiKeyAlternative') }}
      </div>

      <div class="flex flex-col gap-2 w-full">
        <Label :for="`${provider.id}-apikey`" class="w-full">API Key</Label>
        <div v-if="showKeySummary" class="flex w-full items-center gap-2">
          <div
            data-testid="provider-api-key-summary"
            class="group flex h-9 flex-1 items-center gap-1 rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground"
          >
            <span class="min-w-0 flex-1 truncate font-mono">{{ maskedApiKey }}</span>
            <DcCopyButton
              data-testid="provider-copy-key-button"
              :copy-text="provider.apiKey"
              variant="ghost"
              size="icon-xs"
              :tooltip="t('common.copy')"
              class="shrink-0 opacity-0 pointer-events-none transition-opacity duration-[var(--dc-motion-fast)] focus-visible:opacity-100 focus-visible:pointer-events-auto group-hover:opacity-100 group-hover:pointer-events-auto"
            />
          </div>
          <DcButton
            data-testid="provider-update-key-button"
            variant="outline"
            size="sm"
            class="shrink-0 text-xs"
            @click="startEditingKey"
          >
            {{ t('settings.provider.updateKey') }}
          </DcButton>
        </div>
        <div v-else class="relative w-full">
          <Input
            data-testid="provider-api-key-input"
            :id="`${provider.id}-apikey`"
            :model-value="apiKey"
            :type="showApiKey ? 'text' : 'password'"
            :placeholder="t('settings.provider.keyPlaceholder')"
            :disabled="isSaving"
            style="padding-right: 2.5rem !important"
            @keyup.enter="saveConnection"
            @update:model-value="apiKey = String($event)"
          />
          <DcButton
            variant="ghost"
            size="sm"
            class="absolute right-2 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0 hover:bg-transparent"
            :tooltip="showApiKey ? t('common.hideValue') : t('common.showValue')"
            @click="showApiKey = !showApiKey"
          >
            <Icon
              :icon="showApiKey ? 'lucide:eye-off' : 'lucide:eye'"
              class="w-4 h-4 text-muted-foreground hover:text-foreground"
            />
          </DcButton>
        </div>
        <DcInlineError
          v-if="keyStatusError"
          data-testid="provider-key-status-error"
          :error="keyStatusError"
          class="min-w-0 break-words dark:text-red-400"
        />
        <div
          v-if="
            keyStatus && (keyStatus.usage !== undefined || keyStatus.limit_remaining !== undefined)
          "
          class="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <div v-if="keyStatus.usage !== undefined" class="flex items-center gap-1">
            <Icon icon="lucide:activity" class="w-3 h-3" />
            <span>{{ t('settings.provider.keyStatus.usage') }}: {{ keyStatus.usage }}</span>
          </div>
          <div v-if="keyStatus.limit_remaining !== undefined" class="flex items-center gap-1">
            <Icon icon="lucide:coins" class="w-3 h-3" />
            <span
              >{{ t('settings.provider.keyStatus.remaining') }}:
              {{ keyStatus.limit_remaining }}</span
            >
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="
        !isOpenAIChatGPTMode &&
        (isDirty || isEditingKey || baseUrlUnlocked || isSaving || saveError)
      "
      class="flex flex-col gap-2"
      data-testid="provider-connection-actions"
    >
      <DcInlineError v-if="saveError" :error="saveError" data-testid="provider-connection-error" />
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="isDirty" class="text-xs text-muted-foreground" role="status">
          {{ t('settings.leaveGuard.dirtyTitle') }}
        </span>
        <DcButton
          data-testid="provider-connection-save"
          size="sm"
          :disabled="!isDirty || isSaving || !apiHost.trim()"
          @click="saveConnection"
        >
          <Spinner v-if="isSaving" data-icon="inline-start" />
          {{ t('common.save') }}
        </DcButton>
        <DcButton
          data-testid="provider-connection-cancel"
          variant="outline"
          size="sm"
          :disabled="isSaving"
          @click="resetConnection"
        >
          {{ t('common.cancel') }}
        </DcButton>
      </div>
    </div>

    <div
      v-if="!isOpenAIChatGPTMode && !['github-copilot', 'openai-codex'].includes(provider.id)"
      class="flex flex-col items-start gap-4"
    >
      <div class="flex flex-row gap-2">
        <DcButton
          data-testid="provider-verify-button"
          variant="outline"
          size="sm"
          class="text-xs text-normal rounded-lg"
          :disabled="!canVerifyProvider"
          @click="openModelCheckDialog"
        >
          <Icon icon="lucide:check-check" class="w-4 h-4 text-muted-foreground" />{{
            t('settings.provider.verifyKey')
          }}
        </DcButton>
        <DcButton
          data-testid="provider-refresh-models-button"
          variant="outline"
          size="sm"
          class="text-xs text-normal rounded-lg"
          :disabled="isRefreshing || isDirty || isSaving"
          @click="refreshModels"
        >
          <Spinner
            v-if="isRefreshing"
            class="size-4 text-muted-foreground"
            data-icon="inline-start"
          />
          <Icon
            v-else
            icon="lucide:refresh-cw"
            class="size-4 text-muted-foreground"
            data-icon="inline-start"
          />
          {{
            isRefreshing
              ? t('settings.provider.refreshingModels')
              : t('settings.provider.refreshModels')
          }}
        </DcButton>
      </div>
      <p v-if="usesProviderDb" class="text-xs leading-5 text-muted-foreground">
        {{ t('settings.provider.refreshModelsWithMetadataHint') }}
      </p>
      <p
        v-if="provider.id === 'amd-developer'"
        data-testid="amd-developer-hint"
        class="text-xs leading-5 text-muted-foreground"
      >
        {{ t('settings.provider.amdDeveloperHint') }}
      </p>
      <div v-if="!provider.custom" class="text-xs text-muted-foreground">
        {{ t('settings.provider.howToGet') }}: {{ t('settings.provider.getKeyTip') }}
        <a :href="providerApiKeyUrl" target="_blank" class="text-primary">{{ provider.name }}</a>
        {{ t('settings.provider.getKeyTipEnd') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { Label } from '@shadcn/components/ui/label'
import { Input } from '@shadcn/components/ui/input'
import { DcButton, DcCopyButton } from '@dc-ui/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Icon } from '@iconify/vue'
import GitHubCopilotOAuth from './GitHubCopilotOAuth.vue'
import OpenAICodexOAuth from './OpenAICodexOAuth.vue'
import GrokOAuth from './GrokOAuth.vue'
import { createProviderClient } from '@api/ProviderClient'
import { useModelCheckStore } from '@/stores/modelCheck'
import type { LLM_PROVIDER, KeyStatus } from '@shared/types/provider'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

interface ProviderWebsites {
  official: string
  apiKey: string
  docs: string
  models: string
  defaultBaseUrl: string
}

const { t } = useI18n()
const providerClient = createProviderClient()
const modelCheckStore = useModelCheckStore()

const EDITABLE_BASE_URL_PROVIDER_IDS = new Set([
  'openai',
  'openai-responses',
  'new-api',
  'anthropic',
  'gemini',
  'ollama',
  'lmstudio',
  'azure-openai',
  'vertex',
  // Tenant-specific endpoint: the Cloudflare account id is a path segment of the base URL.
  'cloudflare'
])

const props = defineProps<{
  provider: LLM_PROVIDER
  providerWebsites?: ProviderWebsites
  usesProviderDb?: boolean
  save: (providerId: string, updates: { apiKey: string; baseUrl: string }) => Promise<void>
}>()

const emit = defineEmits<{
  'auth-mode-change': [value: 'api-key' | 'chatgpt']
  'delete-provider': []
  'oauth-success': []
  'oauth-error': [error: string]
}>()

const apiKey = ref(props.provider.apiKey || '')
const apiHost = ref(props.provider.baseUrl || '')
const isOpenAIChatGPTMode = computed(
  () => props.provider.id === 'openai' && props.provider.openaiAuthMode === 'chatgpt'
)
const keyStatus = ref<KeyStatus | null>(null)
const keyStatusError = ref('')
const isRefreshing = ref(false)
const showApiKey = ref(false)
const isEditingKey = ref(false)
const baseUrlUnlocked = ref(false)
const isSaving = ref(false)
const saveError = ref('')
const replacementKey = computed(() => apiKey.value.trim() || props.provider.apiKey || '')
const isDirty = computed(
  () =>
    replacementKey.value !== (props.provider.apiKey || '') ||
    apiHost.value.trim() !== (props.provider.baseUrl || '')
)
// After setup the stored key renders as a masked summary; the full secret is
// never shown again — replacing it goes through the explicit Update key action.
// The copy button writes the plaintext key to the clipboard as an explicit
// user action without ever displaying it on screen.
const showKeySummary = computed(() => !isEditingKey.value && Boolean(props.provider.apiKey?.trim()))
const maskedApiKey = computed(() => {
  const key = props.provider.apiKey?.trim() ?? ''
  return key.length > 8 ? `••••••••${key.slice(-4)}` : '••••••••'
})
const defaultBaseUrl = computed(() => props.providerWebsites?.defaultBaseUrl?.trim() || '')
const hasDefaultBaseUrl = computed(() => defaultBaseUrl.value.length > 0)
const isBaseUrlEditableByDefault = computed(
  () => props.provider.custom || EDITABLE_BASE_URL_PROVIDER_IDS.has(props.provider.id)
)
const showLockedBaseUrl = computed(
  () => !isBaseUrlEditableByDefault.value && !baseUrlUnlocked.value
)
const isGrokOAuthAvailable = computed(() => {
  if (props.provider.id !== 'grok') {
    return false
  }

  try {
    const url = new URL(apiHost.value.trim())
    return url.protocol === 'https:' && (url.hostname === 'x.ai' || url.hostname.endsWith('.x.ai'))
  } catch {
    return false
  }
})
const providerApiKeyUrl = computed(() => {
  if (props.provider.id !== 'new-api') {
    return props.providerWebsites?.apiKey || ''
  }

  const normalizedHost = apiHost.value.trim() || defaultBaseUrl.value
  if (!normalizedHost) {
    return props.providerWebsites?.apiKey || ''
  }

  try {
    const parsedUrl = new URL(normalizedHost)
    return `${parsedUrl.origin}/console/token`
  } catch {
    return props.providerWebsites?.apiKey || ''
  }
})
const canVerifyProvider = computed(() => props.provider.enable && !isDirty.value && !isSaving.value)

const resetConnection = () => {
  apiKey.value = props.provider.apiKey || ''
  apiHost.value = props.provider.baseUrl || ''
  baseUrlUnlocked.value = false
  isEditingKey.value = false
  showApiKey.value = false
  saveError.value = ''
}

watch(
  [() => props.provider.id, () => props.provider.apiKey, () => props.provider.baseUrl],
  resetConnection,
  { immediate: true }
)

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'settings.providerConnection',
  onDiscard: resetConnection
})
watch(
  [isSaving, isDirty],
  ([busy, dirty]) => {
    leaveGuardLease.setRisk(busy ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)
onUnmounted(() => leaveGuardLease.release())

const saveConnection = async () => {
  if (!isDirty.value || isSaving.value || !apiHost.value.trim()) return
  isSaving.value = true
  saveError.value = ''
  try {
    await props.save(props.provider.id, {
      apiKey: replacementKey.value,
      baseUrl: apiHost.value.trim()
    })
    resetConnection()
  } catch {
    // Do not echo persistence errors that may contain the submitted credential.
    saveError.value = t('settings.deepchatAgents.saveFeedback.saveFailed')
  } finally {
    isSaving.value = false
  }
}

const startEditingKey = () => {
  isEditingKey.value = true
  apiKey.value = ''
  showApiKey.value = false
}

const fillDefaultBaseUrl = () => {
  if (!hasDefaultBaseUrl.value) return
  apiHost.value = defaultBaseUrl.value
}

const requestBaseUrlUnlock = () => {
  baseUrlUnlocked.value = true
}

const handleOAuthSuccess = () => {
  emit('oauth-success')
}

const handleOAuthError = (error: string) => {
  emit('oauth-error', error)
}

const openModelCheckDialog = () => {
  if (!canVerifyProvider.value) {
    return
  }

  modelCheckStore.openDialog(props.provider.id)
}

watch(
  [() => props.provider.id, () => props.provider.apiKey, () => props.provider.baseUrl],
  async ([providerId, storedApiKey], _previous, onCleanup) => {
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    keyStatus.value = null
    keyStatusError.value = ''

    if (
      !storedApiKey ||
      !['ppio', 'openrouter', 'deepseek', '302ai', 'cherryin'].includes(providerId)
    ) {
      return
    }

    try {
      const status = await providerClient.getKeyStatus(providerId)
      if (!cancelled) keyStatus.value = status
    } catch (error) {
      if (cancelled) return
      const message = error instanceof Error ? error.message : String(error ?? '')
      keyStatusError.value =
        message
          .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
          .replaceAll(storedApiKey, '••••••••') || t('settings.provider.dialog.verify.failedDesc')
    }
  },
  { immediate: true }
)

const refreshModels = async () => {
  if (isRefreshing.value) return

  const providerId = props.provider.id
  const refreshesMetadata = props.usesProviderDb
  isRefreshing.value = true
  try {
    await providerClient.refreshModels(providerId)
    notifyRenderer({
      kind: 'success',
      code: 'settings.provider.modelsRefreshed',
      title: t('settings.provider.toast.refreshModelsSuccessTitle'),
      description: t(
        refreshesMetadata
          ? 'settings.provider.toast.refreshModelsSuccessDescriptionWithMetadata'
          : 'settings.provider.toast.refreshModelsSuccessDescription'
      )
    })
  } catch (error) {
    console.error('[ProviderApiConfig] Failed to refresh models', error)
    const fallbackDescription = t(
      refreshesMetadata
        ? 'settings.provider.toast.refreshModelsFailedDescriptionWithMetadata'
        : 'settings.provider.toast.refreshModelsFailedDescription'
    )
    notifyRenderer({
      kind: 'error',
      code: 'settings.provider.modelRefreshFailed',
      title: t('settings.provider.toast.refreshModelsFailedTitle'),
      description: fallbackDescription
    })
  } finally {
    isRefreshing.value = false
  }
}
</script>
