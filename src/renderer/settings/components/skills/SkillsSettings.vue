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
      <DropdownMenu v-if="!isAgentScope || isDeepChatTarget">
        <DropdownMenuTrigger as-child>
          <Button size="sm">
            <Icon icon="lucide:plus" class="w-4 h-4 mr-1" />
            {{ t('settings.skills.addSkill') }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
          <DropdownMenuItem
            v-if="isAgentScope && isDeepChatTarget"
            data-testid="skills-import-from-agent"
            @click="agentImportOpen = true"
          >
            <Icon icon="lucide:copy-plus" class="mr-2 size-4" />
            {{ t('settings.skills.agentImport.menuItem') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator v-if="isAgentScope && isDeepChatTarget" />
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
        <TabsList v-if="!isAgentScope" class="grid w-full max-w-xl grid-cols-3">
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

          <div
            v-if="skillsLoading || agentPolicyLoading"
            class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,26rem),1fr))] gap-2 pb-4"
          >
            <div v-for="index in 4" :key="`skill-skeleton-${index}`" class="rounded-xl border p-4">
              <div class="flex flex-col gap-3">
                <Skeleton class="h-4 w-40 bg-muted/60" />
                <Skeleton class="h-3 w-full bg-muted/40" />
                <Skeleton class="h-3 w-3/4 bg-muted/30" />
              </div>
            </div>
          </div>

          <Empty v-else-if="scopedSkillsError" class="border-0 py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon icon="lucide:circle-alert" />
              </EmptyMedia>
              <EmptyTitle>{{ t('settings.skills.agents.loadFailed') }}</EmptyTitle>
              <EmptyDescription class="break-words">{{ scopedSkillsError }}</EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" size="sm" @click="loadSkills">
              <Icon icon="lucide:refresh-cw" class="size-4" />
              {{ t('common.retry') }}
            </Button>
          </Empty>

          <Empty v-else-if="filteredSkills.length === 0" class="border-0 py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon icon="lucide:wand-sparkles" />
              </EmptyMedia>
              <EmptyTitle class="text-sm font-normal text-muted-foreground">
                {{ searchQuery ? t('settings.skills.noResults') : t('settings.skills.empty') }}
              </EmptyTitle>
              <EmptyDescription v-if="!searchQuery">
                {{ t('settings.skills.emptyHint') }}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>

          <div
            v-else
            data-testid="skills-library-grid"
            class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,26rem),1fr))] gap-2 pb-4"
          >
            <SkillCard
              v-for="skill in filteredSkills"
              :key="skill.name"
              :skill="skill"
              :extension="displayedSkillExtensions[skill.name]"
              :scripts="displayedSkillScripts[skill.name] || []"
              @toggle-disabled="toggleSkillDisabled(skill, $event)"
              @view="openSkillDetail(skill)"
            />
          </div>
        </TabsContent>

        <TabsContent v-if="!isAgentScope" value="agents" class="mt-4">
          <SkillAgentsTab />
        </TabsContent>

        <TabsContent v-if="!isAgentScope" value="syncDirectory" class="mt-4">
          <SkillImportExportTab :skills="skills" @completed="handleSyncCompleted" />
        </TabsContent>
      </Tabs>
    </div>

    <!-- Install dialog -->
    <SkillInstallDialog
      v-model:open="installDialogOpen"
      :agent-id="isAgentScope ? targetAgentId : undefined"
      @installed="handleInstalled"
    />

    <InstallFromGitDialog
      v-model:open="gitDialogOpen"
      :agent-id="isAgentScope ? targetAgentId : undefined"
      @installed="handleInstalled"
    />

    <ImportSkillsFromAgentDialog
      v-model:open="agentImportOpen"
      :target-agent-id="targetAgentId"
      :target-agent-name="targetAgent?.name"
      @completed="handleAgentImportCompleted"
    />

    <SkillDetailDialog
      v-model:open="detailDialogOpen"
      :name="skillDetail?.name ?? ''"
      :description="skillDetail?.description"
      :source-path="skillDetail?.sourcePath"
      :markdown="skillDetail?.markdown"
      :mutable="selectedDetailSkill?.mutable ?? false"
      :deepchat-disabled="selectedDetailSkill?.deepchatDisabled ?? false"
      :saving="detailSaving"
      @save="handleDetailSave"
      @toggle-disabled="handleDetailToggleDisabled"
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@shadcn/components/ui/empty'
import { Skeleton } from '@shadcn/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { useToast } from '@/components/use-toast'
import { useSkillsStore } from '@/stores/skillsStore'
import { useAgentStore } from '@/stores/ui/agent'
import { useSessionStore } from '@/stores/ui/session'
import { createConfigClient } from '@api/ConfigClient'
import { createSkillClient } from '@api/SkillClient'
import { createWindowClient } from '@api/WindowClient'
import type { Agent } from '@shared/types/agent-interface'
import type { SkillExtensionConfig, SkillScriptDescriptor } from '@shared/types/skill'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'
import type { SkillDetail } from '@shared/types/skillSync'

import SkillCard from './SkillCard.vue'
import SkillAgentsTab from './SkillAgentsTab.vue'
import InstallFromGitDialog from './InstallFromGitDialog.vue'
import ImportSkillsFromAgentDialog from './ImportSkillsFromAgentDialog.vue'
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

const { skills: globalSkills, skillExtensions, skillScripts, loading } = storeToRefs(skillsStore)
const scopedSkills = ref<UnifiedSkillItem[]>([])
const scopedSkillExtensions = ref<Record<string, SkillExtensionConfig>>({})
const scopedSkillScripts = ref<Record<string, SkillScriptDescriptor[]>>({})
const scopedSkillsLoading = ref(false)
const scopedSkillsError = ref('')

// Search
const activeTab = ref('library')
const searchQuery = ref('')
const draftSuggestionsEnabled = ref(false)
const isAgentScope = computed(() => props.scope === 'agent')
const targetAgent = ref<Agent | null>(null)
const agentPolicyLoading = ref(false)
const agentPolicyRequestId = ref(0)
const scopedSkillsRequestId = ref(0)

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
const skills = computed(() => (isAgentScope.value ? scopedSkills.value : globalSkills.value))
const displayedSkillExtensions = computed(() =>
  isAgentScope.value ? scopedSkillExtensions.value : skillExtensions.value
)
const displayedSkillScripts = computed(() =>
  isAgentScope.value ? scopedSkillScripts.value : skillScripts.value
)
const skillsLoading = computed(() =>
  isAgentScope.value ? scopedSkillsLoading.value : loading.value
)
const agentScopedSkills = computed<UnifiedSkillItem[]>(() => skills.value)
const filteredSkills = computed(() => {
  const sourceSkills = skills.value
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
const agentImportOpen = ref(false)
const detailDialogOpen = ref(false)
const skillDetail = ref<SkillDetail | null>(null)
const selectedDetailSkill = ref<UnifiedSkillItem | null>(null)
const detailSaving = ref(false)
const detailRequestId = ref(0)
const detailMutationRequestId = ref(0)

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
  await Promise.all([loadSkills(), loadAgentPolicy()])
  setupEventListeners()
})

onUnmounted(() => {
  if (eventCleanup.value) {
    eventCleanup.value()
  }
})

const setupEventListeners = () => {
  const handleSkillEvent = (payload: { agentIds?: string[] }) => {
    // The Pinia store owns the built-in catalog refresh. This page only owns
    // the separately loaded Agent-scoped catalog.
    if (!isAgentScope.value) return
    const affectedAgentId = isAgentScope.value ? targetAgentId.value : 'deepchat'
    if (payload.agentIds?.length && !payload.agentIds.includes(affectedAgentId)) {
      return
    }
    void loadSkills()
  }

  eventCleanup.value = skillClient.onCatalogChanged(handleSkillEvent)
}

watch(targetAgentId, () => {
  detailRequestId.value += 1
  detailMutationRequestId.value += 1
  targetAgent.value = null
  installDialogOpen.value = false
  gitDialogOpen.value = false
  agentImportOpen.value = false
  detailDialogOpen.value = false
  skillDetail.value = null
  selectedDetailSkill.value = null
  detailSaving.value = false
  void Promise.all([loadAgentPolicy(), loadSkills()])
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

const loadSkills = async () => {
  if (!isAgentScope.value) {
    await skillsStore.loadSkills()
    return
  }
  const requestId = ++scopedSkillsRequestId.value
  const agentId = targetAgentId.value
  scopedSkills.value = []
  scopedSkillExtensions.value = {}
  scopedSkillScripts.value = {}
  scopedSkillsError.value = ''
  scopedSkillsLoading.value = true
  try {
    const nextSkills = await skillClient.getUnifiedSkillCatalog(agentId)
    const runtimeEntries = await Promise.all(
      nextSkills.map(async (skill) => {
        try {
          const [extension, scripts] = await Promise.all([
            skillClient.getSkillExtension(skill.name, agentId),
            skillClient.listSkillScripts(skill.name, agentId)
          ])
          return [skill.name, extension ?? createDefaultExtension(), scripts ?? []] as const
        } catch (error) {
          console.error(`[SkillsSettings] Failed to load runtime data for ${skill.name}:`, error)
          return [skill.name, createDefaultExtension(), [] as SkillScriptDescriptor[]] as const
        }
      })
    )
    if (requestId !== scopedSkillsRequestId.value || agentId !== targetAgentId.value) return

    scopedSkills.value = nextSkills
    scopedSkillExtensions.value = Object.fromEntries(
      runtimeEntries.map(([name, extension]) => [name, extension])
    )
    scopedSkillScripts.value = Object.fromEntries(
      runtimeEntries.map(([name, _extension, scripts]) => [name, scripts])
    )
  } catch (error) {
    if (requestId !== scopedSkillsRequestId.value || agentId !== targetAgentId.value) return
    scopedSkillsError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (requestId === scopedSkillsRequestId.value && agentId === targetAgentId.value) {
      scopedSkillsLoading.value = false
    }
  }
}

const loadAgentPolicy = async () => {
  if (!isAgentScope.value) {
    agentPolicyRequestId.value += 1
    targetAgent.value = null
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
      return
    }

    targetAgent.value = agent
  } catch (error) {
    if (requestId !== agentPolicyRequestId.value) {
      return
    }

    targetAgent.value = null
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

const updateAgentSkillPolicy = async (skill: UnifiedSkillItem, disabled: boolean) => {
  if (!targetAgent.value || !isDeepChatTarget.value) {
    toast({
      title: t('settings.pluginsHub.agentScopeUnsupported'),
      variant: 'destructive'
    })
    return false
  }

  const requestedAgentId = targetAgent.value.id
  try {
    await skillClient.setSkillDisabled(skill.name, disabled, requestedAgentId)
    if (requestedAgentId !== targetAgentId.value) return false
    toast({
      title: disabled ? t('settings.skills.disable.success') : t('settings.skills.enable.success'),
      description: disabled
        ? t('settings.skills.disable.successMessage', { name: skill.name })
        : t('settings.skills.enable.successMessage', { name: skill.name })
    })
    return true
  } catch (error) {
    if (requestedAgentId !== targetAgentId.value) return false
    toast({
      title: disabled ? t('settings.skills.disable.failed') : t('settings.skills.enable.failed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
    return false
  }
}

const openSkillDetail = async (skill: UnifiedSkillItem) => {
  const requestId = ++detailRequestId.value
  detailMutationRequestId.value += 1
  detailSaving.value = false
  const agentId = isAgentScope.value ? targetAgentId.value : undefined
  try {
    const markdown = await skillClient.readSkillFile(skill.name, agentId)
    if (
      requestId !== detailRequestId.value ||
      (isAgentScope.value && agentId !== targetAgentId.value)
    ) {
      return
    }

    const nextSelectedSkill =
      agentScopedSkills.value.find((item) => item.name === skill.name) ?? skill
    selectedDetailSkill.value = nextSelectedSkill
    skillDetail.value = {
      name: skill.name,
      description: skill.description,
      sourcePath: skill.path,
      markdown,
      mutable: skill.mutable
    }
    detailDialogOpen.value = true
  } catch (cause) {
    if (requestId !== detailRequestId.value) return
    toast({
      title: t('settings.skills.detail.failed'),
      description: cause instanceof Error ? cause.message : String(cause),
      variant: 'destructive'
    })
  }
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
  if (isAgentScope.value && (!targetAgent.value || !isDeepChatTarget.value)) {
    toast({ title: t('settings.pluginsHub.agentScopeUnsupported'), variant: 'destructive' })
    return
  }

  const requestId = ++detailMutationRequestId.value
  const agentId = isAgentScope.value ? targetAgentId.value : undefined
  const isCurrentRequest = () =>
    requestId === detailMutationRequestId.value &&
    selectedDetailSkill.value?.name === skill.name &&
    (!isAgentScope.value || agentId === targetAgentId.value)
  detailSaving.value = true
  try {
    const result = isAgentScope.value
      ? await skillClient.saveSkillWithExtension(
          skill.name,
          content,
          displayedSkillExtensions.value[skill.name] ?? createDefaultExtension(),
          agentId
        )
      : await skillsStore.saveSkillWithExtension(
          skill.name,
          content,
          skillExtensions.value[skill.name] ?? createDefaultExtension()
        )
    if (!isCurrentRequest()) return

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
  } catch (cause) {
    if (!isCurrentRequest()) return
    toast({
      title: t('settings.skills.edit.failed'),
      description: cause instanceof Error ? cause.message : String(cause),
      variant: 'destructive'
    })
  } finally {
    if (requestId === detailMutationRequestId.value) detailSaving.value = false
  }
}

const handleDetailToggleDisabled = async (disabled: boolean) => {
  const skill = selectedDetailSkill.value
  if (!skill) return
  const requestId = ++detailMutationRequestId.value
  const agentId = isAgentScope.value ? targetAgentId.value : undefined
  const success = await toggleSkillDisabled(skill, disabled)
  if (
    success &&
    requestId === detailMutationRequestId.value &&
    selectedDetailSkill.value?.name === skill.name &&
    (!isAgentScope.value || agentId === targetAgentId.value)
  ) {
    selectedDetailSkill.value = {
      ...selectedDetailSkill.value,
      deepchatDisabled: disabled
    }
  }
}

const handleDetailDelete = async () => {
  const skill = selectedDetailSkill.value
  if (!skill) return
  if (isAgentScope.value && (!targetAgent.value || !isDeepChatTarget.value)) {
    toast({ title: t('settings.pluginsHub.agentScopeUnsupported'), variant: 'destructive' })
    return
  }

  const requestId = ++detailMutationRequestId.value
  const agentId = isAgentScope.value ? targetAgentId.value : undefined
  const isCurrentRequest = () =>
    requestId === detailMutationRequestId.value &&
    selectedDetailSkill.value?.name === skill.name &&
    (!isAgentScope.value || agentId === targetAgentId.value)

  try {
    const result = isAgentScope.value
      ? await skillClient.uninstallSkill(skill.name, agentId)
      : await skillsStore.uninstallSkill(skill.name)
    if (!isCurrentRequest()) return

    if (!result.success) {
      toast({
        title: t('settings.skills.delete.failed'),
        description: result.error,
        variant: 'destructive'
      })
      return
    }

    toast({
      title: t('settings.skills.delete.success'),
      description: t('settings.skills.delete.successMessage', { name: skill.name })
    })
    detailDialogOpen.value = false
    skillDetail.value = null
    selectedDetailSkill.value = null
  } catch (cause) {
    if (!isCurrentRequest()) return
    toast({
      title: t('settings.skills.delete.failed'),
      description: cause instanceof Error ? cause.message : String(cause),
      variant: 'destructive'
    })
  }
}

const handleInstalled = () => {
  void loadSkills()
}

const handleDraftSuggestionsToggle = async (nextValue: boolean | string) => {
  const normalized = typeof nextValue === 'string' ? nextValue === 'true' : Boolean(nextValue)
  draftSuggestionsEnabled.value = normalized
  await configClient.setSkillDraftSuggestionsEnabled(normalized)
}

const handleSyncCompleted = () => {
  void loadSkills()
}

const handleAgentImportCompleted = (completedTargetAgentId: string) => {
  if (completedTargetAgentId !== targetAgentId.value) return
  void loadSkills()
}
</script>
