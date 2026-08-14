<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Input } from '@shadcn/components/ui/input'
import { Separator } from '@shadcn/components/ui/separator'
import { Skeleton } from '@shadcn/components/ui/skeleton'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Switch } from '@shadcn/components/ui/switch'
import { DcButton } from '@dc-ui/components/button'
import { DcEmpty } from '@dc-ui/components/empty'
import { createConfigClient } from '@api/ConfigClient'
import { createSkillClient } from '@api/SkillClient'
import type { Agent } from '@shared/types/agent-interface'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'
import type { SkillDetail } from '@shared/types/skillSync'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { useGuidedOnboardingStep } from '@/composables/useGuidedOnboardingStep'
import {
  persistGuidedOnboardingResumeIntent,
  requestGuidedOnboardingResume
} from '@/lib/onboardingResume'
import { resolveGuidedOnboardingStepTarget } from '@shared/guidedOnboarding'
import GuidedOnboardingOverlay from '@/components/onboarding/GuidedOnboardingOverlay.vue'
import ImportSkillsFromAgentDialog from './skills/ImportSkillsFromAgentDialog.vue'
import SkillCard from './skills/SkillCard.vue'
import SkillDetailDialog from './skills/SkillDetailDialog.vue'
import SkillImportExportTab from './skills/SkillImportExportTab.vue'

type SkillsView = 'skills' | 'syncDirectory'

const { t } = useI18n()
const router = useRouter()
const configClient = createConfigClient()
const skillClient = createSkillClient()

const agents = ref<Agent[]>([])
const skills = ref<UnifiedSkillItem[]>([])
const loading = ref(false)
const loadFailed = ref(false)
const operationPending = ref(false)
const syncOperationPending = ref(false)
const agentUpdatePendingId = ref<string | null>(null)
const activeView = ref<SkillsView>('skills')
const searchQuery = ref('')
const externalImportOpen = ref(false)
const detailDialogOpen = ref(false)
const selectedSkill = ref<UnifiedSkillItem | null>(null)
const skillDetail = ref<SkillDetail | null>(null)
const detailDialogRef = ref<InstanceType<typeof SkillDetailDialog> | null>(null)
let loadRequestId = 0
let detailRequestId = 0

const filteredSkills = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return skills.value
  return skills.value.filter(
    (skill) =>
      skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
  )
})

const enabledAgentNames = (skill: UnifiedSkillItem) => {
  const names = new Map(agents.value.map((agent) => [agent.id, agent.name] as const))
  return skill.assignedAgentIds.map((agentId) => names.get(agentId) ?? agentId)
}

const closeDetail = (open: boolean) => {
  detailDialogOpen.value = open
  if (!open) {
    detailRequestId += 1
    selectedSkill.value = null
    skillDetail.value = null
  }
}

const loadPage = async (silent = false) => {
  const requestId = ++loadRequestId
  if (!silent) loading.value = true
  try {
    const [nextSkills, nextAgents] = await Promise.all([
      skillClient.getAllSkills(),
      configClient.listAgents({ agentType: 'deepchat' })
    ])
    if (requestId !== loadRequestId) return

    skills.value = nextSkills
    agents.value = nextAgents.filter((agent) => (agent.agentType ?? agent.type) === 'deepchat')
    if (selectedSkill.value) {
      const refreshedSkill = nextSkills.find((skill) => skill.name === selectedSkill.value?.name)
      if (refreshedSkill) selectedSkill.value = refreshedSkill
      else detailDialogRef.value?.requestClose()
    }
    loadFailed.value = false
  } catch (error) {
    if (requestId !== loadRequestId) return
    if (!silent) loadFailed.value = true
    console.error('[SkillsPluginsPage] Failed to load Skills page', error)
  } finally {
    if (requestId === loadRequestId) loading.value = false
  }
}

const openSkill = async (skill: UnifiedSkillItem) => {
  const requestId = ++detailRequestId
  operationPending.value = true
  try {
    const markdown = await skillClient.readSkillFile(skill.name)
    if (requestId !== detailRequestId) return
    selectedSkill.value = skill
    skillDetail.value = {
      name: skill.name,
      description: skill.description,
      sourcePath: skill.path,
      markdown,
      mutable: skill.mutable
    }
    detailDialogOpen.value = true
  } catch (error) {
    console.error('[SkillsPluginsPage] Failed to read Skill', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.skills.detailLoadFailed',
      title: t('settings.skills.detail.failed'),
      description: t('common.error.requestFailed')
    })
  } finally {
    operationPending.value = false
  }
}

const saveSkill = async (content: string) => {
  const skill = selectedSkill.value
  if (!skill || operationPending.value) return
  operationPending.value = true
  try {
    const result = await skillClient.updateSkillFile(skill.name, content)
    if (!result.success) throw new Error(result.error)
    closeDetail(false)
    await loadPage(true)
  } catch (error) {
    console.error('[SkillsPluginsPage] Failed to save Skill', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.skills.saveFailed',
      title: t('settings.skills.edit.failed'),
      description: t('common.error.requestFailed')
    })
  } finally {
    operationPending.value = false
  }
}

const deleteSkill = async () => {
  const skill = selectedSkill.value
  if (!skill || operationPending.value) return
  let impactChanged = false
  operationPending.value = true
  try {
    const result = await skillClient.deleteSkill(skill.name, skill.assignedAgentIds)
    if (!result.success) {
      if (result.errorCode === 'stale_impact' && result.affectedAgentIds) {
        impactChanged = true
        selectedSkill.value = { ...skill, assignedAgentIds: result.affectedAgentIds }
      }
      throw new Error(result.error)
    }
    closeDetail(false)
    await loadPage(true)
  } catch (error) {
    console.error('[SkillsPluginsPage] Failed to delete Skill', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.skills.deleteFailed',
      title: t('settings.skills.delete.failed'),
      description: impactChanged
        ? t('settings.skills.impact.changed')
        : t('common.error.requestFailed')
    })
  } finally {
    operationPending.value = false
  }
}

const updateSkillAgent = async (agentId: string, enabled: boolean) => {
  const skill = selectedSkill.value
  if (!skill || operationPending.value || agentUpdatePendingId.value) return
  if (skill.assignedAgentIds.includes(agentId) === enabled) return

  agentUpdatePendingId.value = agentId
  const requestId = detailRequestId
  try {
    await skillClient.setSkillAssigned(skill.name, enabled, agentId)
    const currentSkill = skills.value.find((item) => item.name === skill.name) ?? skill
    const enabledAgentIds = new Set(currentSkill.assignedAgentIds)
    if (enabled) enabledAgentIds.add(agentId)
    else enabledAgentIds.delete(agentId)
    const updatedSkill = {
      ...currentSkill,
      assigned: enabledAgentIds.size > 0,
      assignedAgentIds: Array.from(enabledAgentIds)
    }
    skills.value = skills.value.map((item) => (item.name === skill.name ? updatedSkill : item))
    if (requestId === detailRequestId && selectedSkill.value?.name === skill.name) {
      selectedSkill.value = updatedSkill
    }
  } catch (error) {
    console.error('[SkillsPluginsPage] Failed to update enabled Agents', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.skills.agentUpdateFailed',
      title: t('settings.skills.detail.agentUpdateFailed'),
      description: t('common.error.requestFailed')
    })
  } finally {
    agentUpdatePendingId.value = null
  }
}

const eventCleanup = skillClient.onCatalogChanged(() => {
  void loadPage(true)
})

const draftSuggestionsEnabled = ref(false)
const draftSuggestionsLoaded = ref(false)
const draftSuggestionsFailed = ref(false)
const loadDraftSuggestions = async () => {
  try {
    draftSuggestionsEnabled.value = await configClient.getSkillDraftSuggestionsEnabled()
    draftSuggestionsLoaded.value = true
    draftSuggestionsFailed.value = false
  } catch {
    draftSuggestionsFailed.value = true
  }
}
const toggleDraftSuggestions = async (enabled: boolean | string) => {
  const next = enabled === true || enabled === 'true'
  try {
    draftSuggestionsEnabled.value = await configClient.setSkillDraftSuggestionsEnabled(next)
  } catch {
    await loadDraftSuggestions()
  }
}

const guideRootRef = ref<HTMLElement | null>(null)
const skillsGuideTargetRef = ref<HTMLElement | null>(null)
const skillsGuide = useGuidedOnboardingStep('skills')
const showSkillsGuide = computed(
  () =>
    activeView.value === 'skills' &&
    skillsGuide.showGuide.value &&
    Boolean(skillsGuideTargetRef.value)
)
const continueSkillsGuide = async (
  state: Awaited<ReturnType<typeof skillsGuide.completeStep>> | null | undefined
) => {
  const stepId = state?.status === 'completed' ? 'first-chat' : state?.currentStepId
  const target = resolveGuidedOnboardingStepTarget(stepId)

  if (target?.surface === 'plugins') {
    await router.push({ name: target.routeName })
    return
  }

  if (target?.surface === 'settings') {
    if (target.routeName === 'settings-mcp' && router.hasRoute('plugins-mcp')) {
      await router.push({ name: 'plugins-mcp' })
      return
    }
    persistGuidedOnboardingResumeIntent({ stepId: target.stepId, trigger: 'window-focus' })
    await configClient.openSettings({ routeName: target.routeName })
    return
  }

  if (target?.surface === 'chat') {
    persistGuidedOnboardingResumeIntent({ stepId: target.stepId, trigger: 'step-completed' })
    requestGuidedOnboardingResume('step-completed')
  }
}
const handleSkillsGuidePrimary = async () => {
  await continueSkillsGuide(await skillsGuide.completeStep())
}
const handleSkillsGuideBack = async () => {
  await continueSkillsGuide(await skillsGuide.activatePreviousStep())
}
const handleSkillsGuideSkip = async () => {
  await continueSkillsGuide(await skillsGuide.skipStep())
}
const handleSkillsGuideExpert = async () => {
  await continueSkillsGuide(await skillsGuide.forceComplete())
}

onMounted(() => {
  void Promise.all([loadPage(), loadDraftSuggestions()])
})
onUnmounted(() => {
  loadRequestId += 1
  detailRequestId += 1
  eventCleanup()
})
</script>

<template>
  <ScrollArea class="h-full w-full">
    <main
      data-testid="plugins-skills-page"
      class="mx-auto flex min-h-full w-full max-w-7xl min-w-0 flex-col gap-4 p-4 lg:p-6"
    >
      <header class="min-w-0">
        <h1 class="truncate text-xl font-semibold text-foreground">
          {{ t('settings.skills.title') }}
        </h1>
        <p class="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          {{ t('settings.skills.description') }}
        </p>
      </header>

      <div ref="guideRootRef">
        <template v-if="activeView === 'skills'">
          <div
            ref="skillsGuideTargetRef"
            data-testid="skills-draft-suggestions"
            class="mb-4 flex items-start justify-between gap-4 rounded-lg border px-4 py-3"
          >
            <div>
              <div class="text-sm font-medium">
                {{ t('settings.skills.draftSuggestions.title') }}
              </div>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ t('settings.skills.draftSuggestions.description') }}
              </p>
              <p v-if="draftSuggestionsFailed" class="mt-1 text-xs text-destructive">
                {{ t('common.error.requestFailed') }}
              </p>
            </div>
            <Switch
              :model-value="draftSuggestionsEnabled"
              :disabled="!draftSuggestionsLoaded"
              @update:model-value="toggleDraftSuggestions"
            />
          </div>

          <div class="flex min-w-0 flex-col gap-2 xl:flex-row xl:items-center">
            <div class="relative min-w-0 flex-1">
              <Icon
                icon="lucide:search"
                class="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                v-model="searchQuery"
                data-testid="skills-search"
                :placeholder="t('settings.skills.search')"
                class="h-8 w-full pl-8"
              />
            </div>

            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <DcButton
                data-testid="skills-sync-directory-action"
                variant="outline"
                size="sm"
                @click="activeView = 'syncDirectory'"
              >
                <Icon icon="lucide:folder-sync" class="mr-1 size-4" />
                {{ t('settings.skills.syncDirectory.action') }}
              </DcButton>

              <DcButton
                data-testid="skills-import-action"
                size="sm"
                :disabled="operationPending"
                @click="externalImportOpen = true"
              >
                <Icon icon="lucide:download" class="mr-1 size-4" />
                {{ t('settings.skills.agentImport.menuItem') }}
              </DcButton>
            </div>
          </div>
        </template>
        <DcButton
          v-else
          data-testid="skills-back-action"
          variant="outline"
          size="sm"
          :disabled="syncOperationPending"
          @click="activeView = 'skills'"
        >
          <Icon icon="lucide:arrow-left" class="mr-1 size-4" />
          {{ t('settings.skills.syncDirectory.back') }}
        </DcButton>

        <Separator class="my-4" />

        <SkillImportExportTab
          v-if="activeView === 'syncDirectory'"
          :skills="skills"
          @busy-change="syncOperationPending = $event"
        />

        <template v-else>
          <div v-if="loading" class="grid grid-cols-1 gap-4 pb-4 md:grid-cols-2">
            <div
              v-for="index in 4"
              :key="index"
              class="flex h-28 flex-col justify-center rounded-xl border border-border/70 bg-card px-5 py-4"
            >
              <Skeleton class="h-4 w-40" />
              <Skeleton class="mt-3 h-3 w-4/5" />
              <Skeleton class="mt-2 h-3 w-3/5" />
            </div>
          </div>

          <DcEmpty
            v-else-if="loadFailed"
            icon="lucide:circle-alert"
            :title="t('common.error.requestFailed')"
            class="border-0 py-8"
          >
            <DcButton variant="outline" size="sm" @click="loadPage()">
              {{ t('common.retry') }}
            </DcButton>
          </DcEmpty>

          <template v-else>
            <DcEmpty
              v-if="filteredSkills.length === 0"
              icon="lucide:wand-sparkles"
              :title="searchQuery ? t('settings.skills.noResults') : t('settings.skills.empty')"
              :description="searchQuery ? undefined : t('settings.skills.emptyHint')"
              class="border-0 py-8"
            />

            <div
              v-else
              data-testid="skills-grid"
              class="grid grid-cols-1 gap-4 pb-4 md:grid-cols-2"
            >
              <SkillCard
                v-for="skill in filteredSkills"
                :key="skill.name"
                :skill="skill"
                :disabled="operationPending"
                @view="openSkill(skill)"
              />
            </div>
          </template>
        </template>
      </div>

      <ImportSkillsFromAgentDialog
        v-model:open="externalImportOpen"
        :agents="agents"
        @imported="loadPage(true)"
      />
      <SkillDetailDialog
        ref="detailDialogRef"
        :open="detailDialogOpen"
        :name="skillDetail?.name ?? ''"
        :description="skillDetail?.description"
        :source-path="skillDetail?.sourcePath"
        :markdown="skillDetail?.markdown"
        :mutable="selectedSkill?.mutable ?? false"
        :agents="agents"
        :enabled-agent-ids="selectedSkill?.assignedAgentIds ?? []"
        :enabled-agent-names="selectedSkill ? enabledAgentNames(selectedSkill) : []"
        :agent-update-pending-id="agentUpdatePendingId"
        :saving="operationPending"
        @update:open="closeDetail"
        @enable-agent="updateSkillAgent($event, true)"
        @disable-agent="updateSkillAgent($event, false)"
        @save="saveSkill"
        @delete="deleteSkill"
      />
    </main>
  </ScrollArea>

  <GuidedOnboardingOverlay
    :visible="showSkillsGuide"
    :container-el="guideRootRef"
    :target-el="skillsGuideTargetRef"
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
