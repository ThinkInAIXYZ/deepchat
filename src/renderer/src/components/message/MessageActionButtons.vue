<template>
  <TransitionGroup
    tag="div"
    class="absolute bottom-3 right-3 flex flex-col items-center gap-2"
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-300 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-2"
    move-class="message-actions-move"
    @before-leave="handleBeforeLeave"
    @after-leave="handleAfterLeave"
    @leave-cancelled="handleAfterLeave"
  >
    <Button
      v-if="showCleanButton"
      key="new-chat"
      variant="outline"
      size="icon"
      class="w-8 h-8 shrink-0 opacity-100 bg-card backdrop-blur-lg z-20"
      @click="$emit('clean')"
    >
      <Icon icon="lucide:brush-cleaning" class="w-6 h-6 text-foreground" />
    </Button>

    <Button
      v-if="showScrollButton"
      key="scroll-bottom"
      variant="outline"
      size="icon"
      class="w-8 h-8 shrink-0 relative z-10 backdrop-blur-lg"
      @click="$emit('scroll-to-bottom')"
    >
      <Icon icon="lucide:arrow-down" class="w-5 h-5 text-foreground" />
    </Button>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'

defineProps<{
  showCleanButton: boolean
  showScrollButton: boolean
}>()

defineEmits<{
  clean: []
  'scroll-to-bottom': []
}>()

const handleBeforeLeave = (el: Element) => {
  const element = el as HTMLElement
  const { offsetWidth, offsetHeight, offsetLeft, offsetTop } = element
  element.style.width = `${offsetWidth}px`
  element.style.height = `${offsetHeight}px`
  element.style.left = `${offsetLeft}px`
  element.style.top = `${offsetTop}px`
  element.style.position = 'absolute'
  element.style.pointerEvents = 'none'
}

const handleAfterLeave = (el: Element) => {
  const element = el as HTMLElement
  element.style.width = ''
  element.style.height = ''
  element.style.left = ''
  element.style.top = ''
  element.style.position = ''
  element.style.pointerEvents = ''
}
</script>

<style scoped>
.message-actions-move {
  transition: transform 0.3s ease;
}
</style>
