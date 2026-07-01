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
import { createSkillSyncClient } from '@api/SkillSyncClient'
import type { NewDiscovery } from '@shared/types/skillSync'
import { getSkillToolIcon as getToolIcon, getSkillToolIconBg as getToolIconBg } from './toolIcon'

const emit = defineEmits<{
  import: [toolIds: string[]]
  close: []
}>()

const { t } = useI18n()
const skillSyncClient = createSkillSyncClient()

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
    await skillSyncClient.acknowledgeDiscoveries()
  }
  isOpen.value = false
  emit('close')
}

const handleImport = async () => {
  // Acknowledge discoveries after import
  await skillSyncClient.acknowledgeDiscoveries()
  isOpen.value = false
  emit('import', Array.from(selectedTools.value))
}

// Listen for new discoveries event from main process
const handleNewDiscoveries = (nextDiscoveries: NewDiscovery[]) => {
  if (nextDiscoveries.length > 0) {
    discoveries.value = nextDiscoveries
    selectedTools.value = new Set(nextDiscoveries.map((d) => d.toolId))
    isOpen.value = true
  }
}

let cleanup: (() => void) | null = null

onMounted(() => {
  cleanup = skillSyncClient.onDiscoveriesChanged(handleNewDiscoveries)
})

onUnmounted(() => {
  cleanup?.()
})

// Expose method for parent component to trigger check
defineExpose({
  checkAndShow: async () => {
    const newDiscoveries = await skillSyncClient.getNewDiscoveries()
    if (newDiscoveries.length > 0) {
      discoveries.value = newDiscoveries
      selectedTools.value = new Set(newDiscoveries.map((d) => d.toolId))
      isOpen.value = true
    }
  }
})
</script>
