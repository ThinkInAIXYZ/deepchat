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
            variant="ghost"
            size="icon"
            class="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <Icon icon="lucide:mic" class="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{{ t('chat.input.voiceInput') }}</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip v-if="isGenerating && hasActiveInput">
        <TooltipTrigger as-child>
          <Button
            data-testid="chat-steer-button"
            variant="ghost"
            size="icon"
            class="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            @click="emit('steer')"
          >
            <Icon icon="lucide:compass" class="w-4 h-4" />
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
  }>(),
  {
    isGenerating: false,
    hasInput: false,
    hasText: false,
    sendDisabled: false,
    queueDisabled: false,
    showVoiceInput: false
  }
)

const emit = defineEmits<{
  send: []
  queue: []
  steer: []
  attach: []
  stop: []
}>()

const { t } = useI18n()
const hasActiveInput = computed(() => props.hasInput || props.hasText)
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
