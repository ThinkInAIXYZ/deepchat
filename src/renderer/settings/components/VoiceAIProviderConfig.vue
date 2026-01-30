<template>
  <div class="space-y-4">
    <div class="rounded-2xl border bg-muted/30 p-4">
      <div class="flex items-start gap-3">
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon icon="lucide:audio-waveform" class="h-5 w-5" />
        </div>
        <div class="space-y-1">
          <p class="text-sm font-medium">{{ t('settings.provider.voiceai.title') }}</p>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.provider.voiceai.description') }}
          </p>
        </div>
      </div>
    </div>

    <div class="rounded-2xl border bg-card p-4">
      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-2">
          <Label :for="`${provider.id}-audio-format`" class="text-xs font-medium">
            {{ t('settings.provider.voiceai.audioFormat.label') }}
          </Label>
          <Select v-model="audioFormat" :disabled="isHydrating">
            <SelectTrigger :id="`${provider.id}-audio-format`">
              <SelectValue :placeholder="t('settings.provider.voiceai.audioFormat.placeholder')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mp3">MP3</SelectItem>
              <SelectItem value="wav">WAV</SelectItem>
              <SelectItem value="pcm">PCM</SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.provider.voiceai.audioFormat.helper') }}
          </p>
        </div>

        <div class="space-y-2">
          <Label :for="`${provider.id}-language`" class="text-xs font-medium">
            {{ t('settings.provider.voiceai.language.label') }}
          </Label>
          <Select v-model="language" :disabled="isHydrating">
            <SelectTrigger :id="`${provider.id}-language`">
              <SelectValue :placeholder="t('settings.provider.voiceai.language.placeholder')" />
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
            {{ t('settings.provider.voiceai.language.helper') }}
          </p>
        </div>

        <div class="space-y-2 md:col-span-2">
          <Label :for="`${provider.id}-tts-model`" class="text-xs font-medium">
            {{ t('settings.provider.voiceai.model.label') }}
          </Label>
          <Input
            :id="`${provider.id}-tts-model`"
            v-model="ttsModel"
            :placeholder="t('settings.provider.voiceai.model.placeholder')"
            :disabled="isHydrating"
          />
          <p class="text-xs text-muted-foreground">
            {{ t('settings.provider.voiceai.model.helper') }}
          </p>
        </div>

        <div class="space-y-2 md:col-span-2">
          <Label :for="`${provider.id}-agent-id`" class="text-xs font-medium">
            {{ t('settings.provider.voiceai.agentId.label') }}
          </Label>
          <Input
            :id="`${provider.id}-agent-id`"
            v-model="agentId"
            :placeholder="t('settings.provider.voiceai.agentId.placeholder')"
            :disabled="isHydrating"
          />
          <p class="text-xs text-muted-foreground">
            {{ t('settings.provider.voiceai.agentId.helper') }}
          </p>
        </div>
      </div>

      <Separator class="my-4" />

      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label :for="`${provider.id}-temperature`" class="text-xs font-medium">
              {{ t('settings.provider.voiceai.temperature.label') }}
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
            {{ t('settings.provider.voiceai.temperature.helper') }}
          </p>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label :for="`${provider.id}-top-p`" class="text-xs font-medium">
              {{ t('settings.provider.voiceai.topP.label') }}
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
            {{ t('settings.provider.voiceai.topP.helper') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { LLM_PROVIDER } from '@shared/presenter'
import { useI18n } from 'vue-i18n'
import { useProviderStore } from '@/stores/providerStore'
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
import { useDebounceFn } from '@vueuse/core'

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

const persistUpdates = useDebounceFn(async (updates: VoiceAIConfigUpdates) => {
  await providerStore.updateVoiceAIConfig(updates)
}, 200)

const loadConfig = async () => {
  isHydrating.value = true
  const config = await providerStore.getVoiceAIConfig()
  audioFormat.value = config.audioFormat
  ttsModel.value = config.model
  language.value = config.language
  temperature.value = config.temperature
  topP.value = config.topP
  agentId.value = config.agentId
  isHydrating.value = false
}

onMounted(() => {
  void loadConfig()
})

watch(audioFormat, (value) => {
  if (isHydrating.value) return
  void persistUpdates({ audioFormat: value })
})

watch(ttsModel, (value) => {
  if (isHydrating.value) return
  void persistUpdates({ model: value })
})

watch(language, (value) => {
  if (isHydrating.value) return
  void persistUpdates({ language: value })
})

watch(agentId, (value) => {
  if (isHydrating.value) return
  void persistUpdates({ agentId: value })
})

const onTemperatureChange = (value: number[] | undefined) => {
  if (!value || value[0] === undefined) return
  temperature.value = value[0]
  if (isHydrating.value) return
  void persistUpdates({ temperature: value[0] })
}

const onTopPChange = (value: number[] | undefined) => {
  if (!value || value[0] === undefined) return
  topP.value = value[0]
  if (isHydrating.value) return
  void persistUpdates({ topP: value[0] })
}
</script>
