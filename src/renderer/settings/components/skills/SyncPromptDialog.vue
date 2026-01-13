<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Icon icon="lucide:wand-sparkles" class="w-5 h-5 text-primary" />
          {{ t('settings.skills.syncPrompt.title') }}
        </DialogTitle>
        <DialogDescription>
          {{ t('settings.skills.syncPrompt.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-3 py-4">
        <!-- Detected tools list -->
        <div
          v-for="discovery in discoveries"
          :key="discovery.toolId"
          class="flex items-center justify-between p-3 border rounded-lg"
        >
          <div class="flex items-center gap-3">
            <div
              class="w-9 h-9 rounded-lg flex items-center justify-center"
              :class="getToolIconBg(discovery.toolId)"
            >
              <Icon :icon="getToolIcon(discovery.toolId)" class="w-4 h-4" />
            </div>
            <div>
              <div class="font-medium text-sm">{{ discovery.toolName }}</div>
              <div class="text-xs text-muted-foreground">
                {{
                  t('settings.skills.syncStatus.skillCount', { count: discovery.newSkills.length })
                }}
              </div>
            </div>
          </div>
          <Checkbox
            :checked="selectedTools.has(discovery.toolId)"
            @update:checked="toggleTool(discovery.toolId)"
          />
        </div>
      </div>

      <!-- Don't show again checkbox -->
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox v-model:checked="dontShowAgain" />
        <span>{{ t('settings.skills.syncPrompt.dontShowAgain') }}</span>
      </div>

      <DialogFooter class="gap-2 sm:gap-0">
        <Button variant="ghost" @click="handleSkip">
          {{ t('settings.skills.syncPrompt.skip') }}
        </Button>
        <Button :disabled="selectedTools.size === 0" @click="handleImport">
          <Icon icon="lucide:download" class="w-4 h-4 mr-1" />
          {{ t('settings.skills.syncPrompt.importSelected') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { usePresenter } from '@/composables/usePresenter'
import type { NewDiscovery } from '@shared/types/skillSync'
import { SKILL_SYNC_EVENTS } from '@/events'

const emit = defineEmits<{
  import: [toolIds: string[]]
  close: []
}>()

const { t } = useI18n()
const skillSyncPresenter = usePresenter('skillSyncPresenter')

const isOpen = ref(false)
const discoveries = ref<NewDiscovery[]>([])
const selectedTools = ref<Set<string>>(new Set())
const dontShowAgain = ref(false)

const toggleTool = (toolId: string) => {
  if (selectedTools.value.has(toolId)) {
    selectedTools.value.delete(toolId)
  } else {
    selectedTools.value.add(toolId)
  }
  // Trigger reactivity
  selectedTools.value = new Set(selectedTools.value)
}

const handleSkip = async () => {
  if (dontShowAgain.value) {
    // Acknowledge discoveries so they won't show again
    await skillSyncPresenter.acknowledgeDiscoveries()
  }
  isOpen.value = false
  emit('close')
}

const handleImport = async () => {
  // Acknowledge discoveries after import
  await skillSyncPresenter.acknowledgeDiscoveries()
  isOpen.value = false
  emit('import', Array.from(selectedTools.value))
}

const getToolIcon = (toolId: string): string => {
  const icons: Record<string, string> = {
    'claude-code': 'simple-icons:anthropic',
    cursor: 'simple-icons:cursor',
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

// Listen for new discoveries event from main process
const handleNewDiscoveries = (_event: unknown, data: { discoveries: NewDiscovery[] }) => {
  if (data.discoveries && data.discoveries.length > 0) {
    discoveries.value = data.discoveries
    selectedTools.value = new Set(data.discoveries.map((d) => d.toolId))
    isOpen.value = true
  }
}

let cleanup: (() => void) | null = null

onMounted(() => {
  // Listen for new discoveries event
  if (window.electron?.ipcRenderer) {
    window.electron.ipcRenderer.on(SKILL_SYNC_EVENTS.NEW_DISCOVERIES, handleNewDiscoveries)
    cleanup = () => {
      window.electron.ipcRenderer.removeListener(
        SKILL_SYNC_EVENTS.NEW_DISCOVERIES,
        handleNewDiscoveries
      )
    }
  }
})

onUnmounted(() => {
  cleanup?.()
})

// Expose method for parent component to trigger check
defineExpose({
  checkAndShow: async () => {
    const newDiscoveries = await skillSyncPresenter.getNewDiscoveries()
    if (newDiscoveries.length > 0) {
      discoveries.value = newDiscoveries
      selectedTools.value = new Set(newDiscoveries.map((d) => d.toolId))
      isOpen.value = true
    }
  }
})
</script>
