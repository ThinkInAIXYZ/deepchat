<template>
  <SettingsPageShell
    :title="t('settings.skills.title')"
    :description="t('settings.skills.description')"
    :eyebrow="t('settings.controlCenter.groups.knowledge')"
    data-testid="settings-skills-page"
  >
    <template #actions>
      <div class="relative">
        <Icon
          icon="lucide:search"
          class="absolute left-2.5 top-1/2 w-4 h-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          :model-value="searchQuery"
          :placeholder="t('settings.skills.search')"
          class="h-8 w-48 pl-8"
          @update:model-value="searchQuery = String($event)"
        />
      </div>
      <Button variant="outline" size="sm" @click="openSyncDialog('export')">
        <Icon icon="lucide:upload" class="w-4 h-4 mr-1" />
        {{ t('settings.skills.sync.export') }}
      </Button>
      <Button size="sm" @click="installDialogOpen = true">
        <Icon icon="lucide:plus" class="w-4 h-4 mr-1" />
        {{ t('settings.skills.addSkill') }}
      </Button>
    </template>

    <div ref="guideRootRef">
      <Separator class="my-4" />

      <div class="mb-4 rounded-lg border px-4 py-3 flex items-start justify-between gap-4">
        <div class="space-y-1">
          <div class="text-sm font-medium">
            {{ t('settings.skills.draftSuggestions.title') }}
          </div>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.skills.draftSuggestions.description') }}
          </p>
        </div>
        <Switch
          :model-value="draftSuggestionsEnabled"
          @update:model-value="handleDraftSuggestionsToggle"
        />
      </div>

      <div ref="skillsSyncRef" class="mb-4" @click="handleSkillsGuideTargetInteract">
        <SyncStatusSection @import="handleQuickImport" @import-new="handleImportNew" />
      </div>

      <Separator class="mb-4" />

      <div v-if="loading" class="space-y-3 pb-4 animate-pulse">
        <div v-for="index in 4" :key="`skill-skeleton-${index}`" class="rounded-xl border p-4">
          <div class="space-y-3">
            <div class="h-4 w-40 rounded bg-muted/60"></div>
            <div class="h-3 w-full rounded bg-muted/40"></div>
            <div class="h-3 w-3/4 rounded bg-muted/30"></div>
          </div>
        </div>
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

      <div v-else class="flex flex-col gap-2 pb-4">
        <SkillCard
          v-for="skill in filteredSkills"
          :key="skill.name"
          :skill="skill"
          :extension="skillExtensions[skill.name]"
          :scripts="skillScripts[skill.name] || []"
          @edit="openEditor(skill)"
          @delete="confirmDelete(skill)"
        />
      </div>
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

    <!-- First-launch sync prompt -->
    <SyncPromptDialog @import="handlePromptImport" @close="handlePromptClose" />
  </SettingsPageShell>

  <GuidedOnboardingOverlay
    :visible="showSkillsGuide"
    :container-el="guideRootRef"
    :target-el="skillsSyncRef"
    :eyebrow="t('welcome.page.guide.title')"
    :title="t('welcome.page.guide.steps.skills')"
    :description="t('settings.skills.description')"
    :step-index="skillsGuide.stepIndex.value"
    :total-steps="skillsGuide.totalSteps.value"
    :close-label="t('common.close')"
    :back-label="skillsGuide.canGoPrevious?.value ? t('common.back') : undefined"
    :secondary-label="t('settings.skills.syncPrompt.skip')"
    :expert-label="t('settings.skills.sync.skipAll')"
    :primary-label="t('common.next')"
    @close="skillsGuide.dismissGuide"
    @back="handleSkillsGuideBack"
    @secondary="handleSkillsGuideSkip"
    @expert="handleSkillsGuideExpert"
    @primary="handleSkillsGuidePrimary"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Icon } from '@iconify/vue'
import { Separator } from '@shadcn/components/ui/separator'
import { Switch } from '@shadcn/components/ui/switch'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
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
import { useLegacyPresenter } from '@api/legacy/presenters'
import type { SkillMetadata } from '@shared/types/skill'

import SkillCard from './SkillCard.vue'
import SkillInstallDialog from './SkillInstallDialog.vue'
import SkillEditorSheet from './SkillEditorSheet.vue'
import SyncStatusSection from './SyncStatusSection.vue'
import SyncPromptDialog from './SyncPromptDialog.vue'
import { SkillSyncDialog } from './SkillSyncDialog'
import SettingsPageShell from '../control-center/SettingsPageShell.vue'
import GuidedOnboardingOverlay from '@/components/onboarding/GuidedOnboardingOverlay.vue'
import { useGuidedOnboardingStep } from '@/composables/useGuidedOnboardingStep'
import { continueGuidedOnboardingFromSettings } from '../../lib/guidedOnboardingSettings'

const { t } = useI18n()
const { toast } = useToast()
const skillsStore = useSkillsStore()
const configPresenter = useLegacyPresenter('configPresenter')
const windowPresenter = useLegacyPresenter('windowPresenter')
const guideRootRef = ref<HTMLElement | null>(null)
const skillsSyncRef = ref<HTMLElement | null>(null)
const skillsGuide = useGuidedOnboardingStep('skills')
const showSkillsGuide = computed(() => skillsGuide.showGuide.value && Boolean(skillsSyncRef.value))

const { skills, skillExtensions, skillScripts, loading } = storeToRefs(skillsStore)

// Search
const searchQuery = ref('')
const draftSuggestionsEnabled = ref(false)
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

const router = useRouter()

const handleSkillsGuidePrimary = async () => {
  if (skillsGuide.currentStepId.value !== 'skills') {
    return
  }

  const stepStatus = skillsGuide.stepState.value?.status
  if (stepStatus === 'completed' || stepStatus === 'skipped') {
    return
  }

  const state = await skillsGuide.completeStep()
  await continueGuidedOnboardingFromSettings({
    state,
    router,
    windowPresenter
  })
}

const handleSkillsGuideTargetInteract = async () => {
  await handleSkillsGuidePrimary()
}

const handleSkillsGuideBack = async () => {
  const state = await skillsGuide.activatePreviousStep()
  await continueGuidedOnboardingFromSettings({
    state,
    router,
    windowPresenter
  })
}

const handleSkillsGuideSkip = async () => {
  const state = await skillsGuide.skipStep()
  await continueGuidedOnboardingFromSettings({
    state,
    router,
    windowPresenter
  })
}

const handleSkillsGuideExpert = async () => {
  const state = await skillsGuide.forceComplete()
  await continueGuidedOnboardingFromSettings({
    state,
    router,
    windowPresenter
  })
}

// Event handling
const eventCleanup = ref<(() => void) | null>(null)

onMounted(async () => {
  const enabled = await configPresenter.getSkillDraftSuggestionsEnabled?.()
  draftSuggestionsEnabled.value = enabled ?? false
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

const handleDraftSuggestionsToggle = async (nextValue: boolean | string) => {
  const normalized = typeof nextValue === 'string' ? nextValue === 'true' : Boolean(nextValue)
  draftSuggestionsEnabled.value = normalized
  await configPresenter.setSkillDraftSuggestionsEnabled?.(normalized)
}

const handleSaved = () => {
  skillsStore.loadSkills()
}

const handleSyncCompleted = () => {
  skillsStore.loadSkills()
}

const handleQuickImport = (_toolId: string, _skills: string[]) => {
  // Open sync dialog in import mode with the specified tool preselected
  syncMode.value = 'import'
  syncDialogOpen.value = true
  // Note: The SkillSyncDialog will need to handle the preselected tool
  // For now, we just open it in import mode
}

const handleImportNew = () => {
  // Open sync dialog in import mode for new discoveries
  syncMode.value = 'import'
  syncDialogOpen.value = true
}

const handlePromptImport = (_toolIds: string[]) => {
  // Open sync dialog in import mode
  syncMode.value = 'import'
  syncDialogOpen.value = true
}

const handlePromptClose = () => {
  // Dialog closed without action
}
</script>
