<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '@shadcn/lib/utils'

export type DcStatus = 'neutral' | 'active' | 'success' | 'warning' | 'danger' | 'disabled'

type DcStatusAlias =
  | 'running'
  | 'loading'
  | 'error'
  | 'auth-required'
  | 'auth-error'
  | 'offline'
  | 'stopped'

type DcStatusInput = DcStatus | DcStatusAlias

interface Props {
  status: DcStatusInput
  label?: string
  showDot?: boolean
  pulse?: boolean
  size?: 'sm' | 'xs'
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  showDot: true,
  size: 'sm'
})

const normalize = (status: DcStatusInput): DcStatus => {
  switch (status) {
    case 'running':
      return 'success'
    case 'error':
    case 'auth-error':
      return 'danger'
    case 'auth-required':
      return 'warning'
    case 'loading':
      return 'active'
    case 'offline':
    case 'stopped':
      return 'neutral'
    default:
      return status
  }
}

const status = computed(() => normalize(props.status))

const dotClass = computed(() => {
  switch (status.value) {
    case 'success':
      return 'bg-emerald-500'
    case 'warning':
      return 'bg-amber-500'
    case 'danger':
      return 'bg-red-500'
    case 'active':
      return 'bg-primary'
    default:
      return 'bg-muted-foreground/60'
  }
})

const pillClass = computed(() => {
  switch (status.value) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    case 'warning':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'danger':
      return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400'
    case 'active':
      return 'border-primary/30 bg-primary/10 text-primary'
    case 'disabled':
      return 'border-border/60 bg-muted/40 text-muted-foreground'
    default:
      return 'border-border/60 bg-muted/35 text-muted-foreground'
  }
})
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 whitespace-nowrap',
        size === 'sm' ? 'text-xs' : 'text-[11px]',
        pillClass,
        props.class
      )
    "
  >
    <span v-if="showDot" :class="cn('size-1.5 rounded-full', dotClass, pulse && 'animate-pulse')" />
    <slot>{{ label }}</slot>
  </span>
</template>
