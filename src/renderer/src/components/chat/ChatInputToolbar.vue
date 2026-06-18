<template>
  <div class="flex items-center justify-between px-3 py-2">
    <div class="flex items-center gap-1">
      <!-- Attach button -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            @click="$emit('attach')"
          >
            <Icon icon="lucide:plus" class="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{{ t('chat.input.attach') }}</p>
        </TooltipContent>
      </Tooltip>
    </div>

    <div class="flex items-center gap-1">
      <!-- Mic button -->
      <Tooltip v-if="showVoiceInput">
        <TooltipTrigger as-child>
          <Button
            data-testid="chat-voice-input-button"
            variant="ghost"
            size="icon"
            :class="voiceInputButtonClass"
            :aria-pressed="isVoiceInputListening || isVoiceInputTranscribing"
            :aria-busy="isVoiceInputTranscribing || undefined"
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
            <Icon v-else :icon="voiceInputIcon" :class="voiceInputIconClass" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{{ voiceInputTooltip }}</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip v-if="isGenerating && hasActiveInput">
        <TooltipTrigger as-child>
          <Button
            data-testid="chat-steer-button"
            variant="outline"
            size="sm"
            class="h-7 gap-1.5 rounded-lg px-2.5 text-foreground"
            @click="emit('steer')"
          >
            <Icon icon="lucide:compass" class="w-4 h-4" />
            <span class="text-xs font-medium">{{ t('chat.input.steer') }}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{{ t('chat.input.steer') }}</p>
        </TooltipContent>
      </Tooltip>

      <!-- Primary action button -->
      <Tooltip :key="buttonMode">
        <TooltipTrigger as-child>
          <Button
            :data-testid="
              buttonMode === 'stop'
                ? 'chat-stop-button'
                : buttonMode === 'queue'
                  ? 'chat-queue-button'
                  : 'chat-send-button'
            "
            :data-mode="buttonMode"
            :variant="buttonMode === 'stop' ? 'outline' : 'default'"
            size="icon"
            class="h-7 w-7 rounded-full"
            :disabled="
              buttonMode === 'send' ? sendDisabled : buttonMode === 'queue' ? queueDisabled : false
            "
            @click="handlePrimaryAction"
          >
            <Icon
              :icon="
                buttonMode === 'stop'
                  ? 'lucide:square'
                  : buttonMode === 'queue'
                    ? 'lucide:list-plus'
                    : 'lucide:arrow-up'
              "
              :class="buttonMode === 'stop' ? 'w-4 h-4 text-red-500' : 'w-4 h-4'"
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{{ primaryTooltip }}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@shadcn/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    isGenerating?: boolean
    hasInput?: boolean
    hasText?: boolean
    sendDisabled?: boolean
    queueDisabled?: boolean
    showVoiceInput?: boolean
    isVoiceInputListening?: boolean
    isVoiceInputTranscribing?: boolean
  }>(),
  {
    isGenerating: false,
    hasInput: false,
    hasText: false,
    sendDisabled: false,
    queueDisabled: false,
    showVoiceInput: false,
    isVoiceInputListening: false,
    isVoiceInputTranscribing: false
  }
)

const emit = defineEmits<{
  send: []
  queue: []
  steer: []
  attach: []
  'voice-input': []
  stop: []
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
const voiceInputIcon = computed(() => {
  if (props.isVoiceInputTranscribing) {
    return 'lucide:loader-circle'
  }

  return 'lucide:mic'
})
const voiceInputIconClass = computed(() => [
  'relative z-10 w-4 h-4',
  props.isVoiceInputTranscribing ? 'animate-spin' : ''
])
const voiceInputTooltip = computed(() => {
  if (props.isVoiceInputTranscribing) {
    return t('chat.input.stop')
  }

  if (props.isVoiceInputListening) {
    return t('chat.input.voiceInputStop')
  }

  return t('chat.input.voiceInput')
})
const buttonMode = computed<'send' | 'queue' | 'stop'>(() => {
  if (props.isGenerating && !hasActiveInput.value) return 'stop'
  if (props.isGenerating) return 'queue'
  return 'send'
})
const primaryTooltip = computed(() => {
  if (buttonMode.value === 'stop') return t('chat.input.stop')
  if (buttonMode.value === 'queue') return t('chat.input.queue')
  return t('chat.input.send')
})

function handlePrimaryAction() {
  if (buttonMode.value === 'stop') {
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
</style>
