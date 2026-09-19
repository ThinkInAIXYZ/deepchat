<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@shadcn/components/ui/form'
import { cn } from '@shadcn/lib/utils'

interface Props {
  name: string
  label?: string
  description?: string
  class?: HTMLAttributes['class']
}

defineProps<Props>()
</script>

<template>
  <FormField v-slot="{ field }" :name="name">
    <FormItem :class="cn('grid gap-2', $attrs.class ?? '')">
      <FormLabel v-if="label">{{ label }}</FormLabel>
      <FormControl>
        <slot name="control" :field="field" />
      </FormControl>
      <FormDescription v-if="description">{{ description }}</FormDescription>
      <FormMessage />
    </FormItem>
  </FormField>
</template>
