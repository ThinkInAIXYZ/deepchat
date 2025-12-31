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
      v-if="showWorkspaceButton"
      key="open-workspace"
      variant="outline"
      size="icon"
      class="w-8 h-8 shrink-0 opacity-100 bg-card backdrop-blur-lg z-30"
      :title="t('chat.workspace.title')"
      @click="$emit('open-workspace')"
    >
      <Icon icon="lucide:layout-dashboard" class="w-5 h-5 text-foreground" />
    </Button>

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
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  showCleanButton: boolean
  showScrollButton: boolean
  showWorkspaceButton?: boolean
}>()

defineEmits<{
  clean: []
  'scroll-to-bottom': []
  'open-workspace': []
}>()

const handleBeforeLeave = (el: Element) => {
  const element = el as HTMLElement
  const rect = element.getBoundingClientRect()
  // 只写入四个 CSS 变量，减少重排/回流次数
  element.style.setProperty('--leave-w', `${rect.width}px`)
  element.style.setProperty('--leave-h', `${rect.height}px`)
  element.style.setProperty('--leave-l', `${rect.left}px`)
  element.style.setProperty('--leave-t', `${rect.top}px`)
  element.classList.add('message-action-leaving')
  // 强制回流，确保样式变更被浏览器采纳（触发过渡）
  void element.offsetWidth
}

const handleAfterLeave = (el: Element) => {
  const element = el as HTMLElement
  element.classList.remove('message-action-leaving')
  element.style.removeProperty('--leave-w')
  element.style.removeProperty('--leave-h')
  element.style.removeProperty('--leave-l')
  element.style.removeProperty('--leave-t')
}
</script>

<style scoped>
.message-actions-move {
  transition: transform 0.3s ease;
}

/* 当元素离开时切换到这个 class，由 CSS 控制定位与过渡 */
.message-action-leaving {
  position: absolute;
  width: var(--leave-w);
  height: var(--leave-h);
  left: var(--leave-l);
  top: var(--leave-t);
  pointer-events: none;
  /* 控制离场的属性过渡（和 template 中的 leave-* class 一起工作） */
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
</style>
