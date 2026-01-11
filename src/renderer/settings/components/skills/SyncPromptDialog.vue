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
          v-for="tool in detectedTools"
          :key="tool.toolId"
          class="flex items-center justify-between p-3 border rounded-lg"
        >
          <div class="flex items-center gap-3">
            <div
              class="w-9 h-9 rounded-lg flex items-center justify-center"
              :class="getToolIconBg(tool.toolId)"
            >
              <Icon :icon="getToolIcon(tool.toolId)" class="w-4 h-4" />
            </div>
            <div>
              <div class="font-medium text-sm">{{ tool.toolName }}</div>
              <div class="text-xs text-muted-foreground">
                {{ t('settings.skills.syncStatus.skillCount', { count: tool.skills.length }) }}
              </div>
            </div>
          </div>
          <Checkbox
            :checked="selectedTools.has(tool.toolId)"
            @update:checked="toggleTool(tool.toolId)"
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
import { ref, onMounted } from 'vue'
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
import type { ScanResult } from '@shared/types/skillSync'

const emit = defineEmits<{
  import: [toolIds: string[]]
  close: []
}>()

const { t } = useI18n()
const configPresenter = usePresenter('configPresenter')
const skillSyncPresenter = usePresenter('skillSyncPresenter')

const isOpen = ref(false)
const detectedTools = ref<ScanResult[]>([])
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
    await configPresenter.setSetting('skills.syncPromptShown', true)
  }
  isOpen.value = false
  emit('close')
}

const handleImport = async () => {
  await configPresenter.setSetting('skills.syncPromptShown', true)
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

// Check and show dialog on mount
onMounted(async () => {
  try {
    // Check if we've already shown this prompt
    const shown = await configPresenter.getSetting('skills.syncPromptShown')
    if (shown) return

    // Scan for external tools
    const results = await skillSyncPresenter.scanExternalTools()

    // Filter to only available tools with skills (user-level only)
    const availableTools = results.filter(
      (tool) => tool.available && tool.skills.length > 0 && !tool.toolId.includes('project')
    )

    if (availableTools.length > 0) {
      detectedTools.value = availableTools
      // Pre-select all tools
      selectedTools.value = new Set(availableTools.map((t) => t.toolId))
      isOpen.value = true
    }
  } catch (error) {
    console.error('Failed to check for external tools:', error)
  }
})

// Expose method for parent component to trigger check
defineExpose({
  checkAndShow: async () => {
    const results = await skillSyncPresenter.scanExternalTools()
    const availableTools = results.filter(
      (tool) => tool.available && tool.skills.length > 0 && !tool.toolId.includes('project')
    )
    if (availableTools.length > 0) {
      detectedTools.value = availableTools
      selectedTools.value = new Set(availableTools.map((t) => t.toolId))
      isOpen.value = true
    }
  }
})
</script>
