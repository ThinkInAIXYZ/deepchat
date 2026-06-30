<template>
  <SettingsPageShell
    :title="t('settings.skills.title')"
    :description="t('settings.skills.description')"
    :eyebrow="t('settings.controlCenter.groups.knowledge')"
    data-testid="settings-skills-page"
  >
    <template #actions>
      <div v-if="activeTab === 'library'" class="relative">
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
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button size="sm">
            <Icon icon="lucide:plus" class="w-4 h-4 mr-1" />
            {{ t('settings.skills.addSkill') }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
          <DropdownMenuItem @click="installDialogOpen = true">
            <Icon icon="lucide:folder-plus" class="mr-2 h-4 w-4" />
            {{ t('settings.skills.install.basicTitle') }}
          </DropdownMenuItem>
          <DropdownMenuItem @click="gitDialogOpen = true">
            <Icon icon="lucide:git-branch" class="mr-2 h-4 w-4" />
            {{ t('settings.skills.git.menuItem') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>

    <div ref="guideRootRef">
      <Separator class="my-4" />

      <Tabs v-model="activeTab" class="w-full">
        <TabsList class="grid w-full max-w-xl grid-cols-3">
          <TabsTrigger value="library">{{ t('settings.skills.tabs.library') }}</TabsTrigger>
          <TabsTrigger value="agents">{{ t('settings.skills.tabs.agents') }}</TabsTrigger>
          <TabsTrigger value="syncDirectory">
            {{ t('settings.skills.tabs.syncDirectory') }}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="library" class="mt-4">
          <div
            ref="skillsSyncRef"
            class="mb-4 rounded-lg border px-4 py-3 flex items-start justify-between gap-4"
          >
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

          <Separator class="mb-4" />

          <div v-if="loading || agentPolicyLoading" class="space-y-3 pb-4 animate-pulse">
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
              @toggle-disabled="toggleSkillDisabled(skill, $event)"
              @view="openSkillDetail(skill)"
              @install-to-agent="openInstallToAgent(skill)"
            />
          </div>
        </TabsContent>

        <TabsContent value="agents" class="mt-4">
          <SkillAgentsTab />
        </TabsContent>

        <TabsContent value="syncDirectory" class="mt-4">
          <SkillImportExportTab :skills="skills" @completed="handleSyncCompleted" />
        </TabsContent>
      </Tabs>
    </div>

    <!-- Install dialog -->
    <SkillInstallDialog v-model:open="installDialogOpen" @installed="handleInstalled" />

    <InstallFromGitDialog v-model:open="gitDialogOpen" @installed="handleInstalled" />

    <InstallSkillToAgentDialog
      v-model:open="installToAgentOpen"
      :skill="installingToAgentSkill"
      @completed="handleSyncCompleted"
    />

    <SkillDetailDialog
      v-model:open="detailDialogOpen"
      :name="skillDetail?.name ?? ''"
      :description="skillDetail?.description"
      :source-path="skillDetail?.sourcePath"
      :markdown="skillDetail?.markdown"
      :mutable="selectedDetailSkill?.mutable ?? false"
      :deepchat-disabled="selectedDetailSkill?.deepchatDisabled ?? false"
      :can-install-to-agent="Boolean(selectedDetailSkill)"
      :saving="detailSaving"
      @save="handleDetailSave"
      @toggle-disabled="handleDetailToggleDisabled"
      @install-to-agent="handleDetailInstallToAgent"
      @delete="handleDetailDelete"
    />
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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Icon } from '@iconify/vue'
import { Separator } from '@shadcn/components/ui/separator'
import { Switch } from '@shadcn/components/ui/switch'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { useToast } from '@/components/use-toast'
import { useSkillsStore } from '@/stores/skillsStore'
import { useAgentStore } from '@/stores/ui/agent'
import { useSessionStore } from '@/stores/ui/session'
import { createConfigClient } from '@api/ConfigClient'
import { createSkillClient } from '@api/SkillClient'
import { createWindowClient } from '@api/WindowClient'
import type { Agent, DeepChatAgentConfig } from '@shared/types/agent-interface'
import type { SkillExtensionConfig } from '@shared/types/skill'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'
import type { SkillDetail } from '@shared/types/skillSync'

import SkillCard from './SkillCard.vue'
import SkillAgentsTab from './SkillAgentsTab.vue'
import InstallFromGitDialog from './InstallFromGitDialog.vue'
import InstallSkillToAgentDialog from './InstallSkillToAgentDialog.vue'
import SkillImportExportTab from './SkillImportExportTab.vue'
import SkillInstallDialog from './SkillInstallDialog.vue'
import SkillDetailDialog from './SkillDetailDialog.vue'
import SettingsPageShell from '../control-center/SettingsPageShell.vue'
import GuidedOnboardingOverlay from '@/components/onboarding/GuidedOnboardingOverlay.vue'
import { useGuidedOnboardingStep } from '@/composables/useGuidedOnboardingStep'
import { continueGuidedOnboardingFromSettings } from '../../lib/guidedOnboardingSettings'

const props = withDefaults(
  defineProps<{
    scope?: 'global' | 'agent'
  }>(),
  {
    scope: 'global'
  }
)

const { t } = useI18n()
const { toast } = useToast()
const skillsStore = useSkillsStore()
const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const configClient = createConfigClient()
const skillClient = createSkillClient()
const windowClient = createWindowClient()
const guideRootRef = ref<HTMLElement | null>(null)
const skillsSyncRef = ref<HTMLElement | null>(null)
const skillsGuide = useGuidedOnboardingStep('skills')
const showSkillsGuide = computed(() => skillsGuide.showGuide.value && Boolean(skillsSyncRef.value))

const { skills, skillExtensions, skillScripts, loading } = storeToRefs(skillsStore)

// Search
const activeTab = ref('library')
const searchQuery = ref('')
const draftSuggestionsEnabled = ref(false)
const isAgentScope = computed(() => props.scope === 'agent')
const targetAgent = ref<Agent | null>(null)
const targetAgentConfig = ref<DeepChatAgentConfig>({})
const agentPolicyLoading = ref(false)
const agentPolicyRequestId = ref(0)

const normalizeList = (value: string[] | null | undefined): string[] =>
  Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right)
  )

const targetAgentId = computed(() => {
  const activeSessionAgentId = sessionStore.activeSession?.agentId?.trim()
  if (activeSessionAgentId) {
    return activeSessionAgentId
  }

  const selectedAgentId = agentStore.selectedAgentId?.trim()
  if (selectedAgentId) {
    return selectedAgentId
  }

  return 'deepchat'
})
const isDeepChatTarget = computed(() =>
  Boolean(targetAgent.value && targetAgent.value.type === 'deepchat')
)
const globallyAvailableSkillNames = computed(() =>
  normalizeList(skills.value.filter((skill) => !skill.deepchatDisabled).map((skill) => skill.name))
)
const agentEnabledSkillNames = computed(() => targetAgentConfig.value.enabledSkillNames)
const agentEnabledSkillSet = computed(() => {
  const enabledNames = agentEnabledSkillNames.value
  if (enabledNames === null || enabledNames === undefined) {
    return new Set(globallyAvailableSkillNames.value)
  }
  return new Set(normalizeList(enabledNames))
})
const agentScopedSkills = computed<UnifiedSkillItem[]>(() => {
  if (!isAgentScope.value) {
    return skills.value
  }

  return skills.value.map((skill) => ({
    ...skill,
    deepchatDisabled: skill.deepchatDisabled || !agentEnabledSkillSet.value.has(skill.name)
  }))
})
const filteredSkills = computed(() => {
  const sourceSkills = agentScopedSkills.value
  if (!searchQuery.value) return sourceSkills
  const query = searchQuery.value.toLowerCase()
  return sourceSkills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
  )
})

// Install dialog
const installDialogOpen = ref(false)
const gitDialogOpen = ref(false)
const installToAgentOpen = ref(false)
const installingToAgentSkill = ref<UnifiedSkillItem | null>(null)
const detailDialogOpen = ref(false)
const skillDetail = ref<SkillDetail | null>(null)
const selectedDetailSkill = ref<UnifiedSkillItem | null>(null)
const detailSaving = ref(false)

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
    windowClient
  })
}

const handleSkillsGuideBack = async () => {
  const state = await skillsGuide.activatePreviousStep()
  await continueGuidedOnboardingFromSettings({
    state,
    router,
    windowClient
  })
}

const handleSkillsGuideSkip = async () => {
  const state = await skillsGuide.skipStep()
  await continueGuidedOnboardingFromSettings({
    state,
    router,
    windowClient
  })
}

const handleSkillsGuideExpert = async () => {
  const state = await skillsGuide.forceComplete()
  await continueGuidedOnboardingFromSettings({
    state,
    router,
    windowClient
  })
}

// Event handling
const eventCleanup = ref<(() => void) | null>(null)

onMounted(async () => {
  const enabled = await configClient.getSkillDraftSuggestionsEnabled()
  draftSuggestionsEnabled.value = enabled ?? false
  await Promise.all([skillsStore.loadSkills(), loadAgentPolicy()])
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

  eventCleanup.value = skillClient.onCatalogChanged(handleSkillEvent)
}

watch(targetAgentId, () => {
  void loadAgentPolicy()
})

watch(agentScopedSkills, () => {
  const selectedSkillName = selectedDetailSkill.value?.name
  if (!selectedSkillName) {
    return
  }
  const nextSkill = agentScopedSkills.value.find((skill) => skill.name === selectedSkillName)
  if (nextSkill) {
    selectedDetailSkill.value = nextSkill
  }
})

const loadAgentPolicy = async () => {
  if (!isAgentScope.value) {
    agentPolicyRequestId.value += 1
    targetAgent.value = null
    targetAgentConfig.value = {}
    agentPolicyLoading.value = false
    return
  }

  const requestId = ++agentPolicyRequestId.value
  const requestedAgentId = targetAgentId.value
  agentPolicyLoading.value = true
  try {
    const agents = await configClient.listAgents({
      agentType: 'deepchat',
      ids: [requestedAgentId]
    })
    if (requestId !== agentPolicyRequestId.value || requestedAgentId !== targetAgentId.value) {
      return
    }

    const agent = agents[0] ?? null
    if (!agent) {
      targetAgent.value = null
      targetAgentConfig.value = {}
      return
    }

    const effectiveConfig = await configClient.resolveDeepChatAgentConfig(requestedAgentId)
    if (requestId !== agentPolicyRequestId.value || requestedAgentId !== targetAgentId.value) {
      return
    }

    targetAgent.value = agent
    targetAgentConfig.value = effectiveConfig ?? agent?.config ?? {}
  } catch (error) {
    if (requestId !== agentPolicyRequestId.value) {
      return
    }

    targetAgent.value = null
    targetAgentConfig.value = {}
    toast({
      title: t('settings.pluginsHub.agentScopeUnsupported'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    if (requestId === agentPolicyRequestId.value) {
      agentPolicyLoading.value = false
    }
  }
}

const buildNextAgentSkillNames = (skillName: string, disabled: boolean): string[] => {
  const currentPolicy = agentEnabledSkillNames.value
  const visibleSkillNames = globallyAvailableSkillNames.value
  const nextSet =
    currentPolicy === null || currentPolicy === undefined
      ? new Set(visibleSkillNames)
      : new Set(normalizeList(currentPolicy))

  if (disabled) {
    nextSet.delete(skillName)
  } else if (visibleSkillNames.includes(skillName)) {
    nextSet.add(skillName)
  }

  return normalizeList(Array.from(nextSet))
}

const updateAgentSkillPolicy = async (skill: UnifiedSkillItem, disabled: boolean) => {
  if (!targetAgent.value || !isDeepChatTarget.value) {
    toast({
      title: t('settings.pluginsHub.agentScopeUnsupported'),
      variant: 'destructive'
    })
    return false
  }

  try {
    const enabledSkillNames = buildNextAgentSkillNames(skill.name, disabled)
    const updatedAgent = await configClient.updateDeepChatAgent(targetAgent.value.id, {
      config: {
        enabledSkillNames
      }
    })
    targetAgent.value = updatedAgent ?? targetAgent.value
    targetAgentConfig.value = {
      ...targetAgentConfig.value,
      ...updatedAgent?.config,
      enabledSkillNames
    }
    await agentStore.refreshAgentsByIds('deepchat', [targetAgent.value.id])
    toast({
      title: disabled ? t('settings.skills.disable.success') : t('settings.skills.enable.success'),
      description: disabled
        ? t('settings.skills.disable.successMessage', { name: skill.name })
        : t('settings.skills.enable.successMessage', { name: skill.name })
    })
    return true
  } catch (error) {
    toast({
      title: disabled ? t('settings.skills.disable.failed') : t('settings.skills.enable.failed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
    return false
  }
}

const openSkillDetail = async (skill: UnifiedSkillItem) => {
  try {
    selectedDetailSkill.value =
      agentScopedSkills.value.find((item) => item.name === skill.name) ?? skill
    skillDetail.value = {
      name: skill.name,
      description: skill.description,
      sourcePath: skill.path,
      markdown: await skillClient.readSkillFile(skill.name),
      mutable: skill.mutable
    }
    detailDialogOpen.value = true
  } catch (cause) {
    toast({
      title: t('settings.skills.detail.failed'),
      description: cause instanceof Error ? cause.message : String(cause),
      variant: 'destructive'
    })
  }
}

const openInstallToAgent = (skill: UnifiedSkillItem) => {
  installingToAgentSkill.value = skill
  installToAgentOpen.value = true
}

const toggleSkillDisabled = async (skill: UnifiedSkillItem, disabled: boolean) => {
  if (isAgentScope.value) {
    return await updateAgentSkillPolicy(skill, disabled)
  }

  try {
    await skillsStore.setSkillDisabled(skill.name, disabled)
    toast({
      title: disabled ? t('settings.skills.disable.success') : t('settings.skills.enable.success'),
      description: disabled
        ? t('settings.skills.disable.successMessage', { name: skill.name })
        : t('settings.skills.enable.successMessage', { name: skill.name })
    })
    return true
  } catch (e) {
    toast({
      title: disabled ? t('settings.skills.disable.failed') : t('settings.skills.enable.failed'),
      description: e instanceof Error ? e.message : String(e),
      variant: 'destructive'
    })
    return false
  }
}

const createDefaultExtension = (): SkillExtensionConfig => ({
  version: 1,
  env: {},
  runtimePolicy: {
    python: 'auto',
    node: 'auto'
  },
  scriptOverrides: {}
})

const handleDetailSave = async (content: string) => {
  const skill = selectedDetailSkill.value
  if (!skill) return

  detailSaving.value = true
  try {
    const result = await skillsStore.saveSkillWithExtension(
      skill.name,
      content,
      skillExtensions.value[skill.name] ?? createDefaultExtension()
    )

    if (!result.success) {
      toast({
        title: t('settings.skills.edit.failed'),
        description: result.error,
        variant: 'destructive'
      })
      return
    }

    toast({
      title: t('settings.skills.edit.success')
    })
    detailDialogOpen.value = false
    skillDetail.value = null
    selectedDetailSkill.value = null
  } finally {
    detailSaving.value = false
  }
}

const handleDetailToggleDisabled = async (disabled: boolean) => {
  if (!selectedDetailSkill.value) return
  const success = await toggleSkillDisabled(selectedDetailSkill.value, disabled)
  if (success && selectedDetailSkill.value) {
    selectedDetailSkill.value = {
      ...selectedDetailSkill.value,
      deepchatDisabled: disabled
    }
  }
}

const handleDetailInstallToAgent = () => {
  if (!selectedDetailSkill.value) return
  openInstallToAgent(selectedDetailSkill.value)
  detailDialogOpen.value = false
}

const handleDetailDelete = async () => {
  if (!selectedDetailSkill.value) return

  const name = selectedDetailSkill.value.name
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

  detailDialogOpen.value = false
  skillDetail.value = null
  selectedDetailSkill.value = null
}

const handleInstalled = () => {
  skillsStore.loadSkills()
}

const handleDraftSuggestionsToggle = async (nextValue: boolean | string) => {
  const normalized = typeof nextValue === 'string' ? nextValue === 'true' : Boolean(nextValue)
  draftSuggestionsEnabled.value = normalized
  await configClient.setSkillDraftSuggestionsEnabled(normalized)
}

const handleSyncCompleted = () => {
  skillsStore.loadSkills()
}
</script>
