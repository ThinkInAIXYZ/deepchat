<script setup lang="ts">
import { Textarea as UiTextarea } from '@shadcn/components/ui/textarea'
</script>

<template>
  <UiTextarea v-bind="$attrs">
    <slot />
  </UiTextarea>
</template>
