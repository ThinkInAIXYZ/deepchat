<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import type { ChatComponentProps } from '../types'

interface Props extends ChatComponentProps {
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {})

const containerClasses = computed(() => 
  cn(
    'flex flex-col h-full',
    'bg-background border border-border rounded-lg',
    'overflow-hidden',
    props.class
  )
)
</script>

<template>
  <div :class="containerClasses">
    <slot />
  </div>
</template>