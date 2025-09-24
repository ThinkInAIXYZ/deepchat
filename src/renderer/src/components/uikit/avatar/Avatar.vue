<script setup lang="ts">
import { Avatar as UiAvatar } from '@shadcn/components/ui/avatar'
</script>

<template>
  <UiAvatar v-bind="$attrs">
    <slot />
  </UiAvatar>
</template>
