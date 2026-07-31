<template>
  <section data-testid="workflow-panel">
    <button
      class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium"
      type="button"
      @click="emit('toggle')"
    >
      <Icon icon="lucide:git-fork" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span class="flex-1 truncate">{{ t('chat.workflow.title') }}</span>
      <span v-if="runs.length > 0" class="text-[11px] text-muted-foreground">
        {{ runs.length }}
      </span>
      <Icon
        :icon="props.expanded ? 'lucide:chevron-down' : 'lucide:chevron-right'"
        class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
      />
    </button>

    <div v-if="props.expanded" class="space-y-2 px-2 pb-3">
      <SavedWorkflowPanel
        v-if="props.savedWorkflowsEnabled"
        :session-id="props.sessionId"
        :invocation-request="props.savedInvocationRequest"
        @launched="handleSavedWorkflowLaunched"
        @consumed="emit('consumeSavedInvocation', $event)"
      />

      <div v-if="loadingRuns" class="rounded-md border border-dashed px-3 py-4 text-center">
        <Icon
          icon="lucide:loader-circle"
          class="mx-auto mb-2 h-4 w-4 animate-spin text-muted-foreground"
        />
        <p class="text-[11px] text-muted-foreground">{{ t('chat.workflow.loading') }}</p>
      </div>

      <div
        v-else-if="loadError"
        data-testid="workflow-load-error"
        class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
      >
        <p class="break-words text-[11px] text-destructive">{{ loadError }}</p>
        <Button variant="outline" size="sm" class="mt-2 h-7 text-xs" @click="refreshRuns">
          <Icon icon="lucide:refresh-cw" class="mr-1.5 h-3.5 w-3.5" />
          {{ t('common.retry') }}
        </Button>
      </div>

      <div
        v-else-if="runs.length === 0"
        data-testid="workflow-empty"
        class="rounded-md border border-dashed px-3 py-4 text-center"
      >
        <Icon icon="lucide:workflow" class="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
        <p class="text-xs font-medium">{{ t('chat.workflow.empty.title') }}</p>
        <p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {{ t('chat.workflow.empty.description') }}
        </p>
      </div>

      <template v-else>
        <div class="flex gap-1 overflow-x-auto pb-1" data-testid="workflow-run-list">
          <button
            v-for="run in runs"
            :key="run.id"
            class="min-w-36 max-w-52 shrink-0 rounded-md border px-2.5 py-2 text-left transition-colors"
            :class="
              selectedRunId === run.id
                ? 'border-primary/50 bg-primary/5'
                : 'border-border hover:bg-accent/60'
            "
            type="button"
            @click="selectRun(run.id)"
          >
            <span class="flex items-center gap-1.5">
              <span
                class="h-1.5 w-1.5 shrink-0 rounded-full"
                :class="statusDotClass(run.status)"
              ></span>
              <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ runTitle(run) }}</span>
            </span>
            <span
              class="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground"
            >
              <span>{{ statusLabel(run.status) }}</span>
              <span>{{ completedInvocationCount(run) }}/{{ totalInvocationCount(run) }}</span>
            </span>
          </button>
        </div>

        <div
          v-if="detailError"
          data-testid="workflow-detail-error"
          class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
        >
          <p class="break-words text-[11px] text-destructive">{{ detailError }}</p>
          <Button variant="outline" size="sm" class="mt-2 h-7 text-xs" @click="loadSelectedDetail">
            <Icon icon="lucide:refresh-cw" class="mr-1.5 h-3.5 w-3.5" />
            {{ t('common.retry') }}
          </Button>
        </div>

        <div
          v-if="loadingDetail && !detail"
          class="rounded-md border border-dashed px-3 py-4 text-center"
        >
          <Icon
            icon="lucide:loader-circle"
            class="mx-auto h-4 w-4 animate-spin text-muted-foreground"
          />
        </div>

        <div
          v-else-if="detail"
          data-testid="workflow-run-detail"
          class="space-y-3 rounded-lg border bg-background p-3"
        >
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <p class="min-w-0 truncate text-xs font-semibold">{{ runTitle(detail) }}</p>
                <span
                  class="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                  :class="statusBadgeClass(detail.status)"
                >
                  {{ statusLabel(detail.status) }}
                </span>
              </div>
              <p class="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                {{ detail.id }}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 shrink-0"
              :aria-label="t('chat.workflow.actions.refresh')"
              :disabled="loadingDetail"
              @click="loadSelectedDetail"
            >
              <Icon icon="lucide:refresh-cw" class="h-3.5 w-3.5" />
            </Button>
          </div>

          <div
            v-if="!isRuntimeCompatible"
            data-testid="workflow-incompatible"
            class="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300"
          >
            <div class="flex items-start gap-1.5">
              <Icon icon="lucide:triangle-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {{
                  t('chat.workflow.states.incompatible', {
                    version: detail.runtimeApiVersion,
                    current: WORKFLOW_RUNTIME_API_VERSION
                  })
                }}
              </span>
            </div>
          </div>

          <div
            v-if="isPartialResult"
            data-testid="workflow-partial-result"
            class="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-300"
          >
            {{ t('chat.workflow.states.partialResult') }}
          </div>

          <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
            <div>
              <dt class="text-muted-foreground">{{ t('chat.workflow.fields.duration') }}</dt>
              <dd class="mt-0.5 font-medium">{{ formatDuration(runDurationMs(detail)) }}</dd>
            </div>
            <div>
              <dt class="text-muted-foreground">{{ t('chat.workflow.fields.usage') }}</dt>
              <dd class="mt-0.5 truncate font-medium" :title="formatUsage(detail.usage)">
                {{ formatUsage(detail.usage) }}
              </dd>
            </div>
            <div v-if="detail.phase !== null" class="col-span-2">
              <dt class="text-muted-foreground">{{ t('chat.workflow.fields.phase') }}</dt>
              <dd class="mt-0.5 break-words font-medium">{{ formatPhase(detail.phase) }}</dd>
            </div>
            <div v-if="detail.budget" class="col-span-2">
              <dt class="text-muted-foreground">{{ t('chat.workflow.fields.budget') }}</dt>
              <dd class="mt-0.5 break-words font-medium">{{ formatBudget(detail.budget) }}</dd>
            </div>
          </dl>

          <div
            v-if="detail.interruptionReason || detail.cancellationReason || detail.error"
            class="rounded-md bg-muted/60 px-2.5 py-2 text-[11px]"
          >
            <p class="font-medium">{{ t('chat.workflow.fields.reason') }}</p>
            <p class="mt-1 break-words text-muted-foreground">
              {{
                detail.interruptionReason ||
                detail.cancellationReason ||
                detail.error?.message ||
                t('chat.workflow.states.unknownReason')
              }}
            </p>
          </div>

          <div class="flex flex-wrap gap-1.5">
            <Button
              v-if="canCancel"
              variant="outline"
              size="sm"
              class="h-7 text-xs"
              data-testid="workflow-cancel"
              :disabled="actionBusy"
              @click="cancelRun"
            >
              <Icon icon="lucide:square" class="mr-1.5 h-3.5 w-3.5" />
              {{ t('common.cancel') }}
            </Button>
            <Button
              v-if="canResume"
              variant="outline"
              size="sm"
              class="h-7 text-xs"
              data-testid="workflow-resume"
              :disabled="actionBusy"
              @click="resumeRun"
            >
              <Icon icon="lucide:play" class="mr-1.5 h-3.5 w-3.5" />
              {{ t('chat.workflow.actions.resume') }}
            </Button>
            <Button
              v-if="canSynthesize"
              variant="outline"
              size="sm"
              class="h-7 text-xs"
              data-testid="workflow-synthesize"
              :disabled="actionBusy"
              @click="synthesizeRun"
            >
              <Icon icon="lucide:message-circle-reply" class="mr-1.5 h-3.5 w-3.5" />
              {{ t('chat.workflow.actions.synthesize') }}
            </Button>
          </div>

          <p
            v-if="actionError"
            data-testid="workflow-action-error"
            class="break-words text-[11px] text-destructive"
          >
            {{ actionError }}
          </p>
          <p
            v-else-if="synthesisState"
            data-testid="workflow-synthesis-state"
            class="text-[11px] text-muted-foreground"
          >
            {{
              synthesisState === 'claimed'
                ? t('chat.workflow.states.synthesisStarted')
                : t('chat.workflow.states.synthesisQueued')
            }}
          </p>

          <div v-if="detail.resultPreview" class="rounded-md bg-muted/40 px-2.5 py-2">
            <div class="flex items-center justify-between gap-2">
              <p class="text-[11px] font-medium">{{ t('chat.workflow.fields.result') }}</p>
              <span v-if="detail.resultPreview.truncated" class="text-[10px] text-muted-foreground">
                {{ t('chat.workflow.states.previewTruncated') }}
              </span>
            </div>
            <pre
              class="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-muted-foreground"
              >{{ visibleResultPreview }}</pre
            >
          </div>

          <div>
            <div class="mb-2 flex items-center justify-between gap-2">
              <p class="text-[11px] font-semibold">{{ t('chat.workflow.invocations.title') }}</p>
              <span class="text-[10px] text-muted-foreground">
                {{ detail.invocations.length }}
              </span>
            </div>

            <div
              v-if="detail.invocations.length === 0 && detail.outline.nodes.length > 0"
              data-testid="workflow-static-outline"
              class="max-h-32 space-y-1 overflow-auto rounded-md border border-dashed px-2.5 py-2 text-[10px] text-muted-foreground"
            >
              <div class="mb-1 flex items-center gap-1">
                <Icon icon="lucide:route" class="h-3 w-3" />
                <span class="font-mono text-[9px]">{{ detail.outline.confidence }}</span>
              </div>
              <p
                v-for="node in detail.outline.nodes"
                :key="node.id"
                class="truncate font-mono text-[9px]"
                :title="formatWorkflowOutlineNode(node)"
              >
                {{ formatWorkflowOutlineNode(node) }}
              </p>
            </div>

            <div
              v-else-if="detail.invocations.length === 0"
              class="rounded-md border border-dashed px-3 py-3 text-center text-[11px] text-muted-foreground"
            >
              {{ t('chat.workflow.invocations.empty') }}
            </div>

            <div v-else class="space-y-3" data-testid="workflow-invocation-tree">
              <div v-for="group in invocationGroups" :key="group.key">
                <div
                  class="mb-1 flex items-center gap-2 text-[10px] font-medium text-muted-foreground"
                >
                  <span class="h-px flex-1 bg-border"></span>
                  <span>{{ group.label }}</span>
                  <span class="h-px flex-1 bg-border"></span>
                </div>

                <div class="space-y-1">
                  <article
                    v-for="invocation in group.invocations"
                    :key="invocation.id"
                    class="rounded-md border bg-muted/20 px-2.5 py-2"
                    :style="{ marginLeft: `${invocationDepth(invocation.callPath) * 8}px` }"
                  >
                    <div class="flex items-start gap-2">
                      <Icon
                        :icon="invocationStatusIcon(invocation.status)"
                        class="mt-0.5 h-3.5 w-3.5 shrink-0"
                        :class="invocationStatusClass(invocation.status)"
                      />
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-1">
                          <p class="min-w-0 flex-1 truncate text-[11px] font-medium">
                            {{ invocation.label || invocation.key }}
                          </p>
                          <span
                            v-if="invocation.attempt > 1"
                            class="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground"
                          >
                            {{
                              t('chat.workflow.invocations.attempt', {
                                attempt: invocation.attempt
                              })
                            }}
                          </span>
                          <span
                            v-if="invocation.effectState !== 'none'"
                            class="rounded px-1 py-0.5 text-[9px]"
                            :class="effectBadgeClass(invocation.effectState)"
                          >
                            {{ effectLabel(invocation.effectState) }}
                          </span>
                        </div>
                        <p class="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
                          {{ invocation.callPath }}
                        </p>
                        <p
                          v-if="invocation.error"
                          class="mt-1 line-clamp-2 text-[10px] text-destructive"
                        >
                          {{ invocation.error.message }}
                        </p>
                        <p
                          v-if="invocation.status === 'timed_out'"
                          class="mt-1 text-[10px] text-amber-700 dark:text-amber-300"
                        >
                          {{ t('chat.workflow.invocations.timedOut') }}
                        </p>

                        <div
                          v-if="
                            invocation.status === 'waiting_interaction' &&
                            invocation.waitingInteractions.length === 0
                          "
                          class="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300"
                        >
                          {{ t('chat.workflow.interactions.generic') }}
                        </div>

                        <div
                          v-for="interaction in invocation.waitingInteractions"
                          :key="`${interaction.messageId}:${interaction.toolCallId}`"
                          class="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300"
                        >
                          <p class="font-medium">
                            {{
                              interaction.kind === 'question'
                                ? t('chat.workflow.interactions.question')
                                : t('chat.workflow.interactions.permission')
                            }}
                            <span v-if="interaction.toolName"> · {{ interaction.toolName }}</span>
                          </p>
                          <p v-if="interaction.label" class="mt-0.5 line-clamp-2">
                            {{ interaction.label }}
                          </p>
                        </div>

                        <div class="mt-2 flex flex-wrap gap-1">
                          <Button
                            v-if="invocation.childSessionId"
                            variant="ghost"
                            size="sm"
                            class="h-6 px-2 text-[10px]"
                            :data-testid="`workflow-open-child-${invocation.id}`"
                            :disabled="actionBusy"
                            @click="openChild(invocation.childSessionId)"
                          >
                            <Icon icon="lucide:external-link" class="mr-1 h-3 w-3" />
                            {{ t('chat.workflow.actions.openChild') }}
                          </Button>
                          <template v-if="canRetryInvocation(invocation)">
                            <Button
                              variant="ghost"
                              size="sm"
                              class="h-6 px-2 text-[10px]"
                              :data-testid="`workflow-retry-${invocation.id}`"
                              :disabled="actionBusy"
                              @click="requestRetry(invocation, false)"
                            >
                              <Icon icon="lucide:rotate-ccw" class="mr-1 h-3 w-3" />
                              {{ t('common.retry') }}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              class="h-6 px-2 text-[10px]"
                              :data-testid="`workflow-retry-from-${invocation.id}`"
                              :disabled="actionBusy"
                              @click="requestRetry(invocation, true)"
                            >
                              <Icon icon="lucide:history" class="mr-1 h-3 w-3" />
                              {{ t('chat.workflow.actions.retryFromHere') }}
                            </Button>
                          </template>
                        </div>
                      </div>
                    </div>
                  </article>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>

  <AlertDialog
    :open="pendingRetry !== null"
    @update:open="(open) => !open && !actionBusy && (pendingRetry = null)"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t('chat.workflow.effectWarning.title') }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{
            pendingRetry?.fromHere
              ? t('chat.workflow.effectWarning.retryFromHere')
              : t('chat.workflow.effectWarning.retry')
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="actionBusy" @click="pendingRetry = null">
          {{ t('common.cancel') }}
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          :disabled="actionBusy"
          data-testid="workflow-effect-confirm"
          @click.capture="confirmRiskyRetry"
        >
          {{ t('chat.workflow.effectWarning.confirm') }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
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
import { createWorkflowClient } from '@api/WorkflowClient'
import type { JsonValue } from '@shared/contracts/common'
import type {
  WorkflowEffectState,
  WorkflowInvocationStatus,
  WorkflowRunStatus
} from '@shared/workflow/domain'
import type {
  WorkflowInvocationProjection,
  WorkflowRunDetail,
  WorkflowRunSummary
} from '@shared/workflow/projection'
import { WORKFLOW_RESULT_SYNTHESIS_MAX_BYTES } from '@shared/workflow/resultDelivery'
import { WORKFLOW_RUNTIME_API_VERSION } from '@shared/workflow/runtimeProtocol'
import type { WorkflowRunBudget } from '@shared/workflow/serviceContracts'
import { useSessionStore } from '@/stores/ui/session'
import type { SavedWorkflowInvocationRequest } from '@/stores/ui/sidepanel'
import { formatWorkflowOutlineNode } from '@/lib/workflowOutline'
import SavedWorkflowPanel from './SavedWorkflowPanel.vue'

const MAX_BUFFERED_INVOCATION_DELTAS = 256

const props = defineProps<{
  sessionId: string
  expanded: boolean
  selectedRunId?: string | null
  savedInvocationRequest?: SavedWorkflowInvocationRequest | null
  savedWorkflowsEnabled?: boolean
}>()

const emit = defineEmits<{
  toggle: []
  selectRun: [runId: string | null]
  consumeSavedInvocation: [requestId: number]
}>()

const { t } = useI18n()
const workflowClient = createWorkflowClient()
const sessionStore = useSessionStore()
const runs = shallowRef<WorkflowRunSummary[]>([])
const selectedRunId = ref<string | null>(props.selectedRunId?.trim() || null)
const detail = shallowRef<WorkflowRunDetail | null>(null)
const loadingRuns = ref(false)
const loadingDetail = ref(false)
const loadError = ref<string | null>(null)
const detailError = ref<string | null>(null)
const actionError = ref<string | null>(null)
const actionBusy = ref(false)
const synthesisState = ref<'pending' | 'claimed' | null>(null)
const pendingRetry = ref<{
  invocationId: string
  fromHere: boolean
} | null>(null)
const now = ref(Date.now())

let disposed = false
let sessionRequestId = 0
let detailRequestId = 0
let clockTimer: number | null = null
let stopRunChanged: (() => void) | null = null
let stopInvocationChanged: (() => void) | null = null
const pendingInvocationDeltas = new Map<string, WorkflowInvocationProjection>()

const isRuntimeCompatible = computed(
  () => detail.value?.runtimeApiVersion === WORKFLOW_RUNTIME_API_VERSION
)
const canCancel = computed(() => {
  const status = detail.value?.status
  return status === 'queued' || status === 'running' || status === 'waiting_interaction'
})
const canResume = computed(() => {
  const status = detail.value?.status
  return isRuntimeCompatible.value && (status === 'failed' || status === 'interrupted')
})
const canSynthesize = computed(() => {
  if (detail.value?.status !== 'succeeded' || synthesisState.value !== null) {
    return false
  }
  return (
    detail.value.resultPreview === null ||
    detail.value.resultPreview.byteLength <= WORKFLOW_RESULT_SYNTHESIS_MAX_BYTES
  )
})
const isPartialResult = computed(() => {
  const run = detail.value
  return Boolean(
    run &&
    (run.status === 'failed' || run.status === 'cancelled' || run.status === 'interrupted') &&
    run.invocationCounts.succeeded > 0
  )
})
const visibleResultPreview = computed(() => {
  const preview = detail.value?.resultPreview?.text ?? ''
  return preview.length > 4_096 ? `${preview.slice(0, 4_096)}…` : preview
})
const latestInvocationIds = computed(() => {
  const latest = new Map<string, WorkflowInvocationProjection>()
  for (const invocation of detail.value?.invocations ?? []) {
    const current = latest.get(invocation.callPath)
    if (!current || invocation.attempt > current.attempt) {
      latest.set(invocation.callPath, invocation)
    }
  }
  return new Set([...latest.values()].map((invocation) => invocation.id))
})
const invocationGroups = computed(() => {
  const groups: Array<{
    key: string
    label: string
    invocations: WorkflowInvocationProjection[]
  }> = []
  const byPhase = new Map<string, (typeof groups)[number]>()
  for (const invocation of [...(detail.value?.invocations ?? [])].sort(
    (left, right) => left.seq - right.seq || left.attempt - right.attempt
  )) {
    const key = invocation.phase?.trim() || '__default__'
    let group = byPhase.get(key)
    if (!group) {
      group = {
        key,
        label:
          key === '__default__'
            ? t('chat.workflow.invocations.defaultPhase')
            : invocation.phase || key,
        invocations: []
      }
      byPhase.set(key, group)
      groups.push(group)
    }
    group.invocations.push(invocation)
  }
  return groups
})

function mergeRuns(nextRuns: readonly WorkflowRunSummary[]): WorkflowRunSummary[] {
  const previous = new Map<string, WorkflowRunSummary>()
  for (const run of runs.value) {
    previous.set(run.id, run)
  }
  return [...nextRuns]
    .map((run) => {
      const current = previous.get(run.id)
      return current && current.revision >= run.revision ? current : run
    })
    .sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id))
}

async function refreshRuns(): Promise<void> {
  const requestId = ++sessionRequestId
  const sessionId = props.sessionId
  loadingRuns.value = true
  loadError.value = null
  actionError.value = null
  synthesisState.value = null
  try {
    const loaded = await workflowClient.list(sessionId, 100)
    if (disposed || requestId !== sessionRequestId || sessionId !== props.sessionId) {
      return
    }
    runs.value = mergeRuns(loaded)
    if (!selectedRunId.value && runs.value[0]) {
      setSelectedRunId(runs.value[0].id)
    }
    if (selectedRunId.value && props.expanded) {
      await loadDetail(selectedRunId.value, sessionId)
    } else if (!selectedRunId.value) {
      detail.value = null
    }
  } catch (error) {
    if (!disposed && requestId === sessionRequestId && sessionId === props.sessionId) {
      console.warn('[WorkflowPanel] Failed to list runs:', error)
      loadError.value = t('common.error.requestFailed')
    }
  } finally {
    if (!disposed && requestId === sessionRequestId && sessionId === props.sessionId) {
      loadingRuns.value = false
    }
  }
}

async function loadDetail(runId: string, sessionId = props.sessionId): Promise<void> {
  const requestId = ++detailRequestId
  loadingDetail.value = true
  detailError.value = null
  try {
    const loaded = await workflowClient.inspect(sessionId, runId)
    if (
      disposed ||
      requestId !== detailRequestId ||
      sessionId !== props.sessionId ||
      selectedRunId.value !== runId
    ) {
      return
    }
    const currentSummary = runs.value.find((candidate) => candidate.id === loaded.id)
    const requiresTerminalReload =
      currentSummary?.status === 'succeeded' &&
      currentSummary.revision > loaded.revision &&
      loaded.status !== 'succeeded'
    let merged =
      currentSummary && currentSummary.revision >= loaded.revision
        ? {
            ...loaded,
            ...currentSummary,
            invocationCounts: loaded.invocationCounts
          }
        : loaded
    for (const invocation of pendingInvocationDeltas.values()) {
      merged = mergeInvocationDelta(merged, invocation)
    }
    pendingInvocationDeltas.clear()
    detail.value = merged
    runs.value = [...runs.value.filter((candidate) => candidate.id !== loaded.id), merged].sort(
      (left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id)
    )
    if (requiresTerminalReload) {
      void loadDetail(runId, sessionId)
    }
  } catch (error) {
    if (
      !disposed &&
      requestId === detailRequestId &&
      sessionId === props.sessionId &&
      selectedRunId.value === runId
    ) {
      console.warn('[WorkflowPanel] Failed to inspect run:', error)
      detailError.value = t('common.error.requestFailed')
    }
  } finally {
    if (
      !disposed &&
      requestId === detailRequestId &&
      sessionId === props.sessionId &&
      selectedRunId.value === runId
    ) {
      loadingDetail.value = false
    }
  }
}

function loadSelectedDetail(): void {
  if (props.expanded && selectedRunId.value) {
    void loadDetail(selectedRunId.value)
  }
}

function selectRun(runId: string): void {
  if (selectedRunId.value === runId) {
    return
  }
  setSelectedRunId(runId)
  detail.value = null
  detailError.value = null
  actionError.value = null
  synthesisState.value = null
  pendingInvocationDeltas.clear()
  if (props.expanded) {
    void loadDetail(runId)
  }
}

function setSelectedRunId(runId: string | null, notify = true): void {
  const normalized = runId?.trim() || null
  if (selectedRunId.value === normalized) {
    return
  }
  selectedRunId.value = normalized
  if (notify) {
    emit('selectRun', normalized)
  }
}

function mergeInvocationDelta(
  currentDetail: WorkflowRunDetail,
  invocation: WorkflowInvocationProjection
): WorkflowRunDetail {
  if (invocation.runId !== currentDetail.id) {
    return currentDetail
  }
  const currentIndex = currentDetail.invocations.findIndex(
    (candidate) => candidate.id === invocation.id
  )
  const currentInvocation = currentIndex >= 0 ? currentDetail.invocations[currentIndex] : undefined
  if (currentInvocation && currentInvocation.updatedAt > invocation.updatedAt) {
    return currentDetail
  }

  const invocationCounts = { ...currentDetail.invocationCounts }
  if (!currentInvocation) {
    invocationCounts[invocation.status] += 1
  } else if (currentInvocation.status !== invocation.status) {
    invocationCounts[currentInvocation.status] = Math.max(
      0,
      invocationCounts[currentInvocation.status] - 1
    )
    invocationCounts[invocation.status] += 1
  }
  const invocations =
    currentIndex >= 0
      ? currentDetail.invocations.map((candidate, index) =>
          index === currentIndex ? invocation : candidate
        )
      : [...currentDetail.invocations, invocation]

  return {
    ...currentDetail,
    invocationCounts,
    invocations: invocations.sort(
      (left, right) => left.seq - right.seq || left.attempt - right.attempt
    )
  }
}

function bufferInvocationDelta(invocation: WorkflowInvocationProjection): void {
  const current = pendingInvocationDeltas.get(invocation.id)
  if (current && current.updatedAt > invocation.updatedAt) {
    return
  }
  if (!current && pendingInvocationDeltas.size >= MAX_BUFFERED_INVOCATION_DELTAS) {
    const oldestInvocationId = pendingInvocationDeltas.keys().next().value
    if (oldestInvocationId) {
      pendingInvocationDeltas.delete(oldestInvocationId)
    }
  }
  pendingInvocationDeltas.set(invocation.id, invocation)
}

function applyInvocationDelta(invocation: WorkflowInvocationProjection): void {
  if (invocation.runId !== selectedRunId.value) {
    return
  }
  if (loadingDetail.value || detail.value?.id !== invocation.runId) {
    bufferInvocationDelta(invocation)
  }
  if (detail.value?.id !== invocation.runId) {
    return
  }
  const merged = mergeInvocationDelta(detail.value, invocation)
  if (merged === detail.value) {
    return
  }
  detail.value = merged
  runs.value = runs.value.map((run) =>
    run.id === merged.id ? { ...run, invocationCounts: merged.invocationCounts } : run
  )
}

function upsertRun(run: WorkflowRunSummary): void {
  const index = runs.value.findIndex((candidate) => candidate.id === run.id)
  if (index >= 0 && runs.value[index].revision > run.revision) {
    return
  }
  const shouldRefreshSucceededDetail =
    props.expanded &&
    run.status === 'succeeded' &&
    detail.value?.id === run.id &&
    (detail.value.status !== 'succeeded' || detail.value.revision < run.revision)
  const next =
    index >= 0
      ? runs.value.map((candidate, i) => (i === index ? run : candidate))
      : [run, ...runs.value]
  runs.value = next.sort(
    (left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id)
  )
  if (detail.value?.id === run.id && detail.value.revision <= run.revision) {
    detail.value = {
      ...detail.value,
      ...run
    }
  }
  if (!selectedRunId.value) {
    setSelectedRunId(run.id)
    if (props.expanded) {
      void loadDetail(run.id)
    }
  } else if (shouldRefreshSucceededDetail) {
    void loadDetail(run.id)
  }
}

function handleSavedWorkflowLaunched(run: WorkflowRunSummary): void {
  upsertRun(run)
  setSelectedRunId(run.id)
  if (props.expanded) {
    void loadDetail(run.id)
  }
}

async function performRunAction(
  action: () => Promise<WorkflowRunSummary>,
  options?: { clearRetry?: boolean }
): Promise<void> {
  if (actionBusy.value) {
    return
  }
  actionBusy.value = true
  actionError.value = null
  synthesisState.value = null
  try {
    const updated = await action()
    upsertRun(updated)
    if (options?.clearRetry) {
      pendingRetry.value = null
    }
    if (props.expanded && selectedRunId.value === updated.id) {
      await loadDetail(updated.id)
    }
  } catch (error) {
    console.warn('[WorkflowPanel] Run action failed:', error)
    actionError.value = t('common.error.operationFailed')
  } finally {
    actionBusy.value = false
  }
}

function cancelRun(): void {
  const runId = detail.value?.id
  if (!runId || !canCancel.value) {
    return
  }
  void performRunAction(() => workflowClient.cancel(props.sessionId, runId))
}

function resumeRun(): void {
  const runId = detail.value?.id
  if (!runId || !canResume.value) {
    return
  }
  void performRunAction(() => workflowClient.resume(props.sessionId, runId))
}

async function synthesizeRun(): Promise<void> {
  const runId = detail.value?.id
  if (!runId || !canSynthesize.value || actionBusy.value) {
    return
  }
  actionBusy.value = true
  actionError.value = null
  synthesisState.value = null
  try {
    const receipt = await workflowClient.synthesize(props.sessionId, runId)
    synthesisState.value = receipt.state
  } catch (error) {
    console.warn('[WorkflowPanel] Parent synthesis failed:', error)
    actionError.value = t('common.error.operationFailed')
  } finally {
    actionBusy.value = false
  }
}

function requestRetry(invocation: WorkflowInvocationProjection, fromHere: boolean): void {
  if (retryHasEffectRisk(invocation, fromHere)) {
    pendingRetry.value = { invocationId: invocation.id, fromHere }
    return
  }
  void retryInvocation(invocation.id, fromHere, false)
}

function confirmRiskyRetry(): void {
  const retry = pendingRetry.value
  if (retry) {
    void retryInvocation(retry.invocationId, retry.fromHere, true)
  }
}

function retryInvocation(
  invocationId: string,
  fromHere: boolean,
  confirmEffects: boolean
): Promise<void> {
  const runId = detail.value?.id
  if (!runId) {
    return Promise.resolve()
  }
  return performRunAction(
    () =>
      workflowClient.retry(props.sessionId, runId, invocationId, {
        fromHere,
        confirmEffects
      }),
    { clearRetry: confirmEffects }
  )
}

function retryHasEffectRisk(invocation: WorkflowInvocationProjection, fromHere: boolean): boolean {
  const candidates = fromHere
    ? (detail.value?.invocations ?? []).filter((candidate) => candidate.seq >= invocation.seq)
    : [invocation]
  return candidates.some(
    (candidate) => candidate.effectState === 'write' || candidate.effectState === 'unknown'
  )
}

function canRetryInvocation(invocation: WorkflowInvocationProjection): boolean {
  const status = detail.value?.status
  return Boolean(
    isRuntimeCompatible.value &&
    (status === 'failed' || status === 'interrupted') &&
    latestInvocationIds.value.has(invocation.id) &&
    invocation.invalidatedAt === null
  )
}

function openChild(childSessionId: string): void {
  void sessionStore.selectSession(childSessionId)
}

function runTitle(run: WorkflowRunSummary): string {
  const path = run.namedWorkflowPath?.trim()
  if (path) {
    return path.split(/[\\/]/u).filter(Boolean).at(-1) || path
  }
  return t('chat.workflow.runLabel', { id: run.id.slice(-8) })
}

function completedInvocationCount(run: WorkflowRunSummary): number {
  const counts = run.invocationCounts
  return counts.succeeded + counts.failed + counts.timed_out + counts.cancelled + counts.interrupted
}

function totalInvocationCount(run: WorkflowRunSummary): number {
  return Object.values(run.invocationCounts).reduce((total, count) => total + count, 0)
}

function runDurationMs(run: WorkflowRunSummary): number {
  const end = run.completedAt ?? now.value
  return Math.max(0, end - (run.startedAt ?? run.createdAt))
}

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1_000)
  if (seconds < 60) {
    return t('chat.workflow.duration.seconds', { count: seconds })
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return t('chat.workflow.duration.minutes', {
      minutes,
      seconds: remainingSeconds
    })
  }
  return t('chat.workflow.duration.hours', {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60
  })
}

function formatUsage(value: JsonValue | null): string {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return t('chat.workflow.states.unavailable')
  }
  const entries = Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .sort(([left], [right]) => {
      if (left === 'totalTokens') return -1
      if (right === 'totalTokens') return 1
      return left.localeCompare(right)
    })
    .slice(0, 3)
  return entries.length > 0
    ? entries.map(([key, amount]) => `${key}: ${amount.toLocaleString()}`).join(' · ')
    : t('chat.workflow.states.unavailable')
}

function formatPhase(value: JsonValue): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value && !Array.isArray(value)) {
    const label = value.label ?? value.key
    if (typeof label === 'string' && label.trim()) {
      return label
    }
  }
  const serialized = JSON.stringify(value)
  return serialized.length > 300 ? `${serialized.slice(0, 300)}…` : serialized
}

function formatBudget(budget: WorkflowRunBudget): string {
  const parts: string[] = []
  if (budget.maxTotalTokens !== undefined) {
    parts.push(
      t('chat.workflow.budget.tokens', {
        count: budget.maxTotalTokens.toLocaleString()
      })
    )
  }
  if (budget.maxExecutionMs !== undefined) {
    parts.push(
      t('chat.workflow.budget.duration', {
        duration: formatDuration(budget.maxExecutionMs)
      })
    )
  }
  return parts.join(' · ')
}

function invocationDepth(callPath: string): number {
  return Math.min(3, Math.max(0, callPath.split('/').filter(Boolean).length - 2))
}

function statusLabel(status: WorkflowRunStatus): string {
  return t(`chat.workflow.status.${status}`)
}

function statusDotClass(status: WorkflowRunStatus): string {
  if (status === 'succeeded') return 'bg-emerald-500'
  if (status === 'failed' || status === 'cancelled') return 'bg-destructive'
  if (status === 'interrupted' || status === 'waiting_interaction') return 'bg-amber-500'
  if (status === 'cancelling') return 'bg-orange-500'
  return 'bg-blue-500'
}

function statusBadgeClass(status: WorkflowRunStatus): string {
  if (status === 'succeeded') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (status === 'failed' || status === 'cancelled') {
    return 'bg-destructive/10 text-destructive'
  }
  if (status === 'interrupted' || status === 'waiting_interaction') {
    return 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  return 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
}

function invocationStatusIcon(status: WorkflowInvocationStatus): string {
  if (status === 'succeeded') return 'lucide:circle-check'
  if (status === 'failed' || status === 'cancelled') return 'lucide:circle-x'
  if (status === 'timed_out') return 'lucide:timer-off'
  if (status === 'interrupted' || status === 'waiting_interaction') return 'lucide:circle-alert'
  if (status === 'queued' || status === 'admitted') return 'lucide:clock-3'
  return 'lucide:loader-circle'
}

function invocationStatusClass(status: WorkflowInvocationStatus): string {
  if (status === 'succeeded') return 'text-emerald-600'
  if (status === 'failed' || status === 'cancelled') return 'text-destructive'
  if (status === 'timed_out' || status === 'interrupted' || status === 'waiting_interaction') {
    return 'text-amber-600'
  }
  return 'text-blue-600'
}

function effectLabel(effect: WorkflowEffectState): string {
  return t(`chat.workflow.effects.${effect}`)
}

function effectBadgeClass(effect: WorkflowEffectState): string {
  if (effect === 'write' || effect === 'unknown') {
    return 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  return 'bg-muted text-muted-foreground'
}

watch(
  () => props.sessionId,
  () => {
    sessionRequestId += 1
    detailRequestId += 1
    runs.value = []
    setSelectedRunId(props.selectedRunId ?? null, false)
    detail.value = null
    pendingInvocationDeltas.clear()
    detailError.value = null
    void refreshRuns()
  }
)

watch(
  () => props.selectedRunId,
  (runId) => {
    const normalized = runId?.trim() || null
    if (normalized === selectedRunId.value) {
      return
    }
    setSelectedRunId(normalized, false)
    detail.value = null
    pendingInvocationDeltas.clear()
    detailError.value = null
    actionError.value = null
    synthesisState.value = null
    if (normalized) {
      if (props.expanded) {
        void loadDetail(normalized)
      }
    } else if (runs.value[0]) {
      selectRun(runs.value[0].id)
    }
  }
)

watch(
  () => props.expanded,
  (expanded) => {
    detailRequestId += 1
    loadingDetail.value = false
    if (expanded && selectedRunId.value) {
      void loadDetail(selectedRunId.value)
    }
  }
)

onMounted(() => {
  disposed = false
  clockTimer = window.setInterval(() => {
    now.value = Date.now()
  }, 1_000)
  stopRunChanged = workflowClient.onRunChanged(({ run }) => {
    if (run.parentSessionId === props.sessionId) {
      upsertRun(run)
    }
  })
  stopInvocationChanged = workflowClient.onInvocationChanged(
    ({ parentSessionId, runId, invocation }) => {
      if (
        parentSessionId === props.sessionId &&
        runId === invocation.runId &&
        runId === selectedRunId.value
      ) {
        applyInvocationDelta(invocation)
      }
    }
  )
  void refreshRuns()
})

onBeforeUnmount(() => {
  disposed = true
  sessionRequestId += 1
  detailRequestId += 1
  if (clockTimer !== null) {
    window.clearInterval(clockTimer)
    clockTimer = null
  }
  stopRunChanged?.()
  stopRunChanged = null
  stopInvocationChanged?.()
  stopInvocationChanged = null
  pendingInvocationDeltas.clear()
})
</script>
