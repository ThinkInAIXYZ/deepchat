<template>
  <div ref="editorContainer" class="flex-1 min-h-0 overflow-y-auto relative">
    <editor-content
      :editor="editor"
      :class="['text-sm h-full']"
      @keydown="$emit('keydown', $event)"
    />
    <div v-if="showFakeCaret" class="fake-caret" :style="fakeCaretStyle" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { EditorContent, type Editor } from '@tiptap/vue-3'

defineProps<{
  editor: Editor
  variant: 'agent' | 'newThread' | 'acp'
  showFakeCaret: boolean
  fakeCaretStyle: Record<string, string>
}>()

defineEmits<{
  keydown: [e: KeyboardEvent]
}>()

const editorContainer = ref<HTMLElement | null>(null)

defineExpose({
  editorContainer
})
</script>

<style scoped>
.fake-caret {
  position: absolute;
  top: 0;
  left: 0;
  width: 2px;
  border-radius: 9999px;
  background: var(--primary);
  box-shadow: 0 0 10px var(--primary);
  animation: fake-caret-blink 1.2s steps(1) infinite;
  transition:
    transform 140ms cubic-bezier(0.22, 1, 0.36, 1),
    height 140ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 120ms ease;
  pointer-events: none;
  will-change: transform, height, opacity;
  opacity: 0.9;
}

@keyframes fake-caret-blink {
  0%,
  55% {
    opacity: 0.9;
  }
  55%,
  100% {
    opacity: 0.35;
  }
}
</style>
