<script setup lang="ts">
import { nextTick, onMounted, ref, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { useVModel } from '@vueuse/core'

const props = defineProps<{
  class?: HTMLAttributes['class']
  defaultValue?: string
  modelValue?: string
  autoFocus?: boolean
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', payload: string): void
}>()

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue
})

const handleInput = (e: Event) => {
  const target = e.target as HTMLTextAreaElement
  modelValue.value = target.value
}

const textareaRef = ref<HTMLTextAreaElement>()

onMounted(() => {
  if (props.autoFocus) {
    nextTick(() => {
      textareaRef.value?.focus()
    })
  }
})
</script>

<template>
  <textarea
    ref="textareaRef"
    :value="(modelValue as any) || ''"
    @input="handleInput"
    :class="
      cn(
        'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        props.class
      )
    "
  />
</template>
