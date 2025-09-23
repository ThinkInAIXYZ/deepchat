<template>
  <EditorContent
    :editor="editor"
    v-bind="forwardedAttrs"
    :class="['prompt-input', baseClasses, attrs.class]"
    @keydown="emitKeydown"
  />
</template>

<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { EditorContent } from '@tiptap/vue-3'

defineOptions({ inheritAttrs: false })

defineProps<{
  editor: Editor
}>()

const emit = defineEmits<{
  (e: 'keydown', event: KeyboardEvent): void
}>()

const attrs = useAttrs()

const forwardedAttrs = computed(() => {
  const result: Record<string, unknown> = {}
  Object.entries(attrs).forEach(([key, value]) => {
    if (key !== 'class') {
      result[key] = value
    }
  })
  return result
})

const baseClasses =
  'w-full min-h-[96px] text-base leading-7 text-foreground focus:outline-none focus-visible:outline-none'

const emitKeydown = (event: KeyboardEvent) => {
  emit('keydown', event)
}
</script>

<style scoped>
.prompt-input :deep(.ProseMirror) {
  outline: none;
}
</style>
