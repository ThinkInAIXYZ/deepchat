<template>
  <Card
    :class="[
      'cursor-pointer transition-all duration-200 p-2 rounded-lg shadow-none outline-1 outline-black/10',
      'hover:shadow-md hover:border-input',
      selected ? 'shadow-sm' : 'border-border'
    ]"
    @click="$emit('click')"
  >
    <div class="flex items-center gap-2.5">
      <!-- Agent 图标 -->
      <div class="w-8 h-8 rounded-md bg-card flex items-center justify-center shrink-0">
        <ModelIcon :model-id="agent.id" :is-dark="themeStore.isDark" class="w-5 h-5" />
      </div>

      <!-- Agent 信息 -->
      <div class="flex-1 min-w-0 flex items-center justify-between gap-2">
        <CardTitle class="text-xs font-medium truncate">{{ agent.name }}</CardTitle>
      </div>
    </div>
  </Card>
</template>

<script setup lang="ts">
import { Card, CardTitle } from '@shadcn/components/ui/card'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { useThemeStore } from '@/stores/theme'
import type { AcpBuiltinAgent, AcpCustomAgent } from '@shared/types/presenters/legacy.presenters'

interface Props {
  agent: AcpBuiltinAgent | AcpCustomAgent
  selected?: boolean
}

defineProps<Props>()

defineEmits<{
  (e: 'click'): void
}>()

const themeStore = useThemeStore()
</script>
