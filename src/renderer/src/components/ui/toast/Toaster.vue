<script setup lang="ts">
import 'vue-sonner/style.css'
import { Toaster as SonnerToaster } from '@shadcn/components/ui/sonner'
</script>

<template>
  <SonnerToaster
    position="top-right"
    :toast-options="{
      class: 'rounded-md border border-border bg-popover text-popover-foreground shadow-lg',
    }"
  />
</template>
