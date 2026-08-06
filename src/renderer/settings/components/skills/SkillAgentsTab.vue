<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="text-sm font-medium">{{ t('settings.skills.agents.title') }}</h3>
        <p class="text-xs text-muted-foreground">
          {{ t('settings.skills.agents.summary', { count: agents.length }) }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <DcButton
          variant="outline"
          size="sm"
          :disabled="loading || operationPending"
          @click="loadAgents"
        >
          <Spinner v-if="loading" data-icon="inline-start" />
          <Icon v-else icon="lucide:refresh-cw" data-icon="inline-start" />
          {{ t('settings.skills.agents.refresh') }}
        </DcButton>
      </div>
    </div>

    <div v-if="error" class="rounded-md border border-destructive/30 px-3 py-2 text-sm">
      <div class="font-medium text-destructive">{{ t('settings.skills.agents.loadFailed') }}</div>
      <div class="mt-1 text-xs text-muted-foreground">{{ t('common.error.requestFailed') }}</div>
    </div>

    <DcInlineError v-if="operationError" :error="operationError" class="mb-2" />

    <div v-if="loading && agents.length === 0" class="flex flex-col gap-2">
      <Skeleton v-for="index in 3" :key="index" class="h-10 rounded-md bg-muted/50" />
    </div>

    <Empty v-else-if="agents.length === 0" class="border-0 py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon icon="lucide:scan-search" />
        </EmptyMedia>
        <EmptyDescription>
          {{ t('settings.skills.agents.empty') }}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>

    <template v-else>
      <div class="flex flex-wrap gap-2">
        <DcButton
          v-for="agent in agents"
          :key="agent.id"
          type="button"
          variant="outline"
          class="h-12 min-w-48 justify-start gap-2"
          :class="{ 'border-primary bg-primary/5': agent.id === selectedAgentId }"
          :disabled="operationPending"
          @click="selectAgent(agent.id)"
        >
          <Icon :icon="getSkillAgentIcon(agent.id)" class="h-5 w-5 shrink-0" />
          <span class="min-w-0 flex-1 truncate text-left">{{ agent.name }}</span>
          <DcBadge variant="outline" class="ml-2 text-[11px]">
            {{ agent.skillsCount }}
          </DcBadge>
          <DcBadge v-if="agent.conflictCount" variant="outline" class="ml-1 text-[11px]">
            {{ t('settings.skills.agents.conflictCount', { count: agent.conflictCount }) }}
          </DcBadge>
        </DcButton>
      </div>

      <div v-if="selectedAgent" class="space-y-3">
        <div class="rounded-md border px-3 py-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h4 class="truncate text-sm font-medium">{{ selectedAgent.name }}</h4>
                <DcBadge variant="outline" :class="agentStatusClass(selectedAgent.status)">
                  {{ t(`settings.skills.agents.agentStatus.${selectedAgent.status}`) }}
                </DcBadge>
              </div>
              <p
                class="mt-1 truncate text-xs text-muted-foreground"
                :title="selectedAgent.skillsDir"
              >
                {{ selectedAgent.skillsDir }}
              </p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{{
              t('settings.skills.agents.counts.skills', { count: selectedAgent.skillsCount })
            }}</span>
            <span>{{
              t('settings.skills.agents.counts.linked', { count: selectedAgent.linkedCount })
            }}</span>
            <span>
              {{
                t('settings.skills.agents.counts.agentOwned', {
                  count: selectedAgent.agentOwnedCount
                })
              }}
            </span>
            <span>{{
              t('settings.skills.agents.counts.conflicts', { count: selectedAgent.conflictCount })
            }}</span>
            <span>{{
              t('settings.skills.agents.counts.broken', { count: selectedAgent.brokenLinkCount })
            }}</span>
          </div>
        </div>

        <Skeleton v-if="detailLoading" class="h-24 rounded-md bg-muted/50" />
        <AgentSkillTable
          v-else
          :agent="selectedAgent"
          :disabled="operationPending"
          @action="handleAgentSkillAction"
          @view-detail="openAgentSkillDetail"
        />
      </div>
    </template>

    <SkillDetailDialog
      v-model:open="detailDialogOpen"
      :name="skillDetail?.name ?? ''"
      :description="skillDetail?.description"
      :source-path="skillDetail?.sourcePath"
      :markdown="skillDetail?.markdown"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { nanoid } from 'nanoid'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@shadcn/components/ui/empty'
import { Skeleton } from '@shadcn/components/ui/skeleton'
import { Spinner } from '@shadcn/components/ui/spinner'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { useDcFormSubmit } from '@dc-ui/components/form'
import { createSkillSyncClient } from '@api/SkillSyncClient'
import type {
  AgentSkillItem,
  InstalledSkillAgent,
  InstalledSkillAgentDetail,
  SkillDetail
} from '@shared/types/skillSync'
import AgentSkillTable from './AgentSkillTable.vue'
import SkillDetailDialog from './SkillDetailDialog.vue'
import { getSkillAgentIcon } from './toolIcon'
import { settingsLeaveGuard } from '../../services/settingsLeaveGuard'

const { t } = useI18n()
const skillSyncClient = createSkillSyncClient()
const operationPending = ref(false)
const operationError = ref<string | null>(null)
const { run: runLinkAction } = useDcFormSubmit()
let operationGeneration = 0
let operationKind: 'read' | 'mutation' | null = null

const loading = ref(false)
const detailLoading = ref(false)
const error = ref(false)
const agents = ref<InstalledSkillAgent[]>([])
const selectedAgentId = ref<string | null>(null)
const selectedAgentDetail = ref<InstalledSkillAgentDetail | null>(null)
const detailDialogOpen = ref(false)
const skillDetail = ref<SkillDetail | null>(null)
let agentDetailRequestId = 0
let skillDetailRequestId = 0
let agentsRequestId = 0

const selectedAgent = computed(() => selectedAgentDetail.value)

const logFailure = (message: string, cause: unknown, context: Record<string, unknown> = {}) => {
  console.error(
    message,
    {
      ...context
    },
    cause
  )
}

const beginOperation = (kind: Exclude<typeof operationKind, null> = 'mutation'): number | null => {
  if (operationPending.value) return null
  const generation = ++operationGeneration
  operationKind = kind
  operationPending.value = true
  return generation
}

const isCurrentOperation = (generation: number) =>
  generation === operationGeneration && operationPending.value

const loadAgents = async () => {
  const requestId = ++agentsRequestId
  loading.value = true
  error.value = false
  try {
    const nextAgents = await skillSyncClient.scanAgents()
    if (requestId !== agentsRequestId) return
    agents.value = nextAgents
    const nextId =
      agents.value.find((agent) => agent.id === selectedAgentId.value)?.id ?? agents.value[0]?.id
    selectedAgentId.value = nextId ?? null
    if (nextId) {
      if (selectedAgentDetail.value?.id !== nextId) selectedAgentDetail.value = null
      await loadAgentDetail(nextId)
    } else {
      selectedAgentDetail.value = null
    }
  } catch (cause) {
    if (requestId !== agentsRequestId) return
    error.value = true
    logFailure('[SkillAgentsTab] Failed to scan Agents', cause)
  } finally {
    if (requestId === agentsRequestId) loading.value = false
  }
}

const loadAgentDetail = async (agentId: string) => {
  const requestId = ++agentDetailRequestId
  detailLoading.value = true
  error.value = false
  try {
    const detail = await skillSyncClient.getAgentDetail(agentId)
    if (requestId !== agentDetailRequestId || selectedAgentId.value !== agentId) return
    selectedAgentDetail.value = detail
  } catch (cause) {
    if (requestId !== agentDetailRequestId || selectedAgentId.value !== agentId) return
    error.value = true
    logFailure('[SkillAgentsTab] Failed to load Agent detail', cause, { agentId })
  } finally {
    if (requestId === agentDetailRequestId && selectedAgentId.value === agentId) {
      detailLoading.value = false
    }
  }
}

const selectAgent = async (agentId: string) => {
  skillDetailRequestId += 1
  detailDialogOpen.value = false
  skillDetail.value = null
  selectedAgentId.value = agentId
  selectedAgentDetail.value = null
  await loadAgentDetail(agentId)
}

const handleAgentSkillAction = async (skill: AgentSkillItem) => {
  if (skill.action === 'repair-link') {
    await executeAgentLinkAction(skill, 'repair')
    return
  }
  if (skill.action === 'remove-link') {
    await executeAgentLinkAction(skill, 'remove')
  }
}

const openAgentSkillDetail = async (skill: AgentSkillItem) => {
  const agentId = selectedAgentId.value
  if (!agentId || selectedAgent.value?.id !== agentId) return
  const operation = beginOperation('read')
  if (operation === null) return
  const requestId = ++skillDetailRequestId
  try {
    const detail = await skillSyncClient.getAgentSkillDetail(agentId, skill.name)
    if (
      !isCurrentOperation(operation) ||
      requestId !== skillDetailRequestId ||
      selectedAgentId.value !== agentId
    ) {
      return
    }
    skillDetail.value = detail
    notifyRenderer({
      kind: 'success',
      code: 'settings.skills.agentDetailLoaded',
      title: skill.name
    })
    operationPending.value = false
    detailDialogOpen.value = true
  } catch (cause) {
    if (
      !isCurrentOperation(operation) ||
      requestId !== skillDetailRequestId ||
      selectedAgentId.value !== agentId
    ) {
      return
    }
    logFailure('[SkillAgentsTab] Failed to load Agent skill detail', cause, {
      agentId,
      skillName: skill.name
    })
    notifyRenderer({
      kind: 'error',
      code: 'settings.skills.agentDetailLoadFailed',
      title: t('settings.skills.detail.failed'),
      description: t('common.error.requestFailed')
    })
    operationPending.value = false
  }
}

const handleLinkChanged = async () => {
  await loadAgents()
}

const executeAgentLinkAction = async (skill: AgentSkillItem, action: 'repair' | 'remove') => {
  const agentId = selectedAgent.value?.id
  if (!agentId) return
  const operation = beginOperation()
  if (operation === null) return
  operationError.value = null

  await runLinkAction(async () => {
    const result =
      action === 'repair'
        ? await skillSyncClient.repairAgentSkillLink({ agentId, skillName: skill.name })
        : await skillSyncClient.removeAgentSkillLink({ agentId, skillName: skill.name })
    if (!isCurrentOperation(operation) || selectedAgent.value?.id !== agentId) return
    if (!result.success) throw new Error('Agent link update was rejected')
    await handleLinkChanged()
    if (!isCurrentOperation(operation)) return
    operationPending.value = false
  }).catch((cause) => {
    if (!isCurrentOperation(operation)) return
    logFailure('[SkillAgentsTab] Failed to update Agent link', cause, {
      action,
      agentId,
      skillName: skill.name
    })
    operationError.value = t('settings.skills.agents.linkAction.failed')
    operationPending.value = false
  })
}

const agentStatusClass = (status: InstalledSkillAgent['status']) => {
  if (status === 'ready') {
    return 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300'
  }
  if (status === 'permission-denied') {
    return 'border-destructive/40 bg-destructive/10 text-destructive'
  }
  return ''
}

onMounted(loadAgents)

const leaveGuardLease = settingsLeaveGuard.register({
  id: `settings.skills.agentLinks:${nanoid(8)}`,
  onDiscard: () => undefined
})
const stopLeaveRiskSync = watch(
  operationPending,
  (pending) => {
    leaveGuardLease.setRisk(pending ? 'busy' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

onBeforeUnmount(() => {
  if (operationKind === 'read' && operationPending.value) {
    operationGeneration += 1
    operationPending.value = false
  }
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>
