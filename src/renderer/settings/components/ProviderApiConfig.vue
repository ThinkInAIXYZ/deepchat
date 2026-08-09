<template>
  <div class="flex flex-col gap-4">
    <div
      v-if="provider.id === 'openai'"
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
    <div class="flex flex-col items-start gap-2">
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
        @blur="handleApiHostBlur"
        @keyup.enter="handleApiHostChange(apiHost)"
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
      v-else-if="provider.id === 'openai-codex'"
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
        <div class="relative w-full">
          <Input
            data-testid="provider-api-key-input"
            :id="`${provider.id}-apikey`"
            :model-value="apiKey"
            :type="showApiKey ? 'text' : 'password'"
            :placeholder="t('settings.provider.keyPlaceholder')"
            style="padding-right: 2.5rem !important"
            @blur="handleApiKeyBlur"
            @keyup.enter="handleValidateKey"
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
          :disabled="isRefreshing"
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
      <p v-if="shouldRefreshProviderDbFirst" class="text-xs leading-5 text-muted-foreground">
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
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Label } from '@shadcn/components/ui/label'
import { Input } from '@shadcn/components/ui/input'
import { DcButton } from '@dc-ui/components/button'
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
import { isProviderDbBackedProvider } from '@shared/providerDbCatalog'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'

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
  'vertex'
])

const props = defineProps<{
  provider: LLM_PROVIDER
  providerWebsites?: ProviderWebsites
}>()

const emit = defineEmits<{
  'api-host-change': [value: string]
  'api-key-change': [value: string]
  'validate-key': [value: string]
  'delete-provider': []
  'oauth-success': []
  'oauth-error': [error: string]
}>()

const apiKey = ref(props.provider.apiKey || '')
const apiHost = ref(props.provider.baseUrl || '')
const keyStatus = ref<KeyStatus | null>(null)
const isRefreshing = ref(false)
const showApiKey = ref(false)
const baseUrlUnlocked = ref(false)
const defaultBaseUrl = computed(() => props.providerWebsites?.defaultBaseUrl?.trim() || '')
const hasDefaultBaseUrl = computed(() => defaultBaseUrl.value.length > 0)
const isBaseUrlEditableByDefault = computed(
  () => props.provider.custom || EDITABLE_BASE_URL_PROVIDER_IDS.has(props.provider.id)
)
const showLockedBaseUrl = computed(
  () => !isBaseUrlEditableByDefault.value && !baseUrlUnlocked.value
)
const shouldRefreshProviderDbFirst = computed(() => isProviderDbBackedProvider(props.provider.id))
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
const canVerifyProvider = computed(() => props.provider.enable)

watch(
  () => props.provider,
  () => {
    apiKey.value = props.provider.apiKey || ''
    apiHost.value = props.provider.baseUrl || ''
    baseUrlUnlocked.value = false
  },
  { immediate: true }
)

const handleApiKeyChange = (value: string) => {
  emit('api-key-change', value)
}

const handleApiKeyBlur = (event: FocusEvent) => {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  handleApiKeyChange(target.value)
}

const handleApiHostChange = (value: string) => {
  emit('api-host-change', value)
}

const fillDefaultBaseUrl = () => {
  if (!hasDefaultBaseUrl.value) return
  apiHost.value = defaultBaseUrl.value
  handleApiHostChange(defaultBaseUrl.value)
}

const requestBaseUrlUnlock = () => {
  baseUrlUnlocked.value = true
}

const handleApiHostBlur = (event: FocusEvent) => {
  if (showLockedBaseUrl.value) return
  const target = event.target as HTMLInputElement | null
  if (!target) return
  handleApiHostChange(target.value)
}

const handleOAuthSuccess = () => {
  emit('oauth-success')
}

const handleOAuthError = (error: string) => {
  emit('oauth-error', error)
}

const handleValidateKey = () => {
  if (!canVerifyProvider.value) {
    return
  }

  emit('validate-key', apiKey.value)
}

const openModelCheckDialog = () => {
  if (!canVerifyProvider.value) {
    return
  }

  modelCheckStore.openDialog(props.provider.id)
}

const getKeyStatus = async () => {
  if (
    ['ppio', 'openrouter', 'siliconcloud', 'silicon', 'deepseek', '302ai', 'cherryin'].includes(
      props.provider.id
    ) &&
    props.provider.apiKey
  ) {
    try {
      keyStatus.value = await providerClient.getKeyStatus(props.provider.id)
    } catch (error) {
      console.error('[ProviderApiConfig] Failed to load key status', error)
      keyStatus.value = null
    }
  }
}

const refreshModels = async () => {
  if (isRefreshing.value) return

  const providerId = props.provider.id
  const refreshesMetadata = shouldRefreshProviderDbFirst.value
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

onMounted(() => {
  getKeyStatus()
})
</script>
