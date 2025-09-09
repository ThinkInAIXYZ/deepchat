<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { MessageComponentProps, MessageContent } from '../types'

interface Props extends MessageComponentProps {
  message: MessageContent
  avatar?: string
  name?: string
  timestamp?: Date | string
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'assistant'
})

const messageClasses = computed(() => 
  cn(
    'flex gap-3 max-w-full',
    {
      'flex-row-reverse': props.variant === 'user',
      'flex-row': props.variant !== 'user'
    },
    props.class
  )
)

const contentClasses = computed(() =>
  cn(
    'flex flex-col gap-2 max-w-[80%]',
    {
      'items-end': props.variant === 'user',
      'items-start': props.variant !== 'user'
    }
  )
)

const bubbleClasses = computed(() =>
  cn(
    'rounded-lg px-3 py-2 text-sm',
    {
      'bg-primary text-primary-foreground': props.variant === 'user',
      'bg-muted text-foreground': props.variant === 'assistant',
      'bg-secondary text-secondary-foreground': props.variant === 'system',
      'bg-destructive text-destructive-foreground': props.variant === 'error'
    }
  )
)

const getAvatarFallback = () => {
  if (props.name) return props.name.charAt(0).toUpperCase()
  return props.variant === 'user' ? 'U' : 'A'
}
</script>

<template>
  <div :class="messageClasses">
    <!-- Avatar -->
    <Avatar class="h-8 w-8 shrink-0">
      <AvatarImage v-if="avatar" :src="avatar" />
      <AvatarFallback class="text-xs">
        {{ getAvatarFallback() }}
      </AvatarFallback>
    </Avatar>

    <!-- Message Content -->
    <div :class="contentClasses">
      <!-- Header with name and timestamp -->
      <div v-if="name || timestamp" 
           :class="cn('flex items-center gap-2 text-xs text-muted-foreground', {
             'flex-row-reverse': variant === 'user'
           })">
        <span v-if="name">{{ name }}</span>
        <span v-if="timestamp">{{ timestamp }}</span>
      </div>

      <!-- Message Bubble -->
      <div :class="bubbleClasses">
        <slot :message="message" />
      </div>

      <!-- Message Actions (Toolbar) -->
      <div class="flex items-center gap-1">
        <slot name="actions" :message="message" />
      </div>
    </div>
  </div>
</template>