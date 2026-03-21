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

      <!-- Primary action button -->
      <Tooltip :key="buttonMode">
        <TooltipTrigger as-child>
          <Button
            :variant="buttonMode === 'stop' ? 'outline' : 'default'"
            size="icon"
            class="h-7 w-7 rounded-full"
            :disabled="buttonMode === 'send' ? sendDisabled : false"
            @click="handlePrimaryAction"
          >
            <Icon
              :icon="buttonMode === 'stop' ? 'lucide:square' : 'lucide:arrow-up'"
              :class="buttonMode === 'stop' ? 'w-4 h-4 text-red-500' : 'w-4 h-4'"
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{{ buttonMode === 'stop' ? t('chat.input.stop') : t('chat.input.queue') }}</p>
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
    showVoiceInput?: boolean
  }>(),
  {
    isGenerating: false,
    hasInput: false,
    hasText: false,
    sendDisabled: false,
    showVoiceInput: false
  }
)

const emit = defineEmits<{
  send: []
  attach: []
  stop: []
}>()

const { t } = useI18n()
const hasActiveInput = computed(() => props.hasInput || props.hasText)
const buttonMode = computed<'send' | 'stop'>(() =>
  props.isGenerating && !hasActiveInput.value ? 'stop' : 'send'
)

function handlePrimaryAction() {
  if (buttonMode.value === 'stop') {
    emit('stop')
    return
  }
  emit('send')
}
</script>
