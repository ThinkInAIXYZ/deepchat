<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import type { ChatComponentProps } from '../types'

interface Props extends ChatComponentProps {
  title?: string
  subtitle?: string
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {})

const headerClasses = computed(() =>
  cn(
    'flex items-center justify-between',
    'px-4 py-3 border-b border-border',
    'bg-background/95 backdrop-blur',
    props.class
  )
)
</script>

<template>
  <div :class="headerClasses">
    <div class="flex flex-col">
      <h2 v-if="title" class="text-sm font-semibold text-foreground">
        {{ title }}
      </h2>
      <p v-if="subtitle" class="text-xs text-muted-foreground">
        {{ subtitle }}
      </p>
    </div>

    <div class="flex items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
