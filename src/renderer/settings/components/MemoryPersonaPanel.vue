<template>
  <section class="flex min-h-0 flex-1 flex-col gap-3">
    <div
      class="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"
      :class="personaEvolutionEnabled ? '' : 'opacity-80'"
    >
      {{
        personaEvolutionEnabled
          ? t('settings.deepchatAgents.memoryManager.personaEvolutionOnHint')
          : t('settings.deepchatAgents.memoryManager.personaEvolutionOffHint')
      }}
    </div>

    <MemoryInlineFeedback v-if="feedback" :feedback="feedback" @clear="clearFeedback" />

    <div v-if="loading" class="py-12 text-center text-sm text-muted-foreground">
      {{ t('common.loading') }}
    </div>
    <div
      v-else-if="timeline.length === 0"
      class="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground"
    >
      {{ t('settings.deepchatAgents.memoryManager.emptyPersona') }}
    </div>
    <ScrollArea v-else class="min-h-0 flex-1 pr-3">
      <ol class="space-y-2">
        <li
          v-for="version in timeline"
          :key="version.id"
          class="rounded-lg border px-3 py-2"
          :class="isActive(version) ? 'border-primary bg-primary/5' : 'border-border'"
        >
          <div class="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex flex-wrap items-center gap-1.5">
              <DcBadge :variant="isActive(version) ? 'default' : 'outline'" class="text-[10px]">
                {{
                  isActive(version)
                    ? t('settings.deepchatAgents.memoryManager.personaActive')
                    : formatRelativeTime(version.createdAt, locale)
                }}
              </DcBadge>
              <DcBadge v-if="version.isAnchor" variant="secondary" class="gap-1 text-[10px]">
                <Icon icon="lucide:lock" class="h-3 w-3" />
                {{ t('settings.deepchatAgents.memoryManager.anchored') }}
              </DcBadge>
            </div>
            <div class="flex flex-wrap items-center gap-1">
              <DcButton
                variant="ghost"
                size="sm"
                class="h-8 text-xs"
                :disabled="pendingIds.has(version.id)"
                @click="setAnchor(version.id, !version.isAnchor)"
              >
                <Icon
                  :icon="version.isAnchor ? 'lucide:lock-open' : 'lucide:lock'"
                  class="mr-1.5 h-3.5 w-3.5"
                />
                {{
                  version.isAnchor
                    ? t('settings.deepchatAgents.memoryManager.unanchor')
                    : t('settings.deepchatAgents.memoryManager.anchor')
                }}
              </DcButton>
              <DcButton
                v-if="!isActive(version)"
                variant="ghost"
                size="sm"
                class="h-8 text-xs"
                :disabled="pendingIds.has(version.id)"
                data-testid="memory-persona-rollback-trigger"
                @click="requestRollback(version)"
              >
                <Icon icon="lucide:rotate-ccw" class="mr-1.5 h-3.5 w-3.5" />
                {{ t('settings.deepchatAgents.memoryManager.rollback') }}
              </DcButton>
            </div>
          </div>
          <p class="whitespace-pre-wrap wrap-break-word text-sm text-muted-foreground">
            {{ version.content }}
          </p>
        </li>
      </ol>
    </ScrollArea>

    <DcConfirmDialog
      :open="rollbackDialogOpen"
      :title="t('settings.deepchatAgents.memoryManager.rollbackConfirmTitle')"
      :description="t('settings.deepchatAgents.memoryManager.rollbackConfirmBody')"
      :confirm-label="t('settings.deepchatAgents.memoryManager.rollback')"
      :busy="rollbackRequest.status === 'pending'"
      :confirm-attrs="{ 'data-testid': 'memory-persona-rollback-confirm' }"
      :cancel-attrs="{ 'data-testid': 'memory-persona-rollback-cancel' }"
      busy-data-testid="memory-persona-rollback-spinner"
      @update:open="handleRollbackDialogOpenChange"
      @confirm="confirmRollback"
    >
      <MemoryInlineFeedback
        v-if="rollbackFeedback"
        :feedback="rollbackFeedback"
        @clear="clearRollbackFeedback"
      />
    </DcConfirmDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { createMemoryClient } from '@api/MemoryClient'
import type { MemoryItem } from '@shared/contracts/routes'
import { formatRelativeTime } from './memoryRedesignUtils'
import MemoryInlineFeedback from './MemoryInlineFeedback.vue'
import {
  shouldReconcileMemoryCommandRejection,
  useMemoryInlineFeedback
} from '../lib/useMemoryInlineFeedback'

const props = defineProps<{
  agentId: string
  personaEvolutionEnabled: boolean
  refreshToken: number
}>()

const { t, locale } = useI18n()
const memoryClient = createMemoryClient()
const panelFeedback = useMemoryInlineFeedback('MemoryPersonaPanel')
const feedback = panelFeedback.feedback
const clearFeedback = panelFeedback.clear
const rollbackOperationFeedback = useMemoryInlineFeedback('MemoryPersonaPanel.rollback')
const rollbackFeedback = rollbackOperationFeedback.feedback
const clearRollbackFeedback = rollbackOperationFeedback.clear

const loading = ref(false)
const versions = ref<MemoryItem[]>([])
const pendingIds = ref<ReadonlySet<string>>(new Set())
type RollbackRequest =
  | { status: 'idle' }
  | { status: 'confirming'; target: MemoryItem }
  | { status: 'pending'; target: MemoryItem; agentId: string }
const rollbackRequest = shallowRef<RollbackRequest>({ status: 'idle' })
let requestId = 0

const activeId = computed<string | null>(() => {
  const active = versions.value.find(
    (version) =>
      version.personaState === 'active' ||
      (version.personaState == null && version.supersededBy === null)
  )
  return active?.id ?? null
})

const timeline = computed(() =>
  versions.value.filter(
    (version) => version.personaState !== 'draft' && version.personaState !== 'rejected'
  )
)
const rollbackDialogOpen = computed(() => rollbackRequest.value.status !== 'idle')

function isActive(version: MemoryItem): boolean {
  return version.id === activeId.value
}

function setPending(versionId: string, pending: boolean): void {
  const next = new Set(pendingIds.value)
  if (pending) next.add(versionId)
  else next.delete(versionId)
  pendingIds.value = next
}

async function load(): Promise<void> {
  const agentId = props.agentId
  if (!agentId) return
  const current = ++requestId
  loading.value = true
  try {
    const next = await memoryClient.listPersonaVersions(agentId)
    if (current !== requestId || props.agentId !== agentId) return
    versions.value = next
  } catch (error) {
    if (current !== requestId || props.agentId !== agentId) return
    panelFeedback.fail(error)
  } finally {
    if (current === requestId && props.agentId === agentId) loading.value = false
  }
}

function requestRollback(version: MemoryItem): void {
  if (rollbackRequest.value.status !== 'idle' || pendingIds.value.has(version.id)) return
  clearRollbackFeedback()
  rollbackRequest.value = { status: 'confirming', target: version }
}

function handleRollbackDialogOpenChange(open: boolean): void {
  if (open || rollbackRequest.value.status !== 'confirming') return
  rollbackRequest.value = { status: 'idle' }
  clearRollbackFeedback()
}

async function confirmRollback(): Promise<void> {
  const request = rollbackRequest.value
  if (request.status !== 'confirming' || pendingIds.value.has(request.target.id)) return
  const pendingRequest = {
    status: 'pending' as const,
    target: request.target,
    agentId: props.agentId
  }
  rollbackRequest.value = pendingRequest
  clearRollbackFeedback()
  setPending(pendingRequest.target.id, true)
  let shouldReload = false
  try {
    const result = await memoryClient.rollbackPersona(
      pendingRequest.agentId,
      pendingRequest.target.id
    )
    if (props.agentId !== pendingRequest.agentId || rollbackRequest.value !== pendingRequest) {
      return
    }
    if (result.action === 'rejected') {
      if (shouldReconcileMemoryCommandRejection(result.reason)) {
        rollbackRequest.value = { status: 'idle' }
        panelFeedback.rejectCommand(result.reason)
        shouldReload = true
      } else {
        rollbackRequest.value = { status: 'confirming', target: pendingRequest.target }
        rollbackOperationFeedback.rejectCommand(result.reason)
      }
      return
    }
    // Main broadcasts memory.updated for applied mutations.
    rollbackRequest.value = { status: 'idle' }
  } catch (error) {
    if (props.agentId === pendingRequest.agentId && rollbackRequest.value === pendingRequest) {
      rollbackRequest.value = { status: 'confirming', target: pendingRequest.target }
      rollbackOperationFeedback.fail(error)
    }
  } finally {
    if (props.agentId === pendingRequest.agentId) {
      setPending(pendingRequest.target.id, false)
      if (shouldReload) void load()
    }
  }
}

async function setAnchor(versionId: string, anchored: boolean): Promise<void> {
  if (pendingIds.value.has(versionId)) return
  const agentId = props.agentId
  clearFeedback()
  setPending(versionId, true)
  let shouldReload = false
  try {
    const result = await memoryClient.setPersonaAnchor(agentId, versionId, anchored)
    if (props.agentId === agentId && result.action === 'rejected') {
      panelFeedback.rejectCommand(result.reason)
      shouldReload = shouldReconcileMemoryCommandRejection(result.reason)
    }
  } catch (error) {
    if (props.agentId === agentId) panelFeedback.fail(error)
  } finally {
    if (props.agentId === agentId) {
      setPending(versionId, false)
      if (shouldReload) void load()
    }
  }
}

watch(
  () => props.agentId,
  () => {
    clearFeedback()
    clearRollbackFeedback()
    rollbackRequest.value = { status: 'idle' }
    pendingIds.value = new Set()
  }
)

watch(
  () => [props.agentId, props.refreshToken],
  () => void load(),
  { immediate: true }
)
</script>
