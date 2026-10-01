<template>
  <div class="flex flex-col gap-4">
    <div v-if="provider.id === 'openai'" class="flex flex-col gap-2">
      <Label>{{ t('settings.provider.openaiAuthMethod') }}</Label>
      <div class="flex flex-wrap gap-2">
        <DcButton
          data-testid="openai-api-key-mode-button"
          :variant="isOpenAIChatGPTMode ? 'outline' : 'default'"
          size="sm"
          :disabled="editorOpen || isSaving"
          @click="$emit('auth-mode-change', 'api-key')"
        >
          {{ t('settings.provider.openaiApiKeyMode') }}
        </DcButton>
        <DcButton
          data-testid="openai-chatgpt-mode-button"
          :variant="isOpenAIChatGPTMode ? 'default' : 'outline'"
          size="sm"
          :disabled="editorOpen || isSaving"
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

    <Dialog :open="editorOpen" @update:open="handleEditorOpenChange">
      <div v-if="!isOpenAIChatGPTMode" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm font-medium">API URL</span>
          <div class="flex items-center gap-2">
            <DcButton
              v-if="provider.custom"
              variant="ghost"
              size="sm"
              class="text-destructive"
              @click="$emit('delete-provider')"
            >
              <Icon icon="lucide:trash-2" class="size-4" />
              {{ t('settings.provider.delete') }}
            </DcButton>
            <DialogTrigger as-child>
              <DcButton data-testid="provider-connection-edit" variant="outline" size="sm">
                <Icon icon="lucide:pencil" class="size-3.5" />
                {{ t('settings.provider.connectionEditor.title') }}
              </DcButton>
            </DialogTrigger>
          </div>
        </div>
        <p
          data-testid="provider-url-summary"
          class="text-sm leading-5 text-muted-foreground break-all"
        >
          {{ provider.baseUrl || t('settings.provider.center.noApiUrl') }}
        </p>
      </div>

      <DialogContent
        data-testid="provider-connection-dialog"
        class="max-h-[85vh] overflow-y-auto sm:max-w-lg"
        :hide-close="isSaving"
      >
        <DialogHeader>
          <DialogTitle>{{ t('settings.provider.connectionEditor.title') }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.provider.connectionEditor.description') }}
          </DialogDescription>
        </DialogHeader>
        <form class="flex min-w-0 flex-col gap-4" @submit.prevent="saveConnection">
          <div class="flex min-w-0 flex-col gap-2">
            <Label :for="`${provider.id}-url`">API URL</Label>
            <Input
              :id="`${provider.id}-url`"
              data-testid="provider-api-url-input"
              v-model="apiHost"
              :placeholder="t('settings.provider.urlPlaceholder')"
              :disabled="isSaving"
              :spellcheck="false"
              autocomplete="off"
            />
            <button
              v-if="defaultBaseUrl"
              type="button"
              class="text-left text-xs leading-5 text-muted-foreground underline decoration-dotted underline-offset-2 break-all hover:text-foreground disabled:pointer-events-none"
              :aria-label="t('settings.provider.urlFormatFill')"
              :disabled="isSaving"
              @click="apiHost = defaultBaseUrl"
            >
              {{ t('settings.provider.urlFormat', { defaultUrl: defaultBaseUrl }) }}
            </button>
          </div>
          <template v-if="usesApiKey">
            <div v-if="hasStoredKey" class="flex flex-col gap-1">
              <span class="text-sm font-medium">
                {{ t('settings.provider.connectionEditor.currentKey') }}
              </span>
              <span
                data-testid="provider-current-key"
                class="font-mono text-sm text-muted-foreground"
              >
                {{ maskedApiKey }}
              </span>
            </div>
            <div class="flex flex-col gap-2">
              <Label :for="`${provider.id}-apikey`">
                {{ hasStoredKey ? t('settings.provider.connectionEditor.newKey') : 'API Key' }}
              </Label>
              <div class="relative">
                <Input
                  data-testid="provider-api-key-input"
                  :id="`${provider.id}-apikey`"
                  v-model="apiKey"
                  :type="showApiKey ? 'text' : 'password'"
                  :placeholder="t('settings.provider.keyPlaceholder')"
                  :disabled="isSaving"
                  :spellcheck="false"
                  :aria-describedby="hasStoredKey ? `${provider.id}-key-hint` : undefined"
                  autocomplete="new-password"
                  class="pr-10"
                />
                <DcButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="absolute right-1 top-1/2 -translate-y-1/2"
                  :disabled="isSaving"
                  :aria-label="showApiKey ? t('common.hideValue') : t('common.showValue')"
                  @click="showApiKey = !showApiKey"
                >
                  <Icon :icon="showApiKey ? 'lucide:eye-off' : 'lucide:eye'" class="size-4" />
                </DcButton>
              </div>
              <p
                v-if="hasStoredKey"
                :id="`${provider.id}-key-hint`"
                class="text-xs text-muted-foreground"
              >
                {{ t('settings.provider.connectionEditor.keepKey') }}
              </p>
            </div>
          </template>
          <DcInlineError
            v-if="saveError"
            :error="saveError"
            data-testid="provider-connection-error"
          />
          <DialogFooter>
            <DcButton
              data-testid="provider-connection-cancel"
              type="button"
              variant="outline"
              :disabled="isSaving"
              @click="handleEditorOpenChange(false)"
            >
              {{ t('common.cancel') }}
            </DcButton>
            <DcButton
              data-testid="provider-connection-save"
              type="submit"
              :disabled="!isDirty || isSaving || !apiHost.trim()"
            >
              <Spinner v-if="isSaving" data-icon="inline-start" />
              {{ t('common.save') }}
            </DcButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <GitHubCopilotOAuth
      v-if="provider.id === 'github-copilot'"
      :provider="provider"
      @auth-success="emit('oauth-success')"
      @auth-error="emit('oauth-error', $event)"
    />
    <OpenAICodexOAuth
      v-else-if="provider.id === 'openai-codex' || isOpenAIChatGPTMode"
      :provider="provider"
      @auth-success="emit('oauth-success')"
      @auth-error="emit('oauth-error', $event)"
    />
    <div v-else class="flex flex-col gap-4">
      <GrokOAuth
        v-if="isGrokOAuthAvailable"
        :provider="provider"
        @auth-success="emit('oauth-success')"
        @auth-error="emit('oauth-error', $event)"
      />
      <p v-if="isGrokOAuthAvailable" class="border-t pt-3 text-xs text-muted-foreground">
        {{ t('settings.provider.xaiGrokApiKeyAlternative') }}
      </p>
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <span class="text-sm font-medium">API Key</span>
          <a
            v-if="providerApiKeyUrl"
            :href="providerApiKeyUrl"
            target="_blank"
            rel="noreferrer"
            class="text-xs text-primary hover:underline"
          >
            {{ t('settings.provider.howToGet') }}
          </a>
        </div>
        <div
          v-if="hasStoredKey"
          data-testid="provider-api-key-summary"
          class="group flex min-h-8 items-center gap-2"
        >
          <span class="font-mono text-sm text-muted-foreground">{{ maskedApiKey }}</span>
          <DcCopyButton
            data-testid="provider-copy-key-button"
            :copy-text="provider.apiKey"
            variant="ghost"
            size="icon-xs"
            :tooltip="t('common.copy')"
            class="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          />
        </div>
        <p v-else data-testid="provider-key-missing" class="text-sm text-muted-foreground">
          {{ t('settings.toolchains.sources.unconfigured') }}
        </p>
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
          class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        >
          <span v-if="keyStatus.usage !== undefined">
            {{ t('settings.provider.keyStatus.usage') }}: {{ keyStatus.usage }}
          </span>
          <span v-if="keyStatus.limit_remaining !== undefined">
            {{ t('settings.provider.keyStatus.remaining') }}: {{ keyStatus.limit_remaining }}
          </span>
        </div>
      </div>
      <div class="flex items-center border-t pt-3">
        <DcButton
          data-testid="provider-verify-button"
          variant="outline"
          size="sm"
          :disabled="!canVerifyProvider"
          @click="openModelCheckDialog"
        >
          <Icon icon="lucide:check-check" class="size-4 text-muted-foreground" />
          {{ t('settings.provider.connectionEditor.test') }}
        </DcButton>
      </div>
      <p
        v-if="provider.id === 'amd-developer'"
        data-testid="amd-developer-hint"
        class="text-xs leading-5 text-muted-foreground"
      >
        {{ t('settings.provider.amdDeveloperHint') }}
      </p>
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@shadcn/components/ui/dialog'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Icon } from '@iconify/vue'
import GitHubCopilotOAuth from './GitHubCopilotOAuth.vue'
import OpenAICodexOAuth from './OpenAICodexOAuth.vue'
import GrokOAuth from './GrokOAuth.vue'
import { createProviderClient } from '@api/ProviderClient'
import { useModelCheckStore } from '@/stores/modelCheck'
import type { LLM_PROVIDER, KeyStatus } from '@shared/types/provider'
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
const props = defineProps<{
  provider: LLM_PROVIDER
  providerWebsites?: ProviderWebsites
  save: (providerId: string, updates: { apiKey: string; baseUrl: string }) => Promise<void>
}>()
const emit = defineEmits<{
  'auth-mode-change': [value: 'api-key' | 'chatgpt']
  'delete-provider': []
  'oauth-success': []
  'oauth-error': [error: string]
}>()

const editorOpen = ref(false)
const apiKey = ref('')
const apiHost = ref('')
const showApiKey = ref(false)
const isSaving = ref(false)
const saveError = ref('')
const keyStatus = ref<KeyStatus | null>(null)
const keyStatusError = ref('')
const isOpenAIChatGPTMode = computed(
  () => props.provider.id === 'openai' && props.provider.openaiAuthMode === 'chatgpt'
)
const usesApiKey = computed(
  () =>
    !isOpenAIChatGPTMode.value && !['github-copilot', 'openai-codex'].includes(props.provider.id)
)
const hasStoredKey = computed(() => Boolean(props.provider.apiKey?.trim()))
const replacementKey = computed(() => apiKey.value.trim() || props.provider.apiKey || '')
const isDirty = computed(
  () =>
    editorOpen.value &&
    (replacementKey.value !== (props.provider.apiKey || '') ||
      apiHost.value.trim() !== (props.provider.baseUrl || ''))
)
const maskedApiKey = computed(() => {
  const key = props.provider.apiKey?.trim() ?? ''
  return key.length > 8 ? `••••••••${key.slice(-4)}` : '••••••••'
})
const defaultBaseUrl = computed(() => props.providerWebsites?.defaultBaseUrl?.trim() || '')
const isGrokOAuthAvailable = computed(() => {
  if (props.provider.id !== 'grok') return false
  try {
    const url = new URL(props.provider.baseUrl)
    return url.protocol === 'https:' && (url.hostname === 'x.ai' || url.hostname.endsWith('.x.ai'))
  } catch {
    return false
  }
})
const providerApiKeyUrl = computed(() => {
  if (props.provider.id === 'new-api') {
    try {
      return `${new URL(props.provider.baseUrl || defaultBaseUrl.value).origin}/console/token`
    } catch {
      return props.providerWebsites?.apiKey || ''
    }
  }
  return props.providerWebsites?.apiKey || ''
})
const canVerifyProvider = computed(
  () => props.provider.enable && !editorOpen.value && !isSaving.value
)

const resetDraft = () => {
  apiKey.value = ''
  apiHost.value = props.provider.baseUrl || ''
  showApiKey.value = false
  saveError.value = ''
}
const handleEditorOpenChange = (open: boolean) => {
  if (isSaving.value) return
  resetDraft()
  editorOpen.value = open
}
const leaveGuardLease = settingsLeaveGuard.register({
  id: 'settings.providerConnection',
  onDiscard: () => handleEditorOpenChange(false)
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
    editorOpen.value = false
    resetDraft()
  } catch {
    // Persistence errors may contain the submitted credential.
    saveError.value = t('settings.deepchatAgents.saveFeedback.saveFailed')
  } finally {
    isSaving.value = false
  }
}
const openModelCheckDialog = () => {
  if (canVerifyProvider.value) modelCheckStore.openDialog(props.provider.id)
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
    )
      return
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
</script>
