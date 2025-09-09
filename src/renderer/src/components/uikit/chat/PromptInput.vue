<script setup lang="ts">
import { computed, ref, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import type { ChatComponentProps } from '../types'

interface Props extends ChatComponentProps {
  placeholder?: string
  maxRows?: number
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Type your message...',
  maxRows: 6
})

const emit = defineEmits<{
  send: [content: string]
  input: [content: string]
}>()

const inputValue = ref('')
const textareaRef = ref<InstanceType<typeof Textarea>>()

const containerClasses = computed(() => 
  cn(
    'flex items-end gap-2 p-4',
    'border-t border-border bg-background/95 backdrop-blur',
    props.class
  )
)

const handleSend = () => {
  if (inputValue.value.trim() && !props.disabled) {
    emit('send', inputValue.value.trim())
    inputValue.value = ''
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend()
  }
}

const handleInput = () => {
  emit('input', inputValue.value)
}

defineExpose({
  focus: () => textareaRef.value?.$el?.focus(),
  clear: () => { inputValue.value = '' },
  setValue: (value: string) => { inputValue.value = value }
})
</script>

<template>
  <div :class="containerClasses">
    <div class="flex-1">
      <Textarea
        ref="textareaRef"
        v-model="inputValue"
        :placeholder="placeholder"
        :disabled="disabled || loading"
        :rows="1"
        :max-rows="maxRows"
        class="min-h-[40px] resize-none border-0 p-3 shadow-none focus-visible:ring-0"
        @keydown="handleKeydown"
        @input="handleInput"
      />
    </div>

    <Button 
      :disabled="!inputValue.trim() || disabled || loading"
      size="icon"
      @click="handleSend"
    >
      <slot name="send-icon">
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          width="16" 
          height="16" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          stroke-width="2" 
          stroke-linecap="round" 
          stroke-linejoin="round"
        >
          <path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z"/>
          <path d="M6 12h16"/>
        </svg>
      </slot>
    </Button>
  </div>
</template>