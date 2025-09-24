<script lang="ts" setup>
import type { ToasterProps } from "vue-sonner"
import { Toaster as Sonner } from "vue-sonner"

const props = defineProps<ToasterProps>()
</script>

<template>
  <Sonner
    class="toaster group"
    v-bind="props"
    :style="{
      '--normal-bg': 'hsl(var(--popover))',
      '--normal-text': 'hsl(var(--popover-foreground))',
      '--normal-border': 'hsl(var(--border))',
      '--success-bg': 'hsl(var(--primary))',
      '--success-text': 'hsl(var(--primary-foreground))',
      '--error-bg': 'hsl(var(--destructive))',
      '--error-text': 'hsl(var(--destructive-foreground))',
      '--warning-bg': 'hsl(var(--accent))',
      '--warning-text': 'hsl(var(--accent-foreground))',
      '--info-bg': 'hsl(var(--muted))',
      '--info-text': 'hsl(var(--muted-foreground))',
    }"
  />
</template>
