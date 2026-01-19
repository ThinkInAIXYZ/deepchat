<template>
  <Card
    :class="[
      'cursor-pointer border-dashed bg-transparent transition-all duration-200 p-2 rounded-lg shadow-none',
      'hover:shadow-md hover:border-input'
    ]"
  >
    <div class="flex items-center gap-2.5">
      <!-- Agent 图标 -->
      <div class="w-8 h-8 rounded-md flex items-center justify-center shrink-0">
        <Icon icon="lucide:plus" class="w-5 h-5 text-muted-foreground" />
      </div>

      <!-- Agent 信息 -->
      <div class="flex-1 min-w-0 flex items-center justify-between gap-2">
        <CardTitle class="text-xs font-medium truncate">add agent</CardTitle>
      </div>
    </div>
  </Card>
</template>
<script setup lang="ts">
import { Card, CardTitle } from '@shadcn/components/ui/card'
import { Icon } from '@iconify/vue'
</script>
