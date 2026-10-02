<template>
  <div class="space-y-4">
    <div class="rounded-2xl border bg-muted/30 p-4">
      <div class="flex items-start gap-3">
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon icon="lucide:audio-waveform" class="h-5 w-5" />
        </div>
        <div class="space-y-1">
          <p class="text-sm font-medium">{{ t('settings.provider.tts.title') }}</p>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.provider.tts.description') }}
          </p>
        </div>
      </div>
    </div>

    <div class="rounded-2xl border bg-card p-4">
      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-2">
          <Label :for="`${provider.id}-audio-format`" class="text-xs font-medium">
            {{ t('settings.provider.tts.audioFormat.label') }}
          </Label>
          <Select v-model="audioFormat" :disabled="isHydrating">
            <SelectTrigger :id="`${provider.id}-audio-format`">
              <SelectValue :placeholder="t('settings.provider.tts.audioFormat.placeholder')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mp3">MP3</SelectItem>
              <SelectItem value="wav">WAV</SelectItem>
              <SelectItem value="pcm">PCM</SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.provider.tts.audioFormat.helper') }}
          </p>
        </div>

        <div class="space-y-2">
          <Label :for="`${provider.id}-language`" class="text-xs font-medium">
            {{ t('settings.provider.tts.language.label') }}
          </Label>
          <Select v-model="language" :disabled="isHydrating">
            <SelectTrigger :id="`${provider.id}-language`">
              <SelectValue :placeholder="t('settings.provider.tts.language.placeholder')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="option in languageOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.provider.tts.language.helper') }}
          </p>
        </div>

        <div class="space-y-2 md:col-span-2">
          <Label :for="`${provider.id}-tts-model`" class="text-xs font-medium">
            {{ t('settings.provider.tts.model.label') }}
          </Label>
          <Input
            :id="`${provider.id}-tts-model`"
            v-model="ttsModel"
            :placeholder="t('settings.provider.tts.model.placeholder')"
            :disabled="isHydrating"
          />
          <p class="text-xs text-muted-foreground">
            {{ t('settings.provider.tts.model.helper') }}
          </p>
        </div>

        <div class="space-y-2 md:col-span-2">
          <Label :for="`${provider.id}-agent-id`" class="text-xs font-medium">
            {{ t('settings.provider.tts.agentId.label') }}
          </Label>
          <Input
            :id="`${provider.id}-agent-id`"
            v-model="agentId"
            :placeholder="t('settings.provider.tts.agentId.placeholder')"
            :disabled="isHydrating"
          />
          <p class="text-xs text-muted-foreground">
            {{ t('settings.provider.tts.agentId.helper') }}
          </p>
        </div>
      </div>

      <Separator class="my-4" />

      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label :for="`${provider.id}-temperature`" class="text-xs font-medium">
              {{ t('settings.provider.tts.temperature.label') }}
            </Label>
            <span class="text-xs text-muted-foreground">{{ temperature.toFixed(2) }}</span>
          </div>
          <Slider
            :id="`${provider.id}-temperature`"
            :min="0"
            :max="2"
            :step="0.05"
            :model-value="[temperature]"
            @update:model-value="onTemperatureChange"
          />
          <p class="text-xs text-muted-foreground">
            {{ t('settings.provider.tts.temperature.helper') }}
          </p>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label :for="`${provider.id}-top-p`" class="text-xs font-medium">
              {{ t('settings.provider.tts.topP.label') }}
            </Label>
            <span class="text-xs text-muted-foreground">{{ topP.toFixed(2) }}</span>
          </div>
          <Slider
            :id="`${provider.id}-top-p`"
            :min="0"
            :max="1"
            :step="0.05"
            :model-value="[topP]"
            @update:model-value="onTopPChange"
          />
          <p class="text-xs text-muted-foreground">
            {{ t('settings.provider.tts.topP.helper') }}
          </p>
        </div>
      </div>
    </div>

    <DcInlineError v-if="saveError" :error="saveError" data-testid="voiceai-config-save-error" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { useI18n } from 'vue-i18n'
import { useProviderStore } from '@/stores/providerStore'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Separator } from '@shadcn/components/ui/separator'
import { Slider } from '@shadcn/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Icon } from '@iconify/vue'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

defineProps<{
  provider: LLM_PROVIDER
}>()

const { t } = useI18n()
const providerStore = useProviderStore()

const audioFormat = ref('mp3')
const ttsModel = ref('voiceai-tts-v1-latest')
const language = ref('en')
const temperature = ref(1)
const topP = ref(0.8)
const agentId = ref('')
const isHydrating = ref(true)
const saveError = ref('')

const languageOptions = [
  { value: 'en', label: 'English (en)' },
  { value: 'ca', label: 'Catalan (ca)' },
  { value: 'sv', label: 'Swedish (sv)' },
  { value: 'es', label: 'Spanish (es)' },
  { value: 'fr', label: 'French (fr)' },
  { value: 'de', label: 'German (de)' },
  { value: 'it', label: 'Italian (it)' },
  { value: 'pt', label: 'Portuguese (pt)' },
  { value: 'pl', label: 'Polish (pl)' },
  { value: 'ru', label: 'Russian (ru)' },
  { value: 'nl', label: 'Dutch (nl)' }
]

type VoiceAIConfigUpdates = {
  audioFormat?: string
  model?: string
  language?: string
  temperature?: number
  topP?: number
  agentId?: string
}

let committedConfig: Required<VoiceAIConfigUpdates> | undefined
let pendingUpdates: VoiceAIConfigUpdates = {}
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let isSaving = false
let isUnmounted = false

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'settings.voiceAIConfig',
  onDiscard: () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = undefined
    pendingUpdates = {}
    saveError.value = ''
    if (committedConfig && !isUnmounted) {
      isHydrating.value = true
      audioFormat.value = committedConfig.audioFormat
      ttsModel.value = committedConfig.model
      language.value = committedConfig.language
      temperature.value = committedConfig.temperature
      topP.value = committedConfig.topP
      agentId.value = committedConfig.agentId
      isHydrating.value = false
    }
    leaveGuardLease.setRisk('clean')
    if (isUnmounted) leaveGuardLease.release()
  }
})

const hasPendingUpdates = () => Object.keys(pendingUpdates).length > 0

const flushUpdates = async () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = undefined
  if (isSaving || !hasPendingUpdates()) return

  const updates = pendingUpdates
  pendingUpdates = {}
  isSaving = true
  leaveGuardLease.setRisk('busy')
  try {
    await providerStore.updateVoiceAIConfig(updates)
    saveError.value = ''
    if (committedConfig) Object.assign(committedConfig, updates)
  } catch {
    pendingUpdates = { ...updates, ...pendingUpdates }
    saveError.value = t('settings.deepchatAgents.saveFeedback.saveFailed')
  } finally {
    isSaving = false
    if (hasPendingUpdates()) {
      leaveGuardLease.setRisk('dirty')
      if (!saveError.value) void flushUpdates()
    } else {
      leaveGuardLease.setRisk('clean')
    }
    if (isUnmounted && !isSaving) leaveGuardLease.release()
  }
}

const persistUpdates = (updates: VoiceAIConfigUpdates) => {
  pendingUpdates = { ...pendingUpdates, ...updates }
  saveError.value = ''
  leaveGuardLease.setRisk(isSaving ? 'busy' : 'dirty')
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void flushUpdates(), 200)
}

const loadConfig = async () => {
  isHydrating.value = true
  const config = await providerStore.getVoiceAIConfig()
  audioFormat.value = config.audioFormat
  ttsModel.value = config.model
  language.value = config.language
  temperature.value = config.temperature
  topP.value = config.topP
  agentId.value = config.agentId
  committedConfig = { ...config }
  isHydrating.value = false
}

onMounted(() => {
  void loadConfig()
})

onUnmounted(() => {
  isUnmounted = true
  if (hasPendingUpdates()) {
    void flushUpdates()
  } else if (!isSaving) {
    leaveGuardLease.release()
  }
})

watch(
  audioFormat,
  (value) => {
    if (isHydrating.value) return
    persistUpdates({ audioFormat: value })
  },
  { flush: 'sync' }
)

watch(
  ttsModel,
  (value) => {
    if (isHydrating.value) return
    persistUpdates({ model: value })
  },
  { flush: 'sync' }
)

watch(
  language,
  (value) => {
    if (isHydrating.value) return
    persistUpdates({ language: value })
  },
  { flush: 'sync' }
)

watch(
  agentId,
  (value) => {
    if (isHydrating.value) return
    persistUpdates({ agentId: value })
  },
  { flush: 'sync' }
)

const onTemperatureChange = (value: number[] | undefined) => {
  if (!value || value[0] === undefined) return
  temperature.value = value[0]
  if (isHydrating.value) return
  persistUpdates({ temperature: value[0] })
}

const onTopPChange = (value: number[] | undefined) => {
  if (!value || value[0] === undefined) return
  topP.value = value[0]
  if (isHydrating.value) return
  persistUpdates({ topP: value[0] })
}
</script>
