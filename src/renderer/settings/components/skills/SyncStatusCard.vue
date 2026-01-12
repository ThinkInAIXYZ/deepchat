<template>
  <div
    class="flex items-center justify-between p-3 border rounded-lg transition-colors"
    :class="{
      'hover:bg-accent cursor-pointer': tool.available,
      'opacity-60': !tool.available
    }"
  >
    <div class="flex items-center gap-3">
      <!-- Status indicator -->
      <div class="relative">
        <div
          class="w-10 h-10 rounded-lg flex items-center justify-center"
          :class="getToolIconBg(tool.toolId)"
        >
          <Icon :icon="getToolIcon(tool.toolId)" class="w-5 h-5" />
        </div>
        <!-- Connection status dot -->
        <div
          class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background"
          :class="tool.available ? 'bg-green-500' : 'bg-muted-foreground'"
        />
      </div>

      <!-- Tool info -->
      <div class="min-w-0">
        <div class="font-medium flex items-center gap-2">
          {{ tool.toolName }}
          <Badge v-if="tool.available" variant="secondary" class="text-xs">
            {{ t('settings.skills.syncStatus.skillCount', { count: skillCount }) }}
          </Badge>
        </div>
        <div class="text-xs text-muted-foreground truncate max-w-[280px]">
          <template v-if="tool.available">
            {{ tool.skillsDir }}
          </template>
          <template v-else>
            {{ t('settings.skills.syncStatus.notInstalled') }}
          </template>
        </div>
      </div>
    </div>

    <!-- Action button -->
    <div class="flex items-center gap-2">
      <Button
        v-if="tool.available && skillCount > 0"
        size="sm"
        variant="outline"
        :disabled="syncing"
        @click.stop="handleSync"
      >
        <Icon
          :icon="syncing ? 'lucide:loader-2' : 'lucide:download'"
          class="w-4 h-4 mr-1"
          :class="{ 'animate-spin': syncing }"
        />
        {{
          syncing ? t('settings.skills.syncStatus.syncing') : t('settings.skills.syncStatus.import')
        }}
      </Button>
      <Button v-else-if="!tool.available" size="sm" variant="ghost" disabled>
        <Icon icon="lucide:external-link" class="w-4 h-4 mr-1" />
        {{ t('settings.skills.syncStatus.notAvailable') }}
      </Button>
      <Button v-else size="sm" variant="ghost" disabled>
        {{ t('settings.skills.syncStatus.noSkills') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import type { ScanResult } from '@shared/types/skillSync'

const props = defineProps<{
  tool: ScanResult
  syncing: boolean
}>()

const emit = defineEmits<{
  sync: [toolId: string]
}>()

const { t } = useI18n()

const skillCount = computed(() => props.tool.skills?.length ?? 0)

const handleSync = () => {
  emit('sync', props.tool.toolId)
}

const getToolIcon = (toolId: string): string => {
  const icons: Record<string, string> = {
    'claude-code': 'simple-icons:anthropic',
    cursor: 'simple-icons:cursor',
    'cursor-project': 'simple-icons:cursor',
    windsurf: 'lucide:wind',
    copilot: 'simple-icons:github',
    'copilot-user': 'simple-icons:github',
    kiro: 'lucide:sparkles',
    antigravity: 'lucide:rocket',
    codex: 'simple-icons:openai',
    opencode: 'lucide:code-2',
    goose: 'lucide:bird',
    kilocode: 'lucide:binary'
  }
  return icons[toolId] || 'lucide:box'
}

const getToolIconBg = (toolId: string): string => {
  const bgs: Record<string, string> = {
    'claude-code': 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
    cursor: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    'cursor-project': 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    windsurf: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400',
    copilot: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    'copilot-user': 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    kiro: 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400',
    antigravity: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    codex: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
    opencode: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
    goose: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    kilocode: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
  }
  return bgs[toolId] || 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400'
}
</script>
