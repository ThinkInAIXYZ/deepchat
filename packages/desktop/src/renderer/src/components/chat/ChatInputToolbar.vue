<template>
  <div class="flex items-center justify-between px-3 py-2">
    <div class="flex items-center gap-1">
      <!-- Attach button -->
      <DcButton
        variant="ghost"
        size="icon-sm"
        icon="lucide:plus"
        :label="t('chat.input.attach')"
        :tooltip="t('chat.input.attach')"
        :tooltip-delay-duration="200"
        class="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
        :disabled="isPreparingAttachments"
        @click="$emit('attach')"
      />
    </div>

    <div class="flex items-center gap-1">
      <DcButton
        v-if="showSearch"
        data-testid="chat-search-toggle"
        variant="ghost"
        size="icon-sm"
        icon="lucide:globe-2"
        :label="t('chat.features.webSearch')"
        :tooltip="t('chat.features.webSearch')"
        :tooltip-delay-duration="200"
        class="h-7 w-7 rounded-lg"
        :class="
          searchEnabled
            ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
            : 'text-muted-foreground hover:text-foreground'
        "
        :aria-pressed="searchEnabled"
        :disabled="isPreparingAttachments"
        @click="emit('toggle-search')"
      />

      <!-- Mic button -->
      <DcButton
        v-if="showVoiceInput"
        data-testid="chat-voice-input-button"
        variant="ghost"
        size="icon-sm"
        :label="voiceInputTooltip"
        :tooltip="voiceInputTooltip"
        :tooltip-delay-duration="200"
        :class="voiceInputButtonClass"
        :aria-pressed="isVoiceInputListening || isVoiceInputTranscribing"
        :aria-busy="isVoiceInputTranscribing || undefined"
        :disabled="isPreparingAttachments && !isVoiceInputListening && !isVoiceInputTranscribing"
        @click="emit('voice-input')"
      >
        <span
          v-if="isVoiceInputListening"
          aria-hidden="true"
          class="absolute inset-0 rounded-lg bg-cyan-500/14 animate-pulse"
        />
        <svg
          v-if="isVoiceInputListening"
          data-testid="chat-voice-recording-wave"
          class="voice-wave absolute inset-0 m-auto z-10 transition-opacity duration-150 group-hover:opacity-0"
          viewBox="0 0 36 18"
          role="img"
          aria-hidden="true"
        >
          <line class="voice-wave-guide" x1="1" y1="9" x2="10" y2="9" />
          <line class="voice-wave-guide" x1="26" y1="9" x2="35" y2="9" />
          <rect
            class="voice-wave-bar voice-wave-bar-1"
            x="11"
            y="6"
            width="2.3"
            height="6"
            rx="1"
          />
          <rect
            class="voice-wave-bar voice-wave-bar-2"
            x="14.3"
            y="4"
            width="2.3"
            height="10"
            rx="1"
          />
          <rect
            class="voice-wave-bar voice-wave-bar-3"
            x="17.6"
            y="2"
            width="2.3"
            height="14"
            rx="1"
          />
          <rect
            class="voice-wave-bar voice-wave-bar-4"
            x="20.9"
            y="4"
            width="2.3"
            height="10"
            rx="1"
          />
          <rect
            class="voice-wave-bar voice-wave-bar-5"
            x="24.2"
            y="6"
            width="2.3"
            height="6"
            rx="1"
          />
        </svg>
        <Icon
          v-if="isVoiceInputListening"
          icon="lucide:square"
          class="absolute inset-0 m-auto z-10 hidden w-4 h-4 text-red-500 group-hover:block"
        />
        <Spinner v-else-if="isVoiceInputTranscribing" class="relative z-10 size-4" />
        <Icon v-else icon="lucide:mic" class="relative z-10 size-4" />
      </DcButton>

      <DcButton
        v-if="isGenerating && hasActiveInput"
        data-testid="chat-steer-button"
        variant="outline"
        size="sm"
        icon="lucide:compass"
        :label="t('chat.input.steer')"
        :tooltip="steerDisabled ? t('chat.pendingInput.steerUnavailable') : t('chat.input.steer')"
        :tooltip-delay-duration="200"
        class="h-7 gap-1.5 rounded-lg px-2.5 text-foreground"
        :disabled="isPreparingAttachments || steerDisabled"
        @click="emit('steer')"
      >
        <span class="text-xs font-medium">{{ t('chat.input.steer') }}</span>
      </DcButton>

      <!-- Primary action button -->
      <DcButton
        :key="buttonMode"
        :data-testid="
          buttonMode === 'cancel-preparation'
            ? 'chat-cancel-preparation-button'
            : buttonMode === 'stop'
              ? 'chat-stop-button'
              : buttonMode === 'queue'
                ? 'chat-queue-button'
                : 'chat-send-button'
        "
        :data-mode="buttonMode"
        :variant="
          buttonMode === 'stop' || buttonMode === 'cancel-preparation' ? 'outline' : 'default'
        "
        size="icon-sm"
        :label="primaryTooltip"
        :tooltip="primaryTooltip"
        :tooltip-delay-duration="200"
        class="rounded-full"
        :disabled="
          buttonMode === 'cancel-preparation'
            ? false
            : buttonMode === 'stop'
              ? isStopping
              : buttonMode === 'send'
                ? sendDisabled
                : queueDisabled
        "
        :aria-busy="buttonMode === 'stop' && isStopping ? true : undefined"
        @click="handlePrimaryAction"
      >
        <Spinner v-if="buttonMode === 'stop' && isStopping" class="size-4 text-red-500" />
        <Icon
          v-else
          :icon="
            buttonMode === 'stop' || buttonMode === 'cancel-preparation'
              ? 'lucide:square'
              : buttonMode === 'queue'
                ? 'lucide:list-plus'
                : 'lucide:arrow-up'
          "
          :class="
            buttonMode === 'stop' || buttonMode === 'cancel-preparation'
              ? 'w-4 h-4 text-red-500'
              : 'w-4 h-4'
          "
        />
      </DcButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    isGenerating?: boolean
    hasInput?: boolean
    hasText?: boolean
    sendDisabled?: boolean
    queueDisabled?: boolean
    steerDisabled?: boolean
    isStopping?: boolean
    showVoiceInput?: boolean
    isVoiceInputListening?: boolean
    isVoiceInputTranscribing?: boolean
    isPreparingAttachments?: boolean
    showSearch?: boolean
    searchEnabled?: boolean
  }>(),
  {
    isGenerating: false,
    hasInput: false,
    hasText: false,
    sendDisabled: false,
    queueDisabled: false,
    steerDisabled: false,
    isStopping: false,
    showVoiceInput: false,
    isVoiceInputListening: false,
    isVoiceInputTranscribing: false,
    isPreparingAttachments: false,
    showSearch: false,
    searchEnabled: false
  }
)

const emit = defineEmits<{
  send: []
  queue: []
  steer: []
  attach: []
  'voice-input': []
  'toggle-search': []
  stop: []
  'cancel-preparation': []
}>()

const { t } = useI18n()
const hasActiveInput = computed(() => props.hasInput || props.hasText)
const voiceInputButtonClass = computed(() => {
  if (props.isVoiceInputListening) {
    return [
      'relative group h-7 w-7 rounded-lg overflow-hidden text-cyan-600 bg-cyan-500/10 ring-1 ring-cyan-500/30 hover:text-red-500 hover:bg-red-500/10 hover:ring-red-500/35 transition-colors duration-200'
    ]
  }

  if (props.isVoiceInputTranscribing) {
    return [
      'relative group h-7 w-7 rounded-lg text-primary bg-primary/10 ring-1 ring-primary/20 hover:bg-primary/15'
    ]
  }

  return ['relative group h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground']
})
const voiceInputTooltip = computed(() => {
  if (props.isVoiceInputTranscribing) {
    return t('chat.input.stop')
  }

  if (props.isVoiceInputListening) {
    return t('chat.input.voiceInputStop')
  }

  return t('chat.input.voiceInput')
})
const buttonMode = computed<'send' | 'queue' | 'stop' | 'cancel-preparation'>(() => {
  if (props.isPreparingAttachments) return 'cancel-preparation'
  if (props.isGenerating && !hasActiveInput.value) return 'stop'
  if (props.isGenerating) return 'queue'
  return 'send'
})
const primaryTooltip = computed(() => {
  if (buttonMode.value === 'cancel-preparation') return t('common.cancel')
  if (buttonMode.value === 'stop') return t('chat.input.stop')
  if (buttonMode.value === 'queue') return t('chat.input.queue')
  return t('chat.input.send')
})

function handlePrimaryAction() {
  if (buttonMode.value === 'cancel-preparation') {
    emit('cancel-preparation')
    return
  }
  if (buttonMode.value === 'stop') {
    if (props.isStopping) return
    emit('stop')
    return
  }
  if (buttonMode.value === 'queue') {
    emit('queue')
    return
  }
  emit('send')
}
</script>

<style scoped>
.voice-wave {
  width: 18px;
  height: 18px;
}

.voice-wave-guide {
  stroke: color-mix(in srgb, currentColor 60%, transparent);
  stroke-width: 1.4;
  stroke-linecap: round;
}

.voice-wave-bar {
  fill: currentColor;
  transform-box: fill-box;
  transform-origin: center;
  animation: voice-wave-scale 1.1s ease-in-out infinite;
}

.voice-wave-bar-1 {
  animation-delay: 0s;
}

.voice-wave-bar-2 {
  animation-delay: 0.12s;
}

.voice-wave-bar-3 {
  animation-delay: 0.24s;
}

.voice-wave-bar-4 {
  animation-delay: 0.36s;
}

.voice-wave-bar-5 {
  animation-delay: 0.48s;
}

@keyframes voice-wave-scale {
  0%,
  100% {
    transform: scaleY(0.55);
    opacity: 0.72;
  }

  45% {
    transform: scaleY(1);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .voice-wave-bar {
    animation: none;
    transform: scaleY(0.8);
    opacity: 1;
  }
}
</style>
