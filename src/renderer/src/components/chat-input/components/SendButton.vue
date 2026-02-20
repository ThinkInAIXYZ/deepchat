<template>
  <Button
    v-if="!isStreaming || variant === 'newThread'"
    variant="default"
    size="icon"
    class="w-7 h-7 text-xs rounded-lg"
    :disabled="disabled || isCallActive"
    @click="emit('send')"
  >
    <Icon icon="lucide:arrow-up" class="w-4 h-4" />
  </Button>
  <Button
    v-else
    key="cancel"
    variant="outline"
    size="icon"
    class="w-7 h-7 text-xs rounded-lg bg-card backdrop-blur-lg"
    @click="emit('cancel')"
  >
    <Icon
      icon="lucide:square"
      class="w-6 h-6 bg-red-500 p-1 text-primary-foreground rounded-full"
    />
  </Button>
</template>

<script setup lang="ts">
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'

defineProps<{
  variant: 'chat' | 'newThread'
  isStreaming: boolean
  disabled: boolean
  isCallActive: boolean
}>()

const emit = defineEmits<{
  send: []
  cancel: []
}>()
</script>
