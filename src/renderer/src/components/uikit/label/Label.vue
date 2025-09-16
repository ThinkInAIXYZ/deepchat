<script setup lang="ts">
import { Label as UiLabel } from '@/components/ui/label'
</script>

<template>
  <UiLabel v-bind="$attrs">
    <slot />
  </UiLabel>
</template>
