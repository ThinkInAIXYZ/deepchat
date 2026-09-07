<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { cn } from '@shadcn/lib/utils'

interface Props {
  error?: string
  hint?: string
  showIcon?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showIcon: true
})

const text = computed(() => props.error ?? props.hint ?? '')
const isError = computed(() => Boolean(props.error))
</script>

<template>
  <p
    v-if="text"
    role="alert"
    :class="
      cn(
        'mt-1 flex items-start gap-1.5 text-xs leading-5',
        isError ? 'text-destructive' : 'text-muted-foreground'
      )
    "
  >
    <Icon
      v-if="showIcon"
      :icon="isError ? 'lucide:circle-alert' : 'lucide:info'"
      class="mt-0.5 size-3.5 shrink-0"
    />
    <span>{{ text }}</span>
  </p>
</template>
