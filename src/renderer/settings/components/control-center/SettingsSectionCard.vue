<template>
  <Card>
    <CardHeader v-if="title || description || $slots.actions" class="gap-2">
      <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <CardTitle v-if="title" class="truncate text-base">
            {{ title }}
          </CardTitle>
          <CardDescription v-if="description" class="mt-1">
            {{ description }}
          </CardDescription>
        </div>
        <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
          <slot name="actions" />
        </div>
      </div>
    </CardHeader>
    <CardContent>
      <slot />
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@shadcn/components/ui/card'

defineProps<{
  title?: string
  description?: string
}>()
</script>
