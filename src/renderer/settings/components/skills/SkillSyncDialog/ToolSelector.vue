<template>
  <div class="space-y-4">
    <div v-if="loading" class="flex items-center justify-center py-8">
      <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-muted-foreground" />
      <span class="ml-2 text-muted-foreground">{{ t('settings.skills.sync.scanning') }}</span>
    </div>

    <div v-else-if="tools.length === 0" class="text-center py-8">
      <Icon icon="lucide:inbox" class="w-12 h-12 mx-auto text-muted-foreground/50 mb-2" />
      <p class="text-muted-foreground">{{ t('settings.skills.sync.noToolsFound') }}</p>
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="tool in tools"
        :key="tool.toolId"
        class="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-accent transition-colors"
        :class="{ 'border-primary bg-accent': selectedToolId === tool.toolId }"
        @click="handleSelect(tool)"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-lg flex items-center justify-center"
            :class="getToolIconBg(tool.toolId)"
          >
            <Icon :icon="getToolIcon(tool.toolId)" class="w-5 h-5" />
          </div>
          <div>
            <div class="font-medium">{{ tool.toolName }}</div>
            <div class="text-xs text-muted-foreground truncate max-w-[300px]">
              {{ tool.skillsDir }}
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Badge v-if="tool.available" variant="secondary">
            {{ t('settings.skills.sync.skillCount', { count: tool.skills.length }) }}
          </Badge>
          <Badge v-else variant="outline" class="text-muted-foreground">
            {{ t('settings.skills.sync.notInstalled') }}
          </Badge>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import type { ScanResult } from '@shared/types/skillSync'

defineProps<{
  tools: ScanResult[]
  selectedToolId: string | null
  loading: boolean
}>()

const emit = defineEmits<{
  select: [tool: ScanResult]
}>()

const { t } = useI18n()

const handleSelect = (tool: ScanResult) => {
  if (tool.available && tool.skills.length > 0) {
    emit('select', tool)
  }
}

const getToolIcon = (toolId: string): string => {
  const icons: Record<string, string> = {
    'claude-code': 'simple-icons:anthropic',
    cursor: 'simple-icons:cursor',
    windsurf: 'lucide:wind',
    copilot: 'simple-icons:github',
    kiro: 'lucide:sparkles',
    antigravity: 'lucide:rocket'
  }
  return icons[toolId] || 'lucide:box'
}

const getToolIconBg = (toolId: string): string => {
  const bgs: Record<string, string> = {
    'claude-code': 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
    cursor: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    windsurf: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400',
    copilot: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    kiro: 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400',
    antigravity: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
  }
  return bgs[toolId] || 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400'
}
</script>
