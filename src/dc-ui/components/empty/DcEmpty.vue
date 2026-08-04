<script setup lang="ts">
import { Icon } from '@iconify/vue'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@shadcn/components/ui/empty'
import { cn } from '@shadcn/lib/utils'

interface Props {
  icon?: string
  title: string
  description?: string
  iconClassName?: string
}

withDefaults(defineProps<Props>(), {
  icon: 'lucide:inbox'
})
</script>

<template>
  <Empty
    :class="
      cn(
        'w-full rounded-lg border border-dashed border-border bg-background/30 py-10 text-center',
        $attrs.class ?? ''
      )
    "
  >
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Icon :icon="icon" :class="cn('size-6 text-muted-foreground', iconClassName)" />
      </EmptyMedia>
      <EmptyTitle>{{ title }}</EmptyTitle>
      <EmptyDescription v-if="description">{{ description }}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <slot />
      <div v-if="$slots.action" class="mt-4">
        <slot name="action" />
      </div>
    </EmptyContent>
  </Empty>
</template>
