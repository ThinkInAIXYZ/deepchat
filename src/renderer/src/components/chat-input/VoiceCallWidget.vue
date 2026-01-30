<template>
  <Tooltip v-if="shouldShowVoiceCall">
    <TooltipTrigger as-child>
      <Button
        variant="outline"
        size="icon"
        class="w-7 h-7 text-xs rounded-lg"
        :disabled="isStreaming || isCallActive"
        @click="startVoiceCall"
      >
        <Icon icon="lucide:phone-call" class="w-4 h-4" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{{ t('chat.call.start') }}</TooltipContent>
  </Tooltip>

  <Dialog v-model:open="callDialogOpen">
    <DialogContent class="w-105 p-4">
      <DialogHeader>
        <DialogTitle>{{ t('chat.call.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('chat.call.description') }}
        </DialogDescription>
      </DialogHeader>
      <div class="w-full max-w-105">
        <voice-agent-widget
          v-if="callDialogOpen"
          ref="voiceWidget"
          :key="callWidgetKey"
          :api-key="voiceAIApiKey"
          :data-agent-id="voiceAIAgentId"
          :data-start-text="t('chat.call.start')"
          :data-stop-text="t('chat.call.stop')"
          data-show-time="true"
          data-show-mic-status="true"
          data-width="386"
          data-height="220"
          class="w-full"
        />
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import { useProviderStore } from '@/stores/providerStore'

const props = withDefaults(
  defineProps<{
    variant: 'chat' | 'newThread'
    activeProviderId?: string | null
    isStreaming?: boolean
  }>(),
  {
    activeProviderId: null,
    isStreaming: false
  }
)

const emit = defineEmits<{
  (event: 'active-change', value: boolean): void
}>()

const { t } = useI18n()
const providerStore = useProviderStore()

const voiceAIAgentId = ref('')
const callDialogOpen = ref(false)
const callWidgetKey = ref(0)
const voiceWidget = ref<HTMLElement | null>(null)
const voiceWidgetReady = ref(false)
const voiceWidgetLoading = ref(false)
const callWidgetPulse = ref(false)
let callWidgetPulseTimer: ReturnType<typeof setTimeout> | null = null
let voiceWidgetScriptPromise: Promise<void> | null = null
const isCallActive = computed(() => callDialogOpen.value)

const voiceAIApiKey = computed(() => {
  return providerStore.providers.find((provider) => provider.id === 'voiceai')?.apiKey || ''
})

const shouldShowVoiceCall = computed(() => {
  if (props.variant !== 'chat') return false
  const providerId = props.activeProviderId
  return (
    providerId === 'voiceai' && voiceAIAgentId.value.length > 0 && voiceAIApiKey.value.length > 0
  )
})

const loadVoiceAIConfig = async () => {
  const config = await providerStore.getVoiceAIConfig()
  voiceAIAgentId.value = config.agentId?.trim() || ''
}

const hasVoiceWidgetDefinition = () => {
  return typeof window !== 'undefined' && !!window.customElements?.get('voice-agent-widget')
}

const ensureVoiceAIWidgetScript = () => {
  if (hasVoiceWidgetDefinition()) {
    voiceWidgetReady.value = true
    voiceWidgetLoading.value = false
    return Promise.resolve()
  }
  if (voiceWidgetScriptPromise) return voiceWidgetScriptPromise

  voiceWidgetLoading.value = true
  voiceWidgetScriptPromise = new Promise<void>((resolve) => {
    let settled = false
    const finalize = (ready: boolean) => {
      if (settled) return
      settled = true
      voiceWidgetReady.value = ready
      voiceWidgetLoading.value = false
      if (!ready) {
        voiceWidgetScriptPromise = null
      }
      resolve()
    }

    const handleLoad = () => {
      finalize(hasVoiceWidgetDefinition())
    }
    const handleError = () => {
      finalize(false)
    }
    const fallbackTimer = setTimeout(() => {
      finalize(hasVoiceWidgetDefinition())
    }, 4000)

    const existing = document.getElementById('voice-ai-widget-script') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener(
        'load',
        () => {
          clearTimeout(fallbackTimer)
          handleLoad()
        },
        { once: true }
      )
      existing.addEventListener(
        'error',
        () => {
          clearTimeout(fallbackTimer)
          handleError()
        },
        { once: true }
      )
      return
    }

    const script = document.createElement('script')
    script.id = 'voice-ai-widget-script'
    script.src = 'https://voice.ai/app/voice-agent-widget.js'
    script.async = true
    script.addEventListener(
      'load',
      () => {
        clearTimeout(fallbackTimer)
        handleLoad()
      },
      { once: true }
    )
    script.addEventListener(
      'error',
      () => {
        clearTimeout(fallbackTimer)
        handleError()
      },
      { once: true }
    )
    document.head.appendChild(script)
  })

  return voiceWidgetScriptPromise
}

const startVoiceCall = async () => {
  await loadVoiceAIConfig()
  if (!voiceAIAgentId.value || !voiceAIApiKey.value) return
  void ensureVoiceAIWidgetScript()
  callWidgetKey.value += 1
  callDialogOpen.value = true
}

onMounted(async () => {
  if (props.activeProviderId === 'voiceai') {
    void ensureVoiceAIWidgetScript()
    await loadVoiceAIConfig()
  }
})

onUnmounted(() => {
  if (callWidgetPulseTimer) {
    clearTimeout(callWidgetPulseTimer)
  }
})

watch(
  () => props.activeProviderId,
  (providerId) => {
    if (providerId === 'voiceai') {
      void loadVoiceAIConfig()
      void ensureVoiceAIWidgetScript()
    }
  },
  { immediate: true }
)

watch(
  () => providerStore.voiceAIConfig?.agentId,
  (agentId) => {
    voiceAIAgentId.value = agentId?.trim() || ''
  },
  { immediate: true }
)

watch(callDialogOpen, (open) => {
  emit('active-change', open)
  if (open) {
    void ensureVoiceAIWidgetScript()
    callWidgetPulse.value = false
  } else {
    callWidgetKey.value += 1
  }
})
</script>
