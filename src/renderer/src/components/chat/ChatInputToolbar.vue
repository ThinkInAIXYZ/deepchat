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
      <Tooltip>
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

      <!-- Send button -->
      <Button
        v-if="!isGenerating"
        size="icon"
        class="h-7 w-7 rounded-full"
        :disabled="sendDisabled"
        @click="$emit('send')"
      >
        <Icon icon="lucide:arrow-up" class="w-4 h-4" />
      </Button>
      <Button
        v-else
        variant="outline"
        size="icon"
        class="h-7 w-7 rounded-full"
        @click="$emit('stop')"
      >
        <Icon icon="lucide:square" class="w-4 h-4 text-red-500" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@shadcn/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'

withDefaults(
  defineProps<{
    isGenerating?: boolean
    sendDisabled?: boolean
  }>(),
  {
    isGenerating: false,
    sendDisabled: false
  }
)

defineEmits<{
  send: []
  attach: []
  stop: []
}>()

const { t } = useI18n()
</script>
