<script setup lang="ts">
import { Button as UiButton } from '@shadcn/components/ui/button'
</script>

<template>
  <UiButton v-bind="$attrs">
    <slot />
  </UiButton>
</template>
