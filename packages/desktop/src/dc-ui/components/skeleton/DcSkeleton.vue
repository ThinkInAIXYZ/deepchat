<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { Skeleton } from '@shadcn/components/ui/skeleton'
import { cn } from '@shadcn/lib/utils'

interface Props {
  width?: string
  height?: string
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full'
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  width: '100%',
  height: '1rem',
  rounded: 'md'
})

const roundedClass = computed(
  () =>
    ({
      none: 'rounded-none',
      sm: 'rounded-sm',
      md: 'rounded-md',
      lg: 'rounded-lg',
      full: 'rounded-full'
    })[props.rounded]
)
</script>

<template>
  <Skeleton :class="cn('bg-muted/60', roundedClass, props.class)" :style="{ width, height }" />
</template>
