<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Badge, type BadgeVariants } from '@shadcn/components/ui/badge'
import { cn } from '@shadcn/lib/utils'

type DcBadgeVariant =
  | BadgeVariants['variant']
  | 'success'
  | 'warning'
  | 'danger'
  | 'active'
  | 'neutral'

interface Props {
  variant?: DcBadgeVariant
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default'
})

const semanticClass = (variant: DcBadgeVariant): string => {
  switch (variant) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    case 'warning':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'danger':
      return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400'
    case 'active':
      return 'border-primary/30 bg-primary/10 text-primary'
    case 'neutral':
      return 'border-border/60 bg-muted/35 text-muted-foreground'
    default:
      return ''
  }
}
</script>

<template>
  <Badge
    :variant="variant as BadgeVariants['variant']"
    :class="cn(semanticClass(variant), props.class)"
  >
    <slot />
  </Badge>
</template>
