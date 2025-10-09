<template>
  <div class="space-y-4">
    <KbdGroup class="flex flex-wrap gap-2">
      <Kbd><span class="font-semibold">⌘</span> K</Kbd>
      <Kbd><span class="font-semibold">⌘</span> Shift P</Kbd>
      <Kbd>Ctrl /</Kbd>
    </KbdGroup>

    <div class="space-y-2 rounded-lg border border-border p-4">
      <h4 class="text-sm font-semibold">Editor shortcuts</h4>
      <ul class="space-y-2 text-sm text-muted-foreground">
        <li class="flex items-center justify-between">
          Comment selection
          <Kbd>⌘ /</Kbd>
        </li>
        <li class="flex items-center justify-between">
          Format document
          <Kbd>Shift Alt F</Kbd>
        </li>
        <li class="flex items-center justify-between">
          Open palette
          <Kbd>⌘ Shift P</Kbd>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Kbd, KbdGroup } from '@shadcn/components/ui/kbd'
</script>
