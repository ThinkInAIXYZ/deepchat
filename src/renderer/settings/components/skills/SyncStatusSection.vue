<template>
  <div class="space-y-4" data-testid="skills-sync-status-section">
    <!-- Section header -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-medium">{{ t('settings.skills.syncStatus.title') }}</h3>
        <p class="text-xs text-muted-foreground">
          {{ t('settings.skills.syncStatus.description') }}
        </p>
      </div>
      <Button
        data-testid="skills-sync-refresh-button"
        variant="ghost"
        size="sm"
        :disabled="scanning"
        @click="refresh"
      >
        <Spinner v-if="scanning" class="size-4" />
        <Icon v-else icon="lucide:refresh-cw" class="size-4" />
      </Button>
    </div>

    <!-- Loading state -->
    <div
      v-if="scanning && tools.length === 0"
      data-testid="skills-sync-scanning"
      class="flex items-center justify-center gap-2 py-6"
    >
      <Spinner class="size-5 text-muted-foreground" />
      <span class="text-sm text-muted-foreground">
        {{ t('settings.skills.syncStatus.scanning') }}
      </span>
    </div>

    <!-- Empty state -->
    <Empty v-else-if="tools.length === 0" data-testid="skills-sync-empty" class="border-0 py-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon icon="lucide:inbox" />
        </EmptyMedia>
        <EmptyDescription>
          {{ t('settings.skills.syncStatus.noToolsFound') }}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>

    <!-- Tools grid -->
    <div v-else data-testid="skills-sync-tools-grid" class="grid grid-cols-2 md:grid-cols-3 gap-2">
      <SyncStatusCard
        v-for="tool in sortedTools"
        :key="tool.toolId"
        :tool="tool"
        :syncing="syncingTools.has(tool.toolId)"
        @sync="handleSync"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@shadcn/components/ui/empty'
import { Spinner } from '@shadcn/components/ui/spinner'
import { useToast } from '@/components/use-toast'
import { createSkillSyncClient } from '@api/SkillSyncClient'
import type { ScanResult } from '@shared/types/skillSync'
import SyncStatusCard from './SyncStatusCard.vue'

const emit = defineEmits<{
  import: [toolId: string, skills: string[]]
}>()

const { t } = useI18n()
const { toast } = useToast()
const skillSyncClient = createSkillSyncClient()

const tools = ref<ScanResult[]>([])
const scanning = ref(false)
const syncingTools = ref<Set<string>>(new Set())

// Filter to only show user-level tools (not project-level)
// and prioritize available tools
const sortedTools = computed(() => {
  return [...tools.value]
    .filter((tool) => !tool.toolId.includes('project')) // Filter out project-level tools
    .sort((a, b) => {
      // Available tools first
      if (a.available && !b.available) return -1
      if (!a.available && b.available) return 1
      // Then by skill count
      return (b.skills?.length ?? 0) - (a.skills?.length ?? 0)
    })
})

const refresh = async () => {
  scanning.value = true
  try {
    const results = await skillSyncClient.scanExternalTools()
    tools.value = results
  } catch (error) {
    console.error('Failed to scan external tools:', error)
    toast({
      title: t('settings.skills.sync.scanError'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    scanning.value = false
  }
}

const handleSync = async (toolId: string) => {
  const tool = tools.value.find((t) => t.toolId === toolId)
  if (!tool || !tool.available) return

  // Emit event to open sync dialog with preselected tool
  emit(
    'import',
    toolId,
    tool.skills.map((s) => s.name)
  )
}

onMounted(async () => {
  await refresh()
  // Note: We don't listen for skillSync.scan.completed here
  // because calling refresh() in response to that event would
  // cause an infinite loop (scan -> event -> refresh -> scan...)
  // The refresh button is available for manual refresh
})
</script>
