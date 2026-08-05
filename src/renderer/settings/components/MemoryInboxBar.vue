<template>
  <section v-if="visible" class="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <Icon icon="lucide:inbox" class="h-4 w-4 text-amber-600" />
          <h2 class="text-sm font-semibold">{{ t('settings.memory.redesign.inboxTitle') }}</h2>
          <DcBadge v-if="conflictCount > 0" variant="destructive" class="text-[10px]">
            {{ t('settings.memory.redesign.conflictBadge', { count: conflictCount }) }}
          </DcBadge>
          <DcBadge v-if="draftCount > 0" variant="secondary" class="text-[10px]">
            {{ t('settings.memory.redesign.personaDraftBadge', { count: draftCount }) }}
          </DcBadge>
          <DcBadge v-if="directiveDraftCount > 0" variant="secondary" class="text-[10px]">
            {{
              t('settings.memory.redesign.directiveDraftBadge', {
                count: directiveDraftCount
              })
            }}
          </DcBadge>
        </div>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ t('settings.memory.redesign.inboxDescription') }}
        </p>
      </div>
      <DcButton variant="ghost" size="sm" class="h-8 text-xs" :disabled="loading" @click="refresh">
        <Icon icon="lucide:refresh-cw" class="mr-1.5 h-3.5 w-3.5" />
        {{ t('settings.memory.redesign.refresh') }}
      </DcButton>
    </div>

    <MemoryInlineFeedback
      v-if="feedback"
      class="mt-3"
      :feedback="feedback"
      @clear="clearFeedback"
    />

    <div v-if="loading" class="mt-3 py-4 text-center text-xs text-muted-foreground">
      {{ t('common.loading') }}
    </div>

    <div v-else class="mt-3 space-y-3">
      <section v-if="conflicts.length > 0" class="space-y-2">
        <div class="text-xs font-medium">
          {{ t('settings.memory.redesign.conflictSectionTitle', { count: conflicts.length }) }}
        </div>
        <article
          v-for="conflict in conflicts"
          :key="conflict.challenger.id"
          class="rounded-lg border border-border bg-background p-3"
        >
          <div class="grid gap-2 md:grid-cols-2">
            <div class="rounded-md bg-muted/60 p-2">
              <div class="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                {{ t('settings.memory.redesign.conflictExisting') }}
              </div>
              <p class="wrap-break-word text-xs">{{ conflict.target.content }}</p>
            </div>
            <div class="rounded-md bg-muted/60 p-2">
              <div class="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                {{ t('settings.memory.redesign.conflictNew') }}
              </div>
              <p class="wrap-break-word text-xs">{{ conflict.challenger.content }}</p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap justify-end gap-2">
            <DcButton
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              :disabled="pendingConflictIds.has(conflict.challenger.id)"
              @click="resolveConflict(conflict.challenger.id, 'keep_target')"
            >
              {{ t('settings.deepchatAgents.memoryManager.keepTarget') }}
            </DcButton>
            <DcButton
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              :disabled="pendingConflictIds.has(conflict.challenger.id)"
              @click="resolveConflict(conflict.challenger.id, 'keep_challenger')"
            >
              {{ t('settings.deepchatAgents.memoryManager.keepChallenger') }}
            </DcButton>
            <DcButton
              size="sm"
              class="h-8 text-xs"
              :disabled="pendingConflictIds.has(conflict.challenger.id)"
              @click="resolveConflict(conflict.challenger.id, 'keep_both')"
            >
              {{ t('settings.deepchatAgents.memoryManager.keepBoth') }}
            </DcButton>
          </div>
        </article>
      </section>

      <section v-if="drafts.length > 0" class="space-y-2">
        <div class="text-xs font-medium">
          {{ t('settings.memory.redesign.personaDraftSectionTitle', { count: drafts.length }) }}
        </div>
        <article
          v-for="draft in drafts"
          :key="draft.id"
          class="rounded-lg border bg-background p-3"
          :class="draft.needsReview ? 'border-destructive/50' : 'border-border'"
        >
          <div
            v-if="draft.needsReview"
            class="mb-2 flex items-center gap-1.5 text-xs font-medium text-destructive"
          >
            <Icon icon="lucide:triangle-alert" class="h-3.5 w-3.5" />
            {{ t('settings.deepchatAgents.memoryManager.largeChange') }}
          </div>
          <div class="grid gap-2 md:grid-cols-2">
            <div>
              <div class="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                {{ t('settings.deepchatAgents.memoryManager.personaCurrent') }}
              </div>
              <p class="whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground">
                {{ activePersonaContent || t('settings.deepchatAgents.memoryManager.personaNone') }}
              </p>
            </div>
            <div>
              <div class="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                {{ t('settings.deepchatAgents.memoryManager.personaProposed') }}
              </div>
              <p class="whitespace-pre-wrap wrap-break-word text-xs">{{ draft.content }}</p>
            </div>
          </div>
          <div class="mt-3 flex justify-end gap-2">
            <DcButton
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              :disabled="pendingPersonaIds.has(draft.id)"
              @click="rejectDraft(draft.id)"
            >
              {{ t('settings.deepchatAgents.memoryManager.reject') }}
            </DcButton>
            <DcButton
              size="sm"
              class="h-8 text-xs"
              :disabled="pendingPersonaIds.has(draft.id)"
              @click="approveDraft(draft.id)"
            >
              {{ t('settings.deepchatAgents.memoryManager.approve') }}
            </DcButton>
          </div>
        </article>
      </section>

      <section v-if="directiveDrafts.length > 0" class="space-y-2">
        <div class="text-xs font-medium">
          {{
            t('settings.memory.redesign.directiveDraftSectionTitle', {
              count: directiveDrafts.length
            })
          }}
        </div>
        <article
          v-for="directive in directiveDrafts"
          :key="directive.id"
          class="rounded-lg border border-border bg-background p-3"
        >
          <div class="mb-2 flex flex-wrap items-center gap-1.5">
            <DcBadge variant="outline" class="text-[10px]">
              {{ t(`settings.memory.redesign.directiveKind.${directive.kind}`) }}
            </DcBadge>
            <span v-if="directive.topic" class="wrap-break-word text-[11px] text-muted-foreground">
              {{
                t('settings.memory.redesign.directiveTopicValue', {
                  topic: directive.topic
                })
              }}
            </span>
          </div>
          <p class="whitespace-pre-wrap wrap-break-word text-xs">{{ directive.content }}</p>
          <div class="mt-3 flex justify-end gap-2">
            <DcButton
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              :disabled="directivePendingIds.has(directive.id)"
              @click="rejectDirective(directive.id)"
            >
              {{ t('settings.deepchatAgents.memoryManager.reject') }}
            </DcButton>
            <DcButton
              size="sm"
              class="h-8 text-xs"
              :disabled="directivePendingIds.has(directive.id)"
              @click="approveDirective(directive.id)"
            >
              {{ t('settings.deepchatAgents.memoryManager.approve') }}
            </DcButton>
          </div>
        </article>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'
import { createMemoryClient } from '@api/MemoryClient'
import type { MemoryConflictItem, MemoryDirectiveItem, MemoryItem } from '@shared/contracts/routes'
import { AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT } from '@shared/types/agent-memory'
import MemoryInlineFeedback from './MemoryInlineFeedback.vue'
import {
  shouldReconcileMemoryCommandRejection,
  useMemoryInlineFeedback
} from '../lib/useMemoryInlineFeedback'

const props = defineProps<{
  agentId: string
  conflictCount: number
  draftCount: number
  directiveDraftCount: number
  refreshToken: number
}>()

const { t } = useI18n()
const memoryClient = createMemoryClient()
const panelFeedback = useMemoryInlineFeedback('MemoryInboxBar')
const feedback = panelFeedback.feedback
const clearFeedback = panelFeedback.clear

const loading = ref(false)
const conflicts = ref<MemoryConflictItem[]>([])
const drafts = ref<MemoryItem[]>([])
const versions = ref<MemoryItem[]>([])
const directiveDrafts = ref<MemoryDirectiveItem[]>([])
const pendingConflictIds = ref<ReadonlySet<string>>(new Set())
const pendingPersonaIds = ref<ReadonlySet<string>>(new Set())
const directivePendingIds = ref<ReadonlySet<string>>(new Set())
let requestId = 0
let loadedAgentId = ''
let directiveRevision = 0

const visible = computed(
  () =>
    props.conflictCount > 0 ||
    props.draftCount > 0 ||
    props.directiveDraftCount > 0 ||
    conflicts.value.length > 0 ||
    drafts.value.length > 0 ||
    directiveDrafts.value.length > 0
)

const activePersonaContent = computed<string | null>(() => {
  const active = versions.value.find(
    (version) =>
      version.personaState === 'active' ||
      (version.personaState == null && version.supersededBy === null)
  )
  return active?.content ?? null
})

async function load(): Promise<void> {
  const agentId = props.agentId
  if (!agentId || !visible.value) return
  if (loadedAgentId !== agentId) {
    loadedAgentId = agentId
    directiveRevision += 1
    conflicts.value = []
    drafts.value = []
    versions.value = []
    directiveDrafts.value = []
    pendingConflictIds.value = new Set()
    pendingPersonaIds.value = new Set()
    directivePendingIds.value = new Set()
  }
  const current = ++requestId
  const revision = directiveRevision
  loading.value = true
  try {
    const [memoryResult, directiveResult] = await Promise.allSettled([
      Promise.all([
        memoryClient.listConflicts(agentId),
        memoryClient.listPersonaDrafts(agentId),
        memoryClient.listPersonaVersions(agentId)
      ]),
      memoryClient.listDirectives(agentId, {
        statuses: ['draft'],
        limit: AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT
      })
    ])
    if (current !== requestId || props.agentId !== agentId) return

    let failed = false
    let failure: unknown
    if (memoryResult.status === 'fulfilled') {
      const [nextConflicts, nextDrafts, nextVersions] = memoryResult.value
      conflicts.value = nextConflicts
      drafts.value = nextDrafts
      versions.value = nextVersions
    } else {
      failed = true
      failure = memoryResult.reason
    }

    if (directiveResult.status === 'fulfilled') {
      if (revision === directiveRevision) directiveDrafts.value = directiveResult.value
    } else {
      if (!failed) failure = directiveResult.reason
      failed = true
    }

    if (failed) panelFeedback.fail(failure)
  } finally {
    if (current === requestId && props.agentId === agentId) loading.value = false
  }
}

function refresh(): void {
  clearFeedback()
  void load()
}

function setPending(target: typeof pendingConflictIds, id: string, pending: boolean): void {
  const next = new Set(target.value)
  if (pending) next.add(id)
  else next.delete(id)
  target.value = next
}

async function resolveConflict(
  challengerId: string,
  outcome: 'keep_target' | 'keep_challenger' | 'keep_both'
): Promise<void> {
  if (pendingConflictIds.value.has(challengerId)) return
  const agentId = props.agentId
  clearFeedback()
  setPending(pendingConflictIds, challengerId, true)
  let shouldReload = false
  try {
    // Main broadcasts memory.updated for this mutation, which bumps
    // refreshToken and reloads this panel; no need to also reload locally.
    const result = await memoryClient.resolveConflict(agentId, challengerId, outcome)
    if (props.agentId === agentId && result.action === 'rejected') {
      panelFeedback.rejectCommand(result.reason)
      shouldReload = shouldReconcileMemoryCommandRejection(result.reason)
    }
  } catch (error) {
    if (props.agentId === agentId) panelFeedback.fail(error)
  } finally {
    if (props.agentId === agentId) {
      setPending(pendingConflictIds, challengerId, false)
      if (shouldReload) void load()
    }
  }
}

async function approveDraft(draftId: string): Promise<void> {
  if (pendingPersonaIds.value.has(draftId)) return
  const agentId = props.agentId
  clearFeedback()
  setPending(pendingPersonaIds, draftId, true)
  let shouldReload = false
  try {
    const result = await memoryClient.approvePersonaDraft(agentId, draftId)
    if (props.agentId === agentId && result.action === 'rejected') {
      panelFeedback.rejectCommand(result.reason)
      shouldReload = shouldReconcileMemoryCommandRejection(result.reason)
    }
  } catch (error) {
    if (props.agentId === agentId) panelFeedback.fail(error)
  } finally {
    if (props.agentId === agentId) {
      setPending(pendingPersonaIds, draftId, false)
      if (shouldReload) void load()
    }
  }
}

async function rejectDraft(draftId: string): Promise<void> {
  if (pendingPersonaIds.value.has(draftId)) return
  const agentId = props.agentId
  clearFeedback()
  setPending(pendingPersonaIds, draftId, true)
  let shouldReload = false
  try {
    const result = await memoryClient.rejectPersonaDraft(agentId, draftId)
    if (props.agentId === agentId && result.action === 'rejected') {
      panelFeedback.rejectCommand(result.reason)
      shouldReload = shouldReconcileMemoryCommandRejection(result.reason)
    }
  } catch (error) {
    if (props.agentId === agentId) panelFeedback.fail(error)
  } finally {
    if (props.agentId === agentId) {
      setPending(pendingPersonaIds, draftId, false)
      if (shouldReload) void load()
    }
  }
}

function setDirectivePending(directiveId: string, pending: boolean): void {
  const next = new Set(directivePendingIds.value)
  if (pending) next.add(directiveId)
  else next.delete(directiveId)
  directivePendingIds.value = next
}

async function approveDirective(directiveId: string): Promise<void> {
  if (directivePendingIds.value.has(directiveId)) return
  const agentId = props.agentId
  directiveRevision += 1
  clearFeedback()
  setDirectivePending(directiveId, true)
  let shouldReload = false
  try {
    const result = await memoryClient.approveDirective(agentId, directiveId)
    if (props.agentId !== agentId) return
    if (result.action === 'rejected') {
      panelFeedback.rejectDirective(result.reason)
      shouldReload =
        result.reason !== 'capacity' && shouldReconcileMemoryCommandRejection(result.reason)
      return
    }
    directiveDrafts.value = directiveDrafts.value.filter(
      (directive) => directive.id !== directiveId
    )
  } catch (error) {
    if (props.agentId === agentId) {
      shouldReload = true
      panelFeedback.fail(error)
    }
  } finally {
    if (props.agentId === agentId) {
      directiveRevision += 1
      setDirectivePending(directiveId, false)
      if (shouldReload) void load()
    }
  }
}

async function rejectDirective(directiveId: string): Promise<void> {
  if (directivePendingIds.value.has(directiveId)) return
  const agentId = props.agentId
  directiveRevision += 1
  clearFeedback()
  setDirectivePending(directiveId, true)
  let shouldReload = false
  try {
    const result = await memoryClient.rejectDirective(agentId, directiveId)
    if (props.agentId !== agentId) return
    if (result.action === 'rejected') {
      panelFeedback.rejectDirective(result.reason)
      shouldReload =
        result.reason !== 'capacity' && shouldReconcileMemoryCommandRejection(result.reason)
      return
    }
    directiveDrafts.value = directiveDrafts.value.filter(
      (directive) => directive.id !== directiveId
    )
  } catch (error) {
    if (props.agentId === agentId) {
      shouldReload = true
      panelFeedback.fail(error)
    }
  } finally {
    if (props.agentId === agentId) {
      directiveRevision += 1
      setDirectivePending(directiveId, false)
      if (shouldReload) void load()
    }
  }
}

watch(
  () => props.agentId,
  () => clearFeedback()
)

watch(
  () => [props.agentId, props.refreshToken],
  () => void load(),
  { immediate: true }
)
</script>
