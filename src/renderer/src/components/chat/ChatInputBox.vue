<template>
  <div
    class="w-full max-w-2xl rounded-xl border bg-card/30 backdrop-blur-lg shadow-sm overflow-hidden"
  >
    <Textarea
      :placeholder="placeholder ?? 'Ask DeepChat anything, @ to mention files, / for commands'"
      class="min-h-[80px] resize-none border-0 shadow-none focus-visible:ring-0 focus-visible:border-0 bg-transparent! dark:bg-transparent placeholder:text-muted-foreground px-4 pt-4 pb-2 text-sm"
      :model-value="modelValue ?? ''"
      @update:model-value="$emit('update:modelValue', $event)"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
      @keydown="handleKeydown"
    />

    <slot name="toolbar" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Textarea } from '@shadcn/components/ui/textarea'

defineProps<{
  modelValue?: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
}>()

const isComposing = ref(false)

function onCompositionStart() {
  isComposing.value = true
}

function onCompositionEnd() {
  isComposing.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey) return

  // Keep Enter for IME candidate confirmation; do not submit while composing.
  const isImeComposing = isComposing.value || e.isComposing || e.keyCode === 229
  if (isImeComposing) return

  e.preventDefault()
  emit('submit')
}
</script>
