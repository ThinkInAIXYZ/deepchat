<script setup lang="ts">
import { RadioGroup as UiRadioGroup } from '@/components/ui/radio-group'
</script>

<template>
  <UiRadioGroup v-bind="$attrs">
    <slot />
  </UiRadioGroup>
</template>
