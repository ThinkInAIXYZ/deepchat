<template>
  <div class="space-y-4">
    <!-- Section header -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-medium">{{ t('settings.skills.syncStatus.title') }}</h3>
        <p class="text-xs text-muted-foreground">
          {{ t('settings.skills.syncStatus.description') }}
        </p>
      </div>
      <Button variant="ghost" size="sm" :disabled="scanning" @click="refresh">
        <Icon
          :icon="scanning ? 'lucide:loader-2' : 'lucide:refresh-cw'"
          class="w-4 h-4"
          :class="{ 'animate-spin': scanning }"
        />
      </Button>
    </div>

    <!-- Loading state -->
    <div v-if="scanning && tools.length === 0" class="flex items-center justify-center py-6">
      <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin text-muted-foreground" />
      <span class="ml-2 text-sm text-muted-foreground">
        {{ t('settings.skills.syncStatus.scanning') }}
      </span>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="tools.length === 0"
      class="flex flex-col items-center justify-center py-6 text-center"
    >
      <Icon icon="lucide:inbox" class="w-10 h-10 text-muted-foreground/50 mb-2" />
      <p class="text-sm text-muted-foreground">
        {{ t('settings.skills.syncStatus.noToolsFound') }}
      </p>
    </div>

    <!-- Tools list -->
    <div v-else class="space-y-2">
      <SyncStatusCard
        v-for="tool in filteredTools"
        :key="tool.toolId"
        :tool="tool"
        :syncing="syncingTools.has(tool.toolId)"
        @sync="handleSync"
      />

      <!-- Show more / less toggle -->
      <Button
        v-if="hasHiddenTools"
        variant="ghost"
        size="sm"
        class="w-full text-muted-foreground"
        @click="showAll = !showAll"
      >
        <Icon :icon="showAll ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="w-4 h-4 mr-1" />
        {{
          showAll
            ? t('settings.skills.syncStatus.showLess')
            : t('settings.skills.syncStatus.showMore', { count: tools.length - 3 })
        }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { useToast } from '@/components/use-toast'
import { usePresenter } from '@/composables/usePresenter'
import type { ScanResult } from '@shared/types/skillSync'
import SyncStatusCard from './SyncStatusCard.vue'

const emit = defineEmits<{
  import: [toolId: string, skills: string[]]
}>()

const { t } = useI18n()
const { toast } = useToast()
const skillSyncPresenter = usePresenter('skillSyncPresenter')

const tools = ref<ScanResult[]>([])
const scanning = ref(false)
const syncingTools = ref<Set<string>>(new Set())
const showAll = ref(false)

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

const filteredTools = computed(() => {
  if (showAll.value) return sortedTools.value
  return sortedTools.value.slice(0, 3)
})

const hasHiddenTools = computed(() => sortedTools.value.length > 3)

const refresh = async () => {
  scanning.value = true
  try {
    const results = await skillSyncPresenter.scanExternalTools()
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
  // Note: We don't listen for skill-sync:scan-completed here
  // because calling refresh() in response to that event would
  // cause an infinite loop (scan -> event -> refresh -> scan...)
  // The refresh button is available for manual refresh
})
</script>
