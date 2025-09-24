<script setup lang="ts">
import { NumberField as UiNumberField } from '@shadcn/components/ui/number-field'
</script>

<template>
  <UiNumberField v-bind="$attrs">
    <slot />
  </UiNumberField>
</template>
