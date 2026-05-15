<template>
  <Card
    :class="[
      'min-w-0',
      interactive
        ? ' transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        : ''
    ]"
    :role="interactive ? 'button' : undefined"
    :tabindex="interactive ? 0 : undefined"
    @click="handleSelect"
    @keydown.enter="handleSelect"
    @keydown.space.prevent="handleSelect"
  >
    <CardHeader class="gap-2 pb-3">
      <div class="flex items-center justify-between gap-3">
        <CardDescription class="truncate">{{ label }}</CardDescription>
        <Icon :icon="icon" class="size-4 shrink-0 text-muted-foreground" />
      </div>
      <CardTitle class="truncate text-2xl">{{ value }}</CardTitle>
    </CardHeader>
    <CardContent v-if="description || badge">
      <div class="flex min-w-0 items-center justify-between gap-2">
        <p v-if="description" class="truncate text-xs text-muted-foreground">
          {{ description }}
        </p>
        <Badge v-if="badge" variant="secondary" class="shrink-0">
          {{ badge }}
        </Badge>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@shadcn/components/ui/card'

const props = defineProps<{
  label: string
  value: string
  icon: string
  description?: string
  badge?: string
  interactive?: boolean
}>()

const emit = defineEmits<{
  (e: 'select'): void
}>()

const handleSelect = () => {
  if (props.interactive) {
    emit('select')
  }
}
</script>
