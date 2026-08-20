<template>
  <section class="w-full h-full" data-testid="add-provider-flow">
    <ScrollArea class="w-full h-full">
      <div class="mx-auto flex max-w-2xl flex-col gap-4 p-4">
        <div class="flex items-center gap-2">
          <DcButton
            variant="ghost"
            size="sm"
            class="h-8 w-8 p-0"
            :aria-label="t('common.back')"
            @click="$emit('cancel')"
          >
            <Icon icon="lucide:arrow-left" class="h-4 w-4" />
          </DcButton>
          <div class="flex flex-col">
            <h2 class="text-lg font-semibold">
              {{ t('settings.provider.dialog.addCustomProvider.title') }}
            </h2>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.provider.dialog.addCustomProvider.description') }}
            </p>
          </div>
        </div>

        <div
          v-if="phase === 'success'"
          data-testid="add-provider-success"
          class="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-6"
        >
          <div class="flex items-center gap-2">
            <Icon icon="lucide:circle-check" class="h-5 w-5 text-emerald-500" />
            <h3 class="text-base font-semibold">
              {{ t('settings.provider.addFlow.successTitle', { name: form.name }) }}
            </h3>
          </div>
          <p data-testid="add-provider-success-description" class="text-sm text-muted-foreground">
            {{
              loadedModelCount === 0
                ? t('settings.provider.addFlow.successNoModels')
                : t('settings.provider.addFlow.successDescription', {
                    count: loadedModelCount,
                    selected: selectedModelCount
                  })
            }}
          </p>
          <div class="flex items-center gap-2 pt-1">
            <DcButton data-testid="add-provider-start-chatting" @click="startChatting">
              <Icon icon="lucide:message-circle" class="h-4 w-4" data-icon="inline-start" />
              {{ t('settings.provider.addFlow.startChatting') }}
            </DcButton>
            <DcButton
              data-testid="add-provider-view-models"
              variant="outline"
              @click="finishToDetail"
            >
              {{ t('settings.provider.addFlow.viewModels') }}
            </DcButton>
          </div>
        </div>

        <div v-else class="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
          <div class="flex flex-col gap-2">
            <Label for="add-provider-name">
              {{ t('settings.provider.dialog.addCustomProvider.name') }}
            </Label>
            <Input
              id="add-provider-name"
              v-model="form.name"
              data-testid="add-provider-name"
              :placeholder="t('settings.provider.dialog.addCustomProvider.namePlaceholder')"
              :disabled="isBusy"
            />
          </div>

          <div class="flex flex-col gap-2">
            <Label for="add-provider-api-type">
              {{ t('settings.provider.dialog.addCustomProvider.apiType') }}
            </Label>
            <Select v-model="form.apiType" :disabled="isBusy">
              <SelectTrigger id="add-provider-api-type" data-testid="add-provider-api-type">
                <SelectValue
                  :placeholder="t('settings.provider.dialog.addCustomProvider.apiTypePlaceholder')"
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="openai-completions">OpenAI Completions</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="ollama">Ollama</SelectItem>
                <SelectItem value="mistral">Mistral AI</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="add-provider-base-url">
              {{ t('settings.provider.dialog.addCustomProvider.baseUrl') }}
            </Label>
            <Input
              id="add-provider-base-url"
              v-model="form.baseUrl"
              data-testid="add-provider-base-url"
              :placeholder="t('settings.provider.dialog.addCustomProvider.baseUrlPlaceholder')"
              :disabled="isBusy"
            />
            <p v-if="apiEndpointSuffix" class="text-xs text-muted-foreground">
              {{
                t('settings.provider.urlFormat', {
                  defaultUrl: `${normalizedBaseUrl}${apiEndpointSuffix}`
                })
              }}
            </p>
          </div>

          <div v-if="form.apiType !== 'ollama'" class="flex flex-col gap-2">
            <Label for="add-provider-api-key">
              {{ t('settings.provider.dialog.addCustomProvider.apiKey') }}
            </Label>
            <Input
              id="add-provider-api-key"
              v-model="form.apiKey"
              data-testid="add-provider-api-key"
              type="password"
              :placeholder="t('settings.provider.dialog.addCustomProvider.apiKeyPlaceholder')"
              :disabled="isBusy"
              @keyup.enter="connectAndLoad"
            />
          </div>

          <DcInlineError v-if="connectError" :error="connectError" />

          <div class="flex items-center gap-2">
            <DcButton
              data-testid="add-provider-connect"
              :disabled="!canConnect || isBusy"
              @click="connectAndLoad"
            >
              <Spinner v-if="isBusy" class="size-4" data-icon="inline-start" />
              {{ connectButtonLabel }}
            </DcButton>
            <DcButton
              v-if="phase === 'validating'"
              data-testid="add-provider-cancel-attempt"
              variant="outline"
              @click="cancelAttempt"
            >
              {{ t('common.cancel') }}
            </DcButton>
          </div>
        </div>
      </div>
    </ScrollArea>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import { Icon } from '@iconify/vue'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Spinner } from '@shadcn/components/ui/spinner'
import { DcButton } from '@dc-ui/components/button'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
import { createWindowClient } from '@api/WindowClient'
import type { LLM_PROVIDER } from '@shared/types/provider'

const emit = defineEmits<{
  cancel: []
  created: [provider: LLM_PROVIDER]
}>()

const { t } = useI18n()
const providerStore = useProviderStore()
const modelStore = useModelStore()
const windowClient = createWindowClient()

// One draft id per form session so retries and the final commit share the same
// provider id, and a cancelled attempt never leaves a second half-created id.
const draftId = nanoid()

const form = ref({
  name: '',
  apiType: 'openai',
  apiKey: '',
  baseUrl: ''
})

const phase = ref<'idle' | 'validating' | 'committing' | 'success'>('idle')
const connectError = ref('')
// Monotonic attempt counter: a cancelled or superseded attempt's result is
// ignored instead of committing a stale draft.
let attemptCounter = 0
let activeAttempt = 0

const isBusy = computed(() => phase.value === 'validating' || phase.value === 'committing')
const loadedModelCount = ref(0)
const selectedModelCount = ref(0)
let committedProvider: LLM_PROVIDER | null = null
const normalizedBaseUrl = computed(() => form.value.baseUrl.trim().replace(/\/+$/, ''))
const apiEndpointSuffix = computed(() => {
  if (!normalizedBaseUrl.value) return ''
  if (form.value.apiType === 'openai') return '/responses'
  if (form.value.apiType === 'openai-completions') return '/chat/completions'
  return ''
})

const canConnect = computed(() => {
  if (!form.value.name.trim() || !form.value.baseUrl.trim()) return false
  if (form.value.apiType !== 'ollama' && !form.value.apiKey.trim()) return false
  return true
})

const connectButtonLabel = computed(() => {
  switch (phase.value) {
    case 'validating':
      return t('settings.provider.addFlow.validating')
    case 'committing':
      return t('settings.provider.addFlow.loadingModels')
    default:
      return t('settings.provider.addFlow.connect')
  }
})

watch(
  () => form.value.apiType,
  (newType, oldType) => {
    if (newType === 'ollama') {
      if (!form.value.baseUrl) {
        form.value.baseUrl = 'http://localhost:11434'
      }
      form.value.apiKey = ''
    } else if (oldType === 'ollama' && form.value.baseUrl === 'http://localhost:11434') {
      form.value.baseUrl = ''
    }
  }
)

const buildDraft = (): LLM_PROVIDER => ({
  id: draftId,
  name: form.value.name.trim(),
  apiType: form.value.apiType,
  apiKey: form.value.apiKey.trim(),
  baseUrl: form.value.baseUrl.trim(),
  enable: false,
  custom: true
})

const finishToDetail = () => {
  if (committedProvider) {
    emit('created', committedProvider)
  }
}

const startChatting = async () => {
  try {
    await windowClient.focusMainWindow()
  } catch (error) {
    console.error('Failed to focus the main window:', error)
  }
  finishToDetail()
}

const cancelAttempt = () => {
  // Only the validation phase is cancellable; once committing starts the
  // persisted state must land atomically.
  if (phase.value !== 'validating') {
    return
  }
  activeAttempt = -1
  phase.value = 'idle'
}

const connectAndLoad = async () => {
  if (!canConnect.value || isBusy.value) {
    return
  }

  const attempt = ++attemptCounter
  activeAttempt = attempt
  connectError.value = ''
  phase.value = 'validating'

  const draft = buildDraft()
  try {
    const result = await providerStore.validateDraftProvider(draft)
    if (activeAttempt !== attempt) {
      return
    }
    if (!result.isOk) {
      connectError.value = result.errorMsg || t('settings.provider.addFlow.failed')
      phase.value = 'idle'
      return
    }

    phase.value = 'committing'
    await providerStore.commitValidatedDraft(draft)
    let selectedCount = 0
    try {
      selectedCount = await modelStore.applyInitialModelRecommendations(draft.id)
    } catch (error) {
      // The provider is already persisted and available; a recommendation
      // failure must not roll the flow back to an error state.
      console.error('Failed to apply initial model recommendations:', error)
    }
    if (activeAttempt !== attempt) {
      return
    }
    loadedModelCount.value = result.models.length
    selectedModelCount.value = selectedCount
    committedProvider = { ...draft, enable: true }
    phase.value = 'success'
  } catch (error) {
    if (activeAttempt !== attempt) {
      return
    }
    connectError.value =
      error instanceof Error ? error.message : t('settings.provider.addFlow.failed')
    phase.value = 'idle'
  }
}
</script>
