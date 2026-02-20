<template>
  <Button
    v-if="!isStreaming || variant === 'newThread'"
    variant="default"
    size="icon"
    class="h-7 w-7 rounded-full"
    :disabled="disabled || isCallActive"
    @click="emit('send')"
  >
    <Icon icon="lucide:arrow-up" class="w-4 h-4" />
  </Button>
  <Button
    v-else
    key="cancel"
    variant="destructive"
    size="icon"
    class="h-7 w-7 rounded-full"
    @click="emit('cancel')"
  >
    <Icon icon="lucide:square" class="w-3.5 h-3.5" />
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
