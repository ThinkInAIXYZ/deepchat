<script setup lang="ts">
import { Card as UiCard } from '@/components/ui/card'
</script>

<template>
  <UiCard v-bind="$attrs">
    <slot />
  </UiCard>
</template>
