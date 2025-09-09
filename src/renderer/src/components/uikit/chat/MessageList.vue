<script setup lang="ts">
import { computed, ref, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ChatComponentProps, MessageContent } from '../types'

interface Props extends ChatComponentProps {
  messages?: MessageContent[]
  autoScroll?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  messages: () => [],
  autoScroll: true
})

const scrollAreaRef = ref<InstanceType<typeof ScrollArea>>()

const listClasses = computed(() => 
  cn(
    'flex-1 p-4 space-y-4',
    props.class
  )
)

// Auto-scroll to bottom when new messages arrive
const scrollToBottom = () => {
  if (props.autoScroll && scrollAreaRef.value) {
    // Implementation would depend on ScrollArea's API
  }
}

defineExpose({
  scrollToBottom
})
</script>

<template>
  <ScrollArea ref="scrollAreaRef" :class="listClasses">
    <div class="space-y-4">
      <slot :messages="messages" />
    </div>
  </ScrollArea>
</template>