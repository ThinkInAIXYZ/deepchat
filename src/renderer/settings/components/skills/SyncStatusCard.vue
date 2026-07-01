<template>
  <div
    data-testid="skills-sync-tool-card"
    :data-tool-id="tool.toolId"
    class="flex items-center justify-between p-2 border rounded-lg transition-colors"
    :class="{
      'hover:bg-accent': tool.available && skillCount > 0,
      'opacity-60': !tool.available
    }"
  >
    <div class="flex items-center gap-2 min-w-0">
      <!-- Status indicator -->
      <div class="relative shrink-0">
        <div
          class="w-6 h-6 rounded flex items-center justify-center"
          :class="getToolIconBg(tool.toolId)"
        >
          <Icon :icon="getToolIcon(tool.toolId)" class="w-3.5 h-3.5" />
        </div>
        <!-- Connection status dot -->
        <div
          class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-background"
          :class="tool.available ? 'bg-green-500' : 'bg-muted-foreground'"
        />
      </div>

      <!-- Tool info -->
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium flex items-center gap-1.5 truncate">
          {{ tool.toolName }}
          <Badge v-if="tool.available && skillCount > 0" variant="secondary" class="text-xs px-1">
            {{ skillCount }}
          </Badge>
        </div>
      </div>
    </div>

    <!-- Action button -->
    <Button
      v-if="tool.available && skillCount > 0"
      size="sm"
      variant="outline"
      class="shrink-0 ml-2 h-7 px-2 text-xs"
      :disabled="syncing"
      @click.stop="handleSync"
    >
      <Icon
        :icon="syncing ? 'lucide:loader-2' : 'lucide:download'"
        class="w-3.5 h-3.5"
        :class="{ 'animate-spin': syncing }"
      />
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import type { ScanResult } from '@shared/types/skillSync'
import { getSkillToolIcon as getToolIcon, getSkillToolIconBg as getToolIconBg } from './toolIcon'

const props = defineProps<{
  tool: ScanResult
  syncing: boolean
}>()

const emit = defineEmits<{
  sync: [toolId: string]
}>()

const skillCount = computed(() => props.tool.skills?.length ?? 0)

const handleSync = () => {
  emit('sync', props.tool.toolId)
}
</script>
