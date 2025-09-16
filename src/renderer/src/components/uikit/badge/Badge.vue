<script setup lang="ts">
import { Badge as UiBadge } from '@/components/ui/badge'
</script>

<template>
  <UiBadge v-bind="$attrs">
    <slot />
  </UiBadge>
</template>
