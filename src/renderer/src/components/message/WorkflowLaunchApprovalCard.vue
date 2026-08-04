<template>
  <section
    data-testid="workflow-launch-approval-card"
    class="w-full max-w-3xl overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/[0.06]"
  >
    <header class="flex items-center gap-2 border-b border-amber-500/20 px-3 py-2.5">
      <span class="rounded-md bg-amber-500/15 p-1.5 text-amber-700 dark:text-amber-300">
        <Icon icon="lucide:git-fork" class="h-4 w-4" aria-hidden="true" />
      </span>
      <p class="min-w-0 flex-1 text-sm font-semibold">
        {{ t('chat.workflow.saved.approval.title') }}
      </p>
      <span
        v-if="state !== 'checking'"
        class="rounded-full border bg-background/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
      >
        {{ displayApproval.summary.outline.confidence }}
      </span>
    </header>

    <div class="space-y-3 px-3 py-3">
      <div
        v-if="state === 'checking'"
        data-testid="workflow-approval-checking"
        class="flex items-center gap-2 py-2 text-xs text-muted-foreground"
      >
        <Icon icon="lucide:loader-circle" class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        {{ t('chat.workflow.approval.checking') }}
      </div>

      <template v-else>
        <dl class="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
          <div class="min-w-0 sm:col-span-2">
            <dt class="text-muted-foreground">
              {{ t('chat.workflow.saved.approval.sourceHash') }}
            </dt>
            <dd
              data-testid="workflow-approval-source-hash"
              class="break-all font-mono text-[11px] text-foreground/85"
            >
              {{ displayApproval.sourceHash }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground">
              {{ t('chat.workflow.saved.approval.workspace') }}
            </dt>
            <dd class="truncate" :title="displayApproval.summary.workspacePath || undefined">
              {{ displayApproval.summary.workspacePath || '—' }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground">
              {{ t('chat.workflow.saved.approval.agents') }}
            </dt>
            <dd class="break-words">
              {{ displayApproval.summary.allowedAgentIds.join(', ') }}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">
              {{ t('chat.workflow.saved.approval.maxInvocations') }}
            </dt>
            <dd>{{ displayApproval.summary.maxInvocations }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">
              {{ t('chat.workflow.saved.approval.maxPendingInvocations') }}
            </dt>
            <dd>{{ displayApproval.summary.maxPendingInvocations }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground">{{ t('chat.workflow.fields.budget') }}</dt>
            <dd>{{ approvalBudget }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground">{{ t('model.capabilities') }}</dt>
            <dd class="break-words font-mono text-[11px]">
              {{ displayApproval.summary.capabilities.join(', ') || '—' }}
            </dd>
          </div>
        </dl>

        <div
          v-if="displayApproval.summary.outline.nodes.length > 0"
          data-testid="workflow-approval-outline"
          class="rounded-lg border bg-background/60 px-2.5 py-2"
        >
          <p class="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
            <Icon icon="lucide:route" class="h-3.5 w-3.5" aria-hidden="true" />
            {{ t('chat.workflow.invocations.defaultPhase') }}
          </p>
          <div class="max-h-32 space-y-1 overflow-auto">
            <p
              v-for="node in displayApproval.summary.outline.nodes"
              :key="node.id"
              class="truncate font-mono text-[11px] text-muted-foreground"
              :title="formatWorkflowOutlineNode(node)"
            >
              {{ formatWorkflowOutlineNode(node) }}
            </p>
          </div>
        </div>

        <p class="flex gap-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
          <Icon icon="lucide:triangle-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {{ t('chat.workflow.saved.approval.warning') }}
        </p>

        <p
          v-if="state === 'unavailable' || state === 'launch_unconfirmed'"
          data-testid="workflow-approval-unavailable"
          class="text-xs text-muted-foreground"
        >
          {{
            t(
              state === 'launch_unconfirmed'
                ? 'chat.workflow.approval.launchUnconfirmed'
                : 'chat.workflow.approval.unavailable'
            )
          }}
        </p>
        <p
          v-else-if="state === 'superseded'"
          data-testid="workflow-approval-superseded"
          class="text-xs text-muted-foreground"
        >
          {{ t('chat.workflow.approval.revisionRequested') }}
        </p>
        <p v-if="errorMessage" class="text-xs text-destructive">
          {{ errorMessage }}
        </p>

        <div v-if="revisionOpen" class="space-y-2 rounded-lg border bg-background/60 p-2.5">
          <Textarea
            v-model="revisionFeedback"
            data-testid="workflow-approval-feedback"
            class="min-h-20 resize-y text-xs"
            :maxlength="MAX_REVISION_FEEDBACK_CHARS"
            :placeholder="t('chat.workflow.approval.feedbackPlaceholder')"
            :disabled="props.readOnly || state === 'revising'"
          />
          <div class="flex flex-wrap gap-2">
            <Button
              data-testid="workflow-approval-regenerate"
              size="sm"
              variant="outline"
              class="h-8 text-xs"
              :disabled="
                props.readOnly || state === 'revising' || revisionFeedback.trim().length === 0
              "
              @click="requestRevision"
            >
              <Icon
                :icon="state === 'revising' ? 'lucide:loader-circle' : 'lucide:refresh-cw'"
                :class="['mr-1.5 h-3.5 w-3.5', state === 'revising' ? 'animate-spin' : '']"
              />
              {{ t('chat.workflow.approval.stageRevision') }}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              class="h-8 text-xs"
              :disabled="state === 'revising'"
              @click="closeRevision"
            >
              {{ t('common.cancel') }}
            </Button>
          </div>
        </div>

        <div v-else class="flex flex-wrap items-center gap-2">
          <Button
            data-testid="workflow-approval-launch"
            size="sm"
            class="h-8 text-xs"
            :disabled="!canLaunch"
            @click="launchApproved"
          >
            <Icon
              :icon="launchIcon"
              :class="['mr-1.5 h-3.5 w-3.5', state === 'launching' ? 'animate-spin' : '']"
            />
            {{ launchLabel }}
          </Button>
          <Button
            v-if="canRevise"
            data-testid="workflow-approval-revise"
            size="sm"
            variant="outline"
            class="h-8 text-xs"
            @click="revisionOpen = true"
          >
            <Icon icon="lucide:message-square-more" class="mr-1.5 h-3.5 w-3.5" />
            {{ t('chat.workflow.approval.modify') }}
          </Button>
        </div>

        <div class="border-t pt-2">
          <button
            type="button"
            data-testid="workflow-approval-source-toggle"
            class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            :aria-expanded="sourceVisible"
            @click="sourceVisible = !sourceVisible"
          >
            <Icon
              icon="lucide:chevron-right"
              class="h-3.5 w-3.5 transition-transform"
              :class="sourceVisible ? 'rotate-90' : ''"
            />
            {{ t('chat.workflow.approval.sourceDisclosure') }}
          </button>
          <pre
            v-if="sourceVisible"
            data-testid="workflow-approval-source"
            class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-2 font-mono text-[11px]"
            >{{ scriptSource }}</pre
          >
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Textarea } from '@shadcn/components/ui/textarea'
import { createWorkflowClient } from '@api/WorkflowClient'
import type { WorkflowRunBudget, WorkflowLaunchApproval } from '@shared/workflow/serviceContracts'
import { WORKFLOW_EVENTS } from '@/events'
import { formatWorkflowOutlineNode } from '@/lib/workflowOutline'

type ApprovalCardState =
  | 'checking'
  | 'ready'
  | 'launching'
  | 'launched'
  | 'launch_unconfirmed'
  | 'expired'
  | 'unavailable'
  | 'revising'
  | 'superseded'

const MAX_REVISION_FEEDBACK_CHARS = 8_192

const props = withDefaults(
  defineProps<{
    threadId: string
    approval: WorkflowLaunchApproval
    scriptSource: string
    readOnly?: boolean
  }>(),
  {
    readOnly: false
  }
)

const { t } = useI18n()
const workflowClient = createWorkflowClient()
const state = ref<ApprovalCardState>('checking')
const validatedApproval = shallowRef<WorkflowLaunchApproval | null>(null)
const errorMessage = ref<string | null>(null)
const revisionOpen = ref(false)
const revisionFeedback = ref('')
const sourceVisible = ref(false)

let disposed = false
let operationToken = 0
let expiryTimer: number | null = null

const displayApproval = computed(() => validatedApproval.value ?? props.approval)
const canLaunch = computed(
  () => !props.readOnly && state.value === 'ready' && validatedApproval.value !== null
)
const canRevise = computed(
  () =>
    !props.readOnly &&
    props.threadId.length > 0 &&
    (state.value === 'ready' || state.value === 'expired' || state.value === 'unavailable')
)

const launchLabel = computed(() => {
  switch (state.value) {
    case 'checking':
    case 'launching':
    case 'revising':
      return t('chat.workflow.loading')
    case 'launched':
      return t('chat.workflow.approval.launched')
    case 'expired':
      return t('chat.workflow.saved.approval.expired')
    case 'unavailable':
    case 'launch_unconfirmed':
      return t('chat.workflow.approval.unavailableShort')
    case 'superseded':
      return t('chat.workflow.approval.revisionRequestedShort')
    default:
      return t('chat.workflow.saved.actions.launch')
  }
})

const launchIcon = computed(() => {
  if (state.value === 'launching' || state.value === 'checking') {
    return 'lucide:loader-circle'
  }
  if (state.value === 'launched') {
    return 'lucide:circle-check'
  }
  if (
    state.value === 'expired' ||
    state.value === 'unavailable' ||
    state.value === 'launch_unconfirmed'
  ) {
    return 'lucide:clock-alert'
  }
  return 'lucide:play'
})

const approvalBudget = computed(() => formatApprovalBudget(displayApproval.value.summary.budget))

function formatApprovalBudget(budget: WorkflowRunBudget | null): string {
  if (!budget) {
    return '—'
  }
  return t('chat.workflow.budget.duration', {
    duration: formatApprovalDuration(budget.maxExecutionMs)
  })
}

function formatApprovalDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1_000)
  if (seconds < 60) {
    return t('chat.workflow.duration.seconds', { count: seconds })
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return t('chat.workflow.duration.minutes', { minutes, seconds: seconds % 60 })
  }
  return t('chat.workflow.duration.hours', {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60
  })
}

function clearExpiryTimer(): void {
  if (expiryTimer !== null) {
    window.clearTimeout(expiryTimer)
    expiryTimer = null
  }
}

function scheduleExpiry(expiresAt: number): void {
  clearExpiryTimer()
  const remaining = expiresAt - Date.now()
  if (remaining <= 0) {
    if (state.value === 'ready') {
      state.value = 'expired'
    }
    return
  }
  expiryTimer = window.setTimeout(() => {
    expiryTimer = null
    if (state.value === 'ready') {
      state.value = 'expired'
    }
  }, remaining)
}

async function validateApproval(): Promise<void> {
  const token = ++operationToken
  const threadId = props.threadId
  const localApproval = props.approval
  const scriptSource = props.scriptSource
  clearExpiryTimer()
  validatedApproval.value = null
  errorMessage.value = null
  revisionOpen.value = false
  revisionFeedback.value = ''
  sourceVisible.value = false

  if (!threadId || localApproval.expiresAt <= Date.now()) {
    state.value = localApproval.expiresAt <= Date.now() ? 'expired' : 'unavailable'
    return
  }

  state.value = 'checking'
  try {
    const approval = await workflowClient.validateLaunchApproval(
      threadId,
      localApproval.approvalId,
      scriptSource
    )
    if (disposed || token !== operationToken || threadId !== props.threadId) {
      return
    }
    if (
      approval.approvalId !== localApproval.approvalId ||
      approval.sourceHash !== localApproval.sourceHash ||
      approval.scopeHash !== localApproval.scopeHash ||
      approval.expiresAt !== localApproval.expiresAt
    ) {
      state.value = 'unavailable'
      return
    }
    if (approval.expiresAt <= Date.now()) {
      state.value = 'expired'
      return
    }
    validatedApproval.value = approval
    state.value = 'ready'
    scheduleExpiry(approval.expiresAt)
  } catch {
    if (!disposed && token === operationToken && threadId === props.threadId) {
      state.value = 'unavailable'
    }
  }
}

async function launchApproved(): Promise<void> {
  const approval = validatedApproval.value
  if (!approval || !canLaunch.value) {
    return
  }
  if (approval.expiresAt <= Date.now()) {
    state.value = 'expired'
    clearExpiryTimer()
    return
  }

  const token = ++operationToken
  const threadId = props.threadId
  state.value = 'launching'
  errorMessage.value = null
  clearExpiryTimer()
  try {
    const run = await workflowClient.launch(threadId, approval.approvalId)
    if (disposed || token !== operationToken || threadId !== props.threadId) {
      return
    }
    state.value = 'launched'
    window.dispatchEvent(
      new CustomEvent(WORKFLOW_EVENTS.OPEN_REQUESTED, {
        detail: {
          sessionId: threadId,
          runId: run.id
        }
      })
    )
  } catch {
    if (!disposed && token === operationToken && threadId === props.threadId) {
      state.value = 'launch_unconfirmed'
    }
  }
}

function closeRevision(): void {
  revisionOpen.value = false
  revisionFeedback.value = ''
}

async function requestRevision(): Promise<void> {
  const feedback = revisionFeedback.value.trim()
  if (
    !feedback ||
    feedback.length > MAX_REVISION_FEEDBACK_CHARS ||
    !props.threadId ||
    props.readOnly ||
    state.value === 'revising' ||
    state.value === 'launched' ||
    state.value === 'launch_unconfirmed'
  ) {
    return
  }

  const previousState = state.value
  const token = ++operationToken
  const threadId = props.threadId
  const approvalId = props.approval.approvalId
  state.value = 'revising'
  errorMessage.value = null
  clearExpiryTimer()
  try {
    if (props.approval.expiresAt > Date.now()) {
      const revoked = await workflowClient.revokeLaunchApproval(threadId, approvalId)
      if (!revoked) {
        if (!disposed && token === operationToken && threadId === props.threadId) {
          revisionOpen.value = false
          revisionFeedback.value = ''
          state.value = 'launch_unconfirmed'
        }
        return
      }
    }
    if (disposed || token !== operationToken || threadId !== props.threadId) {
      return
    }
    window.dispatchEvent(
      new CustomEvent(WORKFLOW_EVENTS.REVISE_REQUESTED, {
        detail: {
          sessionId: threadId,
          text: t('chat.workflow.approval.revisionPrompt', {
            sourceHash: props.approval.sourceHash,
            feedback
          })
        }
      })
    )
    validatedApproval.value = null
    revisionOpen.value = false
    revisionFeedback.value = ''
    state.value = 'superseded'
  } catch {
    if (!disposed && token === operationToken && threadId === props.threadId) {
      state.value = previousState
      errorMessage.value = t('common.error.operationFailed')
      if (previousState === 'ready') {
        scheduleExpiry(props.approval.expiresAt)
      }
    }
  }
}

watch(
  () =>
    [
      props.threadId,
      props.approval.approvalId,
      props.approval.sourceHash,
      props.approval.scopeHash,
      props.approval.expiresAt,
      props.scriptSource
    ] as const,
  () => {
    void validateApproval()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  disposed = true
  operationToken += 1
  clearExpiryTimer()
})
</script>
