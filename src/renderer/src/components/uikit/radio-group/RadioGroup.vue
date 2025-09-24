<script setup lang="ts">
import { RadioGroup as UiRadioGroup } from '@shadcn/components/ui/radio-group'
</script>

<template>
  <UiRadioGroup v-bind="$attrs">
    <slot />
  </UiRadioGroup>
</template>
