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
          <DcButton size="sm" :disabled="pageOperationPending">
            <Icon icon="lucide:plus" class="w-4 h-4 mr-1" />
            {{ t('settings.skills.addSkill') }}
          </DcButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
          <DcDropdownActionItem
            v-if="isAgentScope && isDeepChatTarget"
            data-testid="skills-import-from-agent"
            icon="lucide:copy-plus"
            :label="t('settings.skills.agentImport.menuItem')"
            @select="agentImportOpen = true"
          />
          <DropdownMenuSeparator v-if="isAgentScope && isDeepChatTarget" />
          <DcDropdownActionItem
            icon="lucide:folder-plus"
            :label="t('settings.skills.install.basicTitle')"
            @select="installDialogOpen = true"
          />
          <DcDropdownActionItem
            icon="lucide:git-branch"
            :label="t('settings.skills.git.menuItem')"
            @select="gitDialogOpen = true"
          />
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
              <div
                v-if="draftSuggestionsLoadFailed"
                class="flex items-center gap-2 text-xs text-destructive"
              >
                <span>{{ t('common.error.requestFailed') }}</span>
                <DcButton
                  variant="link"
                  size="sm"
                  class="h-auto px-0 text-xs"
                  :disabled="draftSuggestionsLoading || pageOperationPending"
                  @click="loadDraftSuggestions"
                >
                  {{ t('common.retry') }}
                </DcButton>
              </div>
            </div>
            <Switch
              :model-value="draftSuggestionsEnabled"
              :disabled="!draftSuggestionsLoaded || pageOperationPending"
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

          <Empty v-else-if="pageLoadFailed" class="border-0 py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon icon="lucide:circle-alert" />
              </EmptyMedia>
              <EmptyTitle>{{ t('settings.skills.agents.loadFailed') }}</EmptyTitle>
              <EmptyDescription>{{ t('common.error.requestFailed') }}</EmptyDescription>
            </EmptyHeader>
            <DcButton variant="outline" size="sm" @click="reloadPageData">
              <Icon icon="lucide:refresh-cw" class="size-4" />
              {{ t('common.retry') }}
            </DcButton>
          </Empty>

          <DcEmpty
            v-else-if="filteredSkills.length === 0"
            icon="lucide:wand-sparkles"
            :title="searchQuery ? t('settings.skills.noResults') : t('settings.skills.empty')"
            :description="searchQuery ? undefined : t('settings.skills.emptyHint')"
            class="border-0 py-8"
          />

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
              :disabled="pageOperationPending"
              @toggle-disabled="toggleSkillDisabled(skill, $event)"
              @view="openSkillDetail(skill)"
            />
          </div>
        </TabsContent>

        <TabsContent v-if="!isAgentScope" value="agents" class="mt-4">
          <SkillAgentsTab />
        </TabsContent>

        <TabsContent v-if="!isAgentScope" value="syncDirectory" class="mt-4">
          <SkillImportExportTab :skills="skills" />
        </TabsContent>
      </Tabs>
    </div>

    <!-- Install dialog -->
    <SkillInstallDialog
      v-model:open="installDialogOpen"
      :agent-id="isAgentScope ? targetAgentId : undefined"
    />

    <InstallFromGitDialog
      v-model:open="gitDialogOpen"
      :agent-id="isAgentScope ? targetAgentId : undefined"
    />

    <ImportSkillsFromAgentDialog
      v-model:open="agentImportOpen"
      :target-agent-id="targetAgentId"
      :target-agent-name="targetAgent?.name"
    />

    <SkillDetailDialog
      v-model:open="detailDialogOpen"
      :name="skillDetail?.name ?? ''"
      :description="skillDetail?.description"
      :source-path="skillDetail?.sourcePath"
      :markdown="skillDetail?.markdown"
      :mutable="selectedDetailSkill?.mutable ?? false"
      :deepchat-disabled="selectedDetailSkill?.deepchatDisabled ?? false"
      :saving="pageOperationPending"
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
import { nanoid } from 'nanoid'
import { Separator } from '@shadcn/components/ui/separator'
import { Switch } from '@shadcn/components/ui/switch'
import { DcButton } from '@dc-ui/components/button'
import { Input } from '@shadcn/components/ui/input'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@shadcn/components/ui/empty'
import { DcEmpty } from '@dc-ui/components/empty'
import { Skeleton } from '@shadcn/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { DcDropdownActionItem } from '@dc-ui/components/dropdown-action-item'
import { useSkillsStore } from '@/stores/skillsStore'
import { useAgentStore } from '@/stores/ui/agent'
import { useSessionStore } from '@/stores/ui/session'
import { createConfigClient } from '@api/ConfigClient'
import { createSkillClient } from '@api/SkillClient'
import { createWindowClient } from '@api/WindowClient'
import { skillsCatalogChangedEvent, type DeepchatEventPayload } from '@shared/contracts/events'
import type { Agent } from '@shared/types/agent-interface'
import type {
  SkillExtensionConfig,
  SkillMetadata,
  SkillScriptDescriptor
} from '@shared/types/skill'
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
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { continueGuidedOnboardingFromSettings } from '../../lib/guidedOnboardingSettings'
import { settingsLeaveGuard } from '../../services/settingsLeaveGuard'

const props = withDefaults(
  defineProps<{
    scope?: 'global' | 'agent'
  }>(),
  {
    scope: 'global'
  }
)

const { t } = useI18n()
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
let pageOperationGeneration = 0
const pageOperationPending = ref(false)
const pageOperationKind = ref<'read' | 'mutation' | null>(null)
type SkillCatalogChangedPayload = DeepchatEventPayload<typeof skillsCatalogChangedEvent.name>

const {
  skills: globalSkills,
  skillExtensions,
  skillScripts,
  loading,
  error: globalSkillsError
} = storeToRefs(skillsStore)
const scopedSkills = ref<UnifiedSkillItem[]>([])
const scopedSkillExtensions = ref<Record<string, SkillExtensionConfig>>({})
const scopedSkillScripts = ref<Record<string, SkillScriptDescriptor[]>>({})
const scopedSkillsLoading = ref(false)
const scopedSkillsError = ref(false)
const scopedExtensionRequestSequence = new Map<string, number>()

// Search
const activeTab = ref('library')
const searchQuery = ref('')
const draftSuggestionsEnabled = ref(false)
const draftSuggestionsLoaded = ref(false)
const draftSuggestionsLoadFailed = ref(false)
const draftSuggestionsLoading = ref(false)
let draftSuggestionsRequestId = 0
const isAgentScope = computed(() => props.scope === 'agent')
const targetAgent = ref<Agent | null>(null)
const agentPolicyLoading = ref(false)
const agentPolicyError = ref(false)
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
const surfaceScopeKey = computed(() =>
  isAgentScope.value ? `agent:${targetAgentId.value}` : 'global'
)
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
const pageLoadFailed = computed(
  () =>
    agentPolicyError.value ||
    (isAgentScope.value ? scopedSkillsError.value : Boolean(globalSkillsError.value))
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
const detailRequestId = ref(0)
const detailMutationRequestId = ref(0)

const router = useRouter()

const logFailure = (message: string, error: unknown, context: Record<string, unknown> = {}) => {
  console.error(
    message,
    {
      ...context
    },
    error
  )
}

const beginPageOperation = (
  kind: Exclude<typeof pageOperationKind.value, null> = 'mutation'
): number | null => {
  if (pageOperationPending.value) return null
  const generation = ++pageOperationGeneration
  pageOperationKind.value = kind
  pageOperationPending.value = true
  return generation
}

const isCurrentPageOperation = (generation: number) =>
  generation === pageOperationGeneration && pageOperationPending.value

const finishPageOperation = () => {
  pageOperationPending.value = false
}

const cancelPageReadOperation = () => {
  if (pageOperationPending.value && pageOperationKind.value === 'read') {
    pageOperationGeneration += 1
    pageOperationPending.value = false
    pageOperationKind.value = null
  }
}

const closeSkillDetail = () => {
  detailRequestId.value += 1
  detailMutationRequestId.value += 1
  detailDialogOpen.value = false
  skillDetail.value = null
  selectedDetailSkill.value = null
}

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

onMounted(() => {
  setupEventListeners()
  void Promise.all([loadDraftSuggestions(), loadSkills(), loadAgentPolicy()])
})

onUnmounted(() => {
  cancelPageReadOperation()
  if (eventCleanup.value) {
    eventCleanup.value()
  }
  leaveGuardLease.release()
})

const setupEventListeners = () => {
  const handleSkillEvent = (payload: SkillCatalogChangedPayload) => {
    // The Pinia store owns the built-in catalog refresh. This page only owns
    // the separately loaded Agent-scoped catalog.
    if (!isAgentScope.value) return
    if (payload.reason === 'sync-directory-updated') return
    const affectedAgentId = targetAgentId.value
    if (payload.agentIds?.length && !payload.agentIds.includes(affectedAgentId)) {
      return
    }
    if (
      payload.reason === 'metadata-updated' &&
      payload.skill &&
      applyScopedSkillMetadata(payload.skill)
    ) {
      if (payload.extensionChanged) {
        void refreshScopedSkillExtension(payload.skill.name, affectedAgentId)
      }
      return
    }
    if (
      payload.reason === 'disabled-updated' &&
      payload.name &&
      payload.disabled !== undefined &&
      applyScopedSkillDisabled(payload.name, payload.disabled)
    ) {
      return
    }
    if (payload.reason === 'uninstalled' && payload.name && removeScopedSkill(payload.name)) {
      return
    }
    void loadSkills()
  }

  eventCleanup.value = skillClient.onCatalogChanged(handleSkillEvent)
}

const applyScopedSkillMetadata = (metadata: SkillMetadata): boolean => {
  if (!scopedSkills.value.some((skill) => skill.name === metadata.name)) return false
  scopedSkills.value = scopedSkills.value.map((skill) =>
    skill.name === metadata.name
      ? {
          ...skill,
          description: metadata.description,
          path: metadata.path,
          skillRoot: metadata.skillRoot,
          category: metadata.category,
          platforms: metadata.platforms,
          metadata: metadata.metadata,
          allowedTools: metadata.allowedTools,
          ownerPluginId: metadata.ownerPluginId
        }
      : skill
  )
  return true
}

const applyScopedSkillDisabled = (name: string, disabled: boolean): boolean => {
  if (!scopedSkills.value.some((skill) => skill.name === name)) return false
  scopedSkills.value = scopedSkills.value.map((skill) =>
    skill.name === name ? { ...skill, disabled, deepchatDisabled: disabled } : skill
  )
  return true
}

const applyScopedSkillExtension = (name: string, extension: SkillExtensionConfig): boolean => {
  if (!scopedSkills.value.some((skill) => skill.name === name)) return false
  scopedSkillExtensions.value = {
    ...scopedSkillExtensions.value,
    [name]: extension
  }
  return true
}

const refreshScopedSkillExtension = async (name: string, agentId: string) => {
  const key = `${agentId}\u0000${name}`
  const requestSequence = (scopedExtensionRequestSequence.get(key) ?? 0) + 1
  scopedExtensionRequestSequence.set(key, requestSequence)
  try {
    const extension = await skillClient.getSkillExtension(name, agentId)
    if (
      scopedExtensionRequestSequence.get(key) !== requestSequence ||
      agentId !== targetAgentId.value
    ) {
      return
    }
    applyScopedSkillExtension(name, extension)
  } catch (error) {
    if (scopedExtensionRequestSequence.get(key) !== requestSequence) return
    logFailure('[SkillsSettings] Failed to refresh skill runtime config', error, {
      agentId,
      skillName: name
    })
  }
}

const removeScopedSkill = (name: string): boolean => {
  const containsSkill = scopedSkills.value.some((skill) => skill.name === name)
  if (!containsSkill && (scopedSkillsLoading.value || scopedSkillsError.value)) return false
  if (containsSkill) {
    scopedSkills.value = scopedSkills.value.filter((skill) => skill.name !== name)
  }
  const nextExtensions = { ...scopedSkillExtensions.value }
  const nextScripts = { ...scopedSkillScripts.value }
  delete nextExtensions[name]
  delete nextScripts[name]
  scopedSkillExtensions.value = nextExtensions
  scopedSkillScripts.value = nextScripts
  return true
}

watch(surfaceScopeKey, () => {
  cancelPageReadOperation()
  detailRequestId.value += 1
  detailMutationRequestId.value += 1
  targetAgent.value = null
  installDialogOpen.value = false
  gitDialogOpen.value = false
  agentImportOpen.value = false
  detailDialogOpen.value = false
  skillDetail.value = null
  selectedDetailSkill.value = null
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
  scopedSkillsError.value = false
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
          logFailure('[SkillsSettings] Failed to load runtime data', error, {
            skillName: skill.name
          })
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
    scopedSkillsError.value = true
    logFailure('[SkillsSettings] Failed to load Agent skill catalog', error, { agentId })
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
    agentPolicyError.value = false
    agentPolicyLoading.value = false
    return
  }

  const requestId = ++agentPolicyRequestId.value
  const requestedAgentId = targetAgentId.value
  agentPolicyError.value = false
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
      agentPolicyError.value = true
      return
    }

    targetAgent.value = agent
  } catch (error) {
    if (requestId !== agentPolicyRequestId.value) {
      return
    }

    targetAgent.value = null
    agentPolicyError.value = true
    logFailure('[SkillsSettings] Failed to load Agent policy', error, {
      agentId: requestedAgentId
    })
  } finally {
    if (requestId === agentPolicyRequestId.value) {
      agentPolicyLoading.value = false
    }
  }
}

const updateAgentSkillPolicy = async (skill: UnifiedSkillItem, disabled: boolean) => {
  if (!targetAgent.value || !isDeepChatTarget.value) {
    throw new Error('The selected Agent does not support DeepChat skill policy updates')
  }

  const requestedAgentId = targetAgent.value.id
  await skillClient.setSkillDisabled(skill.name, disabled, requestedAgentId)
  if (requestedAgentId !== targetAgentId.value) return false
  applyScopedSkillDisabled(skill.name, disabled)
  return true
}

const openSkillDetail = async (skill: UnifiedSkillItem) => {
  const operationGeneration = beginPageOperation('read')
  if (operationGeneration === null) return
  const requestId = ++detailRequestId.value
  detailMutationRequestId.value += 1
  const agentId = isAgentScope.value ? targetAgentId.value : undefined
  try {
    const markdown = await skillClient.readSkillFile(skill.name, agentId)
    if (
      !isCurrentPageOperation(operationGeneration) ||
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
    notifyRenderer({
      kind: 'success',
      code: 'settings.skills.detailLoaded',
      title: skill.name
    })
    finishPageOperation()
    detailDialogOpen.value = true
  } catch (cause) {
    if (!isCurrentPageOperation(operationGeneration) || requestId !== detailRequestId.value) return
    logFailure('[SkillsSettings] Failed to load skill detail', cause, { skillName: skill.name })
    notifyRenderer({
      kind: 'error',
      code: 'settings.skills.detailLoadFailed',
      title: t('settings.skills.detail.failed'),
      description: t('common.error.requestFailed')
    })
    finishPageOperation()
  }
}

const toggleSkillDisabled = async (skill: UnifiedSkillItem, disabled: boolean) => {
  const operationGeneration = beginPageOperation()
  if (operationGeneration === null) return false

  try {
    const updated = isAgentScope.value
      ? await updateAgentSkillPolicy(skill, disabled)
      : await skillsStore.setSkillDisabled(skill.name, disabled)
    if (!isCurrentPageOperation(operationGeneration)) return false
    notifyRenderer({
      kind: 'success',
      code: disabled ? 'settings.skills.disabled' : 'settings.skills.enabled',
      title: disabled ? t('settings.skills.disable.success') : t('settings.skills.enable.success'),
      description: disabled
        ? t('settings.skills.disable.successMessage', { name: skill.name })
        : t('settings.skills.enable.successMessage', { name: skill.name })
    })
    finishPageOperation()
    return updated !== false
  } catch (error) {
    if (!isCurrentPageOperation(operationGeneration)) return false
    logFailure('[SkillsSettings] Failed to update skill state', error, { skillName: skill.name })
    notifyRenderer({
      kind: 'error',
      code: disabled ? 'settings.skills.disableFailed' : 'settings.skills.enableFailed',
      title: disabled ? t('settings.skills.disable.failed') : t('settings.skills.enable.failed'),
      description: t('common.error.requestFailed')
    })
    finishPageOperation()
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
  const operationGeneration = beginPageOperation()
  if (operationGeneration === null) return
  if (isAgentScope.value && (!targetAgent.value || !isDeepChatTarget.value)) {
    notifyRenderer({
      kind: 'error',
      code: 'settings.skills.unsupportedAgent',
      title: t('settings.pluginsHub.agentScopeUnsupported')
    })
    finishPageOperation()
    return
  }

  const requestId = ++detailMutationRequestId.value
  const agentId = isAgentScope.value ? targetAgentId.value : undefined
  const isCurrentSurface = () =>
    requestId === detailMutationRequestId.value &&
    selectedDetailSkill.value?.name === skill.name &&
    (!isAgentScope.value || agentId === targetAgentId.value)
  try {
    const result = isAgentScope.value
      ? await skillClient.updateSkillFile(skill.name, content, agentId)
      : await skillsStore.updateSkillFile(skill.name, content)
    if (!isCurrentPageOperation(operationGeneration)) return

    if (!result.success) {
      console.error('[SkillsSettings] Skill save was rejected', {
        skillName: skill.name,
        errorCode: result.errorCode ?? 'UnknownError'
      })
      notifyRenderer({
        kind: 'error',
        code: 'settings.skills.saveFailed',
        title: t('settings.skills.edit.failed'),
        description: t('common.error.requestFailed')
      })
      finishPageOperation()
      return
    }

    // 成功反馈走编辑器关闭 + 列表刷新（按钮级反馈由 SkillDetailDialog 承担）
    finishPageOperation()
    if (isCurrentSurface()) closeSkillDetail()
  } catch (cause) {
    if (!isCurrentPageOperation(operationGeneration)) return
    logFailure('[SkillsSettings] Failed to save skill', cause, { skillName: skill.name })
    notifyRenderer({
      kind: 'error',
      code: 'settings.skills.saveFailed',
      title: t('settings.skills.edit.failed'),
      description: t('common.error.requestFailed')
    })
    finishPageOperation()
  }
}

const handleDetailToggleDisabled = async (disabled: boolean) => {
  const skill = selectedDetailSkill.value
  if (!skill) return
  const success = await toggleSkillDisabled(skill, disabled)
  if (success && selectedDetailSkill.value?.name === skill.name) {
    selectedDetailSkill.value = {
      ...selectedDetailSkill.value,
      deepchatDisabled: disabled
    }
  }
}

const handleDetailDelete = async () => {
  const skill = selectedDetailSkill.value
  if (!skill) return
  const operationGeneration = beginPageOperation()
  if (operationGeneration === null) return
  if (isAgentScope.value && (!targetAgent.value || !isDeepChatTarget.value)) {
    notifyRenderer({
      kind: 'error',
      code: 'settings.skills.unsupportedAgent',
      title: t('settings.pluginsHub.agentScopeUnsupported')
    })
    finishPageOperation()
    return
  }

  const requestId = ++detailMutationRequestId.value
  const agentId = isAgentScope.value ? targetAgentId.value : undefined
  const isCurrentSurface = () =>
    requestId === detailMutationRequestId.value &&
    selectedDetailSkill.value?.name === skill.name &&
    (!isAgentScope.value || agentId === targetAgentId.value)

  try {
    const result = isAgentScope.value
      ? await skillClient.uninstallSkill(skill.name, agentId)
      : await skillsStore.uninstallSkill(skill.name)
    if (!isCurrentPageOperation(operationGeneration)) return

    if (!result.success) {
      console.error('[SkillsSettings] Skill deletion was rejected', {
        skillName: skill.name,
        errorCode: result.errorCode ?? 'UnknownError'
      })
      notifyRenderer({
        kind: 'error',
        code: 'settings.skills.deleteFailed',
        title: t('settings.skills.delete.failed'),
        description: t('common.error.requestFailed')
      })
      finishPageOperation()
      return
    }

    notifyRenderer({
      kind: 'success',
      code: 'settings.skills.deleted',
      title: t('settings.skills.delete.success'),
      description: t('settings.skills.delete.successMessage', { name: skill.name })
    })
    finishPageOperation()
    if (isAgentScope.value && isCurrentSurface()) {
      removeScopedSkill(skill.name)
    }
    if (isCurrentSurface()) closeSkillDetail()
  } catch (cause) {
    if (!isCurrentPageOperation(operationGeneration)) return
    logFailure('[SkillsSettings] Failed to delete skill', cause, { skillName: skill.name })
    notifyRenderer({
      kind: 'error',
      code: 'settings.skills.deleteFailed',
      title: t('settings.skills.delete.failed'),
      description: t('common.error.requestFailed')
    })
    finishPageOperation()
  }
}

const loadDraftSuggestions = async () => {
  const requestId = ++draftSuggestionsRequestId
  draftSuggestionsLoading.value = true
  draftSuggestionsLoadFailed.value = false
  try {
    const enabled = await configClient.getSkillDraftSuggestionsEnabled()
    if (requestId !== draftSuggestionsRequestId) return
    draftSuggestionsEnabled.value = enabled ?? false
    draftSuggestionsLoaded.value = true
  } catch (error) {
    if (requestId !== draftSuggestionsRequestId) return
    draftSuggestionsLoaded.value = false
    draftSuggestionsLoadFailed.value = true
    logFailure('[SkillsSettings] Failed to load draft suggestion preference', error)
  } finally {
    if (requestId === draftSuggestionsRequestId) {
      draftSuggestionsLoading.value = false
    }
  }
}

const reloadPageData = async () => {
  await Promise.all([loadSkills(), loadAgentPolicy()])
}

const handleDraftSuggestionsToggle = async (nextValue: boolean | string) => {
  const normalized = typeof nextValue === 'string' ? nextValue === 'true' : Boolean(nextValue)
  const operationGeneration = beginPageOperation()
  if (operationGeneration === null) return
  try {
    await configClient.setSkillDraftSuggestionsEnabled(normalized)
    if (!isCurrentPageOperation(operationGeneration)) return
    draftSuggestionsEnabled.value = normalized
    draftSuggestionsLoaded.value = true
    draftSuggestionsLoadFailed.value = false
    notifyRenderer({
      kind: 'success',
      code: 'settings.skills.draftSuggestionsSaved',
      title: t('common.saved')
    })
    finishPageOperation()
  } catch (error) {
    if (!isCurrentPageOperation(operationGeneration)) return
    logFailure('[SkillsSettings] Failed to save draft suggestion preference', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.skills.draftSuggestionsSaveFailed',
      title: t('common.error.operationFailed')
    })
    finishPageOperation()
  }
}

const leaveGuardLease = settingsLeaveGuard.register({
  id: `settings.skills.operation:${nanoid(8)}`,
  onDiscard: () => undefined
})
watch(
  pageOperationPending,
  (pending) => {
    leaveGuardLease.setRisk(pending ? 'busy' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)
</script>
