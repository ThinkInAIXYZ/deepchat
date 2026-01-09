<template>
  <div class="w-full h-full flex flex-col">
    <!-- Header -->
    <SkillsHeader
      v-model:search-query="searchQuery"
      @install="installDialogOpen = true"
      @import="openSyncDialog('import')"
      @export="openSyncDialog('export')"
    />

    <Separator class="my-4" />

    <!-- Skills grid -->
    <ScrollArea class="flex-1 px-4">
      <div v-if="loading" class="flex items-center justify-center py-8">
        <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-muted-foreground" />
      </div>

      <div
        v-else-if="filteredSkills.length === 0"
        class="flex flex-col items-center justify-center py-8"
      >
        <Icon icon="lucide:wand-sparkles" class="w-12 h-12 text-muted-foreground/50 mb-4" />
        <p class="text-muted-foreground text-sm">
          {{ searchQuery ? t('settings.skills.noResults') : t('settings.skills.empty') }}
        </p>
        <p v-if="!searchQuery" class="text-muted-foreground/70 text-xs mt-1">
          {{ t('settings.skills.emptyHint') }}
        </p>
      </div>

      <!-- Grid layout -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
        <SkillCard
          v-for="skill in filteredSkills"
          :key="skill.name"
          :skill="skill"
          @edit="openEditor(skill)"
          @delete="confirmDelete(skill)"
        />
      </div>
    </ScrollArea>

    <!-- Footer -->
    <div
      class="shrink-0 px-4 py-3 border-t flex items-center justify-between text-sm text-muted-foreground"
    >
      <span>{{ t('settings.skills.count', { count: skillsStore.skillCount }) }}</span>
      <Button variant="link" size="sm" class="h-auto p-0" @click="openSkillsFolder">
        <Icon icon="lucide:folder-open" class="w-4 h-4 mr-1" />
        {{ t('settings.skills.openFolder') }}
      </Button>
    </div>

    <!-- Install dialog -->
    <SkillInstallDialog v-model:open="installDialogOpen" @installed="handleInstalled" />

    <!-- Sync dialog -->
    <SkillSyncDialog
      v-model:open="syncDialogOpen"
      :mode="syncMode"
      @completed="handleSyncCompleted"
    />

    <!-- Editor sheet -->
    <SkillEditorSheet v-model:open="editorOpen" :skill="editingSkill" @saved="handleSaved" />

    <!-- Delete confirmation -->
    <AlertDialog v-model:open="deleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('settings.skills.delete.title') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('settings.skills.delete.description', { name: deletingSkill?.name }) }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            @click="handleDelete"
          >
            {{ t('common.delete') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Separator } from '@shadcn/components/ui/separator'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'
import { useToast } from '@/components/use-toast'
import { useSkillsStore } from '@/stores/skillsStore'
import type { SkillMetadata } from '@shared/types/skill'

import SkillsHeader from './SkillsHeader.vue'
import SkillCard from './SkillCard.vue'
import SkillInstallDialog from './SkillInstallDialog.vue'
import SkillEditorSheet from './SkillEditorSheet.vue'
import { SkillSyncDialog } from './SkillSyncDialog'

const { t } = useI18n()
const { toast } = useToast()
const skillsStore = useSkillsStore()

const { skills, loading } = storeToRefs(skillsStore)

// Search
const searchQuery = ref('')
const filteredSkills = computed(() => {
  if (!searchQuery.value) return skills.value
  const query = searchQuery.value.toLowerCase()
  return skills.value.filter(
    (skill) =>
      skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
  )
})

// Install dialog
const installDialogOpen = ref(false)

// Sync dialog
const syncDialogOpen = ref(false)
const syncMode = ref<'import' | 'export'>('import')

const openSyncDialog = (mode: 'import' | 'export') => {
  syncMode.value = mode
  syncDialogOpen.value = true
}

// Editor
const editorOpen = ref(false)
const editingSkill = ref<SkillMetadata | null>(null)

// Delete dialog
const deleteDialogOpen = ref(false)
const deletingSkill = ref<SkillMetadata | null>(null)

// Event handling
const eventCleanup = ref<(() => void) | null>(null)

onMounted(async () => {
  await skillsStore.loadSkills()
  setupEventListeners()
})

onUnmounted(() => {
  if (eventCleanup.value) {
    eventCleanup.value()
  }
})

const setupEventListeners = () => {
  const handleSkillEvent = () => {
    skillsStore.loadSkills()
  }

  window.electron?.ipcRenderer?.on('skill:installed', handleSkillEvent)
  window.electron?.ipcRenderer?.on('skill:uninstalled', handleSkillEvent)
  window.electron?.ipcRenderer?.on('skill:metadata-updated', handleSkillEvent)

  eventCleanup.value = () => {
    window.electron?.ipcRenderer?.removeListener('skill:installed', handleSkillEvent)
    window.electron?.ipcRenderer?.removeListener('skill:uninstalled', handleSkillEvent)
    window.electron?.ipcRenderer?.removeListener('skill:metadata-updated', handleSkillEvent)
  }
}

const openSkillsFolder = async () => {
  await skillsStore.openSkillsFolder()
}

const openEditor = (skill: SkillMetadata) => {
  editingSkill.value = skill
  editorOpen.value = true
}

const confirmDelete = (skill: SkillMetadata) => {
  deletingSkill.value = skill
  deleteDialogOpen.value = true
}

const handleDelete = async () => {
  if (!deletingSkill.value) return

  const name = deletingSkill.value.name
  const result = await skillsStore.uninstallSkill(name)

  if (result.success) {
    toast({
      title: t('settings.skills.delete.success'),
      description: t('settings.skills.delete.successMessage', { name })
    })
  } else {
    toast({
      title: t('settings.skills.delete.failed'),
      description: result.error,
      variant: 'destructive'
    })
  }

  deleteDialogOpen.value = false
  deletingSkill.value = null
}

const handleInstalled = () => {
  skillsStore.loadSkills()
}

const handleSaved = () => {
  skillsStore.loadSkills()
}

const handleSyncCompleted = () => {
  skillsStore.loadSkills()
}
</script>
