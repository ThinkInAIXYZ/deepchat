<template>
  <section data-testid="saved-workflow-panel" class="space-y-2 rounded-lg border bg-muted/15 p-2.5">
    <div class="flex items-center gap-2">
      <Icon icon="lucide:file-code-2" class="h-3.5 w-3.5 text-muted-foreground" />
      <p class="min-w-0 flex-1 text-[11px] font-semibold">
        {{ t('chat.workflow.saved.title') }}
      </p>
      <Button
        variant="ghost"
        size="icon"
        class="h-6 w-6"
        :aria-label="t('chat.workflow.saved.actions.refresh')"
        :disabled="busy || loadingCatalog || loadingDocument || dirty"
        @click="loadCatalog"
      >
        <Icon icon="lucide:refresh-cw" class="h-3 w-3" />
      </Button>
    </div>

    <div v-if="loadingCatalog && !catalog" class="py-2 text-center">
      <Icon
        icon="lucide:loader-circle"
        class="mx-auto h-3.5 w-3.5 animate-spin text-muted-foreground"
      />
    </div>

    <p
      v-else-if="catalog?.directoryPath === null"
      data-testid="saved-workflow-unavailable"
      class="rounded border border-dashed px-2 py-2 text-[10px] leading-relaxed text-muted-foreground"
    >
      {{ t('chat.workflow.saved.workspaceRequired') }}
    </p>

    <template v-else-if="catalog">
      <p class="truncate font-mono text-[9px] text-muted-foreground" :title="catalog.directoryPath">
        {{ catalog.directoryPath }}
      </p>

      <div class="flex gap-1.5">
        <select
          data-testid="saved-workflow-select"
          class="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-[10px]"
          :value="selectedName"
          :disabled="busy || loadingDocument || dirty"
          @change="selectSavedWorkflow"
        >
          <option value="">{{ t('chat.workflow.saved.selectPlaceholder') }}</option>
          <option v-for="workflow in catalog.workflows" :key="workflow.name" :value="workflow.name">
            {{ workflow.name }}
          </option>
        </select>
        <Button
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[10px]"
          data-testid="saved-workflow-new"
          :disabled="busy || loadingDocument || dirty"
          @click="createDraft"
        >
          <Icon icon="lucide:plus" class="mr-1 h-3 w-3" />
          {{ t('chat.workflow.saved.actions.new') }}
        </Button>
      </div>

      <p
        v-if="catalog.workflows.length === 0 && !editing"
        class="rounded border border-dashed px-2 py-2 text-[10px] text-muted-foreground"
      >
        {{ t('chat.workflow.saved.empty') }}
      </p>

      <div v-if="editing" class="space-y-2" data-testid="saved-workflow-editor">
        <label class="block space-y-1">
          <span class="text-[10px] font-medium">{{ t('chat.workflow.saved.fields.name') }}</span>
          <Input
            v-model="draftName"
            data-testid="saved-workflow-name"
            class="h-7 text-[10px]"
            :disabled="busy || loadingDocument || document !== null"
            maxlength="64"
            autocomplete="off"
            spellcheck="false"
          />
        </label>

        <label class="block space-y-1">
          <span class="text-[10px] font-medium">{{ t('chat.workflow.saved.fields.source') }}</span>
          <Textarea
            v-model="draftSource"
            data-testid="saved-workflow-source"
            class="min-h-36 resize-y font-mono text-[10px] leading-relaxed"
            :maxlength="WORKFLOW_SAVED_MAX_SOURCE_BYTES"
            :disabled="busy || loadingDocument"
            spellcheck="false"
          />
        </label>

        <div class="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            class="h-7 text-[10px]"
            data-testid="saved-workflow-save"
            :disabled="!canSave"
            @click="saveDraft"
          >
            <Icon icon="lucide:save" class="mr-1 h-3 w-3" />
            {{ t('chat.workflow.saved.actions.save') }}
          </Button>
          <Button
            v-if="document"
            variant="ghost"
            size="sm"
            class="h-7 text-[10px]"
            :disabled="busy || loadingDocument"
            @click="reloadDocument"
          >
            {{ t('chat.workflow.saved.actions.reload') }}
          </Button>
          <Button
            v-else
            variant="ghost"
            size="sm"
            class="h-7 text-[10px]"
            data-testid="saved-workflow-discard"
            :disabled="busy || loadingDocument"
            @click="resetEditor"
          >
            {{ t('common.cancel') }}
          </Button>
          <span v-if="dirty" class="text-[9px] text-amber-700 dark:text-amber-300">
            {{ t('chat.workflow.saved.unsaved') }}
          </span>
        </div>

        <div class="border-t pt-2">
          <p class="mb-1.5 text-[10px] font-semibold">
            {{ t('chat.workflow.saved.runTitle') }}
          </p>
          <label class="block space-y-1">
            <span class="text-[10px] font-medium">{{ t('chat.workflow.saved.fields.args') }}</span>
            <Textarea
              v-model="argsText"
              data-testid="saved-workflow-args"
              class="min-h-16 resize-y font-mono text-[10px]"
              :maxlength="WORKFLOW_SAVED_MAX_ARGS_BYTES"
              :disabled="busy || loadingDocument"
              spellcheck="false"
            />
          </label>
          <label class="mt-2 block space-y-1">
            <span class="text-[10px] font-medium">
              {{ t('chat.workflow.saved.fields.agents') }}
            </span>
            <Input
              v-model="agentIdsText"
              data-testid="saved-workflow-agents"
              class="h-7 text-[10px]"
              :disabled="busy || loadingDocument"
              :placeholder="t('chat.workflow.saved.agentPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            class="mt-2 h-7 text-[10px]"
            data-testid="saved-workflow-prepare"
            :disabled="!canPrepare"
            @click="prepareLaunch"
          >
            <Icon icon="lucide:shield-check" class="mr-1 h-3 w-3" />
            {{ t('chat.workflow.saved.actions.prepare') }}
          </Button>
        </div>

        <div
          v-if="approval"
          data-testid="saved-workflow-approval"
          class="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-[10px]"
        >
          <p class="font-semibold text-amber-800 dark:text-amber-200">
            {{ t('chat.workflow.saved.approval.title') }}
          </p>
          <dl class="space-y-1 text-muted-foreground">
            <div>
              <dt class="inline">{{ t('chat.workflow.saved.approval.sourceHash') }}:</dt>
              <dd class="ml-1 inline break-all font-mono">{{ approval.sourceHash }}</dd>
            </div>
            <div>
              <dt class="inline">{{ t('chat.workflow.saved.approval.workspace') }}:</dt>
              <dd class="ml-1 inline break-all">{{ approval.summary.workspacePath || '—' }}</dd>
            </div>
            <div>
              <dt class="inline">{{ t('chat.workflow.saved.approval.agents') }}:</dt>
              <dd class="ml-1 inline break-words">
                {{ approval.summary.allowedAgentIds.join(', ') }}
              </dd>
            </div>
            <div>
              <dt class="inline">{{ t('chat.workflow.saved.approval.maxInvocations') }}:</dt>
              <dd class="ml-1 inline">{{ approval.summary.maxInvocations }}</dd>
            </div>
            <div>
              <dt class="inline">{{ t('chat.workflow.saved.approval.maxPendingInvocations') }}:</dt>
              <dd class="ml-1 inline">{{ approval.summary.maxPendingInvocations }}</dd>
            </div>
            <div>
              <dt class="inline">{{ t('chat.workflow.fields.budget') }}:</dt>
              <dd class="ml-1 inline">{{ formatApprovalBudget(approval.summary.budget) }}</dd>
            </div>
            <div>
              <dt class="inline">{{ t('model.capabilities') }}:</dt>
              <dd
                data-testid="saved-workflow-capabilities"
                class="ml-1 inline break-words font-mono"
              >
                {{ approval.summary.capabilities.join(', ') || '—' }}
              </dd>
            </div>
            <div
              v-if="approval.summary.outline.nodes.length > 0"
              data-testid="saved-workflow-outline"
              class="pt-1"
            >
              <dt class="flex items-center gap-1">
                <Icon icon="lucide:route" class="h-3 w-3" />
                {{ t('chat.workflow.invocations.defaultPhase') }}:
                <span class="rounded bg-background/70 px-1 font-mono text-[9px]">
                  {{ approval.summary.outline.confidence }}
                </span>
              </dt>
              <dd class="mt-1 max-h-28 space-y-0.5 overflow-auto">
                <p
                  v-for="node in approval.summary.outline.nodes"
                  :key="node.id"
                  class="truncate font-mono text-[9px]"
                  :title="formatWorkflowOutlineNode(node)"
                >
                  {{ formatWorkflowOutlineNode(node) }}
                </p>
              </dd>
            </div>
          </dl>
          <p class="leading-relaxed text-amber-800 dark:text-amber-200">
            {{ t('chat.workflow.saved.approval.warning') }}
          </p>
          <Button
            variant="default"
            size="sm"
            class="h-7 text-[10px]"
            data-testid="saved-workflow-launch"
            :disabled="busy || approvalExpired"
            @click="launchApproved"
          >
            <Icon icon="lucide:play" class="mr-1 h-3 w-3" />
            {{
              approvalExpired
                ? t('chat.workflow.saved.approval.expired')
                : t('chat.workflow.saved.actions.launch')
            }}
          </Button>
        </div>
      </div>
    </template>

    <p v-if="errorMessage" class="break-words text-[10px] text-destructive">
      {{ errorMessage }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Textarea } from '@shadcn/components/ui/textarea'
import { createWorkflowClient } from '@api/WorkflowClient'
import type { WorkflowRunSummary } from '@shared/workflow/projection'
import {
  WORKFLOW_SAVED_MAX_ARGS_BYTES,
  WORKFLOW_SAVED_MAX_SOURCE_BYTES,
  WorkflowSavedNameSchema,
  type WorkflowSavedCatalog,
  type WorkflowSavedDocument
} from '@shared/workflow/savedWorkflow'
import type { WorkflowLaunchApproval, WorkflowRunBudget } from '@shared/workflow/serviceContracts'
import { WORKFLOW_EVENTS } from '@/events'
import {
  deleteWorkflowAuthoringDraft,
  readWorkflowAuthoringDraft,
  saveWorkflowAuthoringDraft,
  type WorkflowAuthoringDraft
} from '@/lib/workflowAuthoringDraftStore'
import { formatWorkflowOutlineNode } from '@/lib/workflowOutline'
import type { SavedWorkflowInvocationRequest } from '@/stores/ui/sidepanel'

const DEFAULT_SOURCE = `phase('work', { label: 'Work' })

return await agent(String(input?.prompt ?? 'Complete the requested work.'), {
  key: 'main',
  label: 'Main task'
})
`

const props = defineProps<{
  sessionId: string
  invocationRequest?: SavedWorkflowInvocationRequest | null
}>()

const emit = defineEmits<{
  launched: [run: WorkflowRunSummary]
  consumed: [requestId: number]
}>()

const { t } = useI18n()
const workflowClient = createWorkflowClient()
const catalog = shallowRef<WorkflowSavedCatalog | null>(null)
const document = shallowRef<WorkflowSavedDocument | null>(null)
const selectedName = ref('')
const draftName = ref('')
const draftSource = ref('')
const argsText = ref('{}')
const agentIdsText = ref('')
const approval = shallowRef<WorkflowLaunchApproval | null>(null)
const loadingCatalog = ref(false)
const loadingDocument = ref(false)
const busy = ref(false)
const errorMessage = ref<string | null>(null)
const now = ref(Date.now())
const pendingInvocationRequest = shallowRef<SavedWorkflowInvocationRequest | null>(null)

let disposed = false
let catalogRequestId = 0
let documentRequestId = 0
let operationRequestId = 0
let clockTimer: number | null = null
let processingInvocationRequestId: number | null = null
let lastConsumedInvocationRequestId: number | null = null

const editing = computed(
  () => document.value !== null || draftName.value !== '' || draftSource.value !== ''
)
const dirty = computed(() => {
  const current = document.value
  return current
    ? draftSource.value !== current.source
    : draftName.value !== '' || draftSource.value !== ''
})
const sourceWithinLimit = computed(
  () => new TextEncoder().encode(draftSource.value).byteLength <= WORKFLOW_SAVED_MAX_SOURCE_BYTES
)
const canSave = computed(
  () =>
    !busy.value &&
    !loadingDocument.value &&
    WorkflowSavedNameSchema.safeParse(draftName.value).success &&
    draftSource.value.trim().length > 0 &&
    sourceWithinLimit.value &&
    (document.value === null || dirty.value)
)
const canPrepare = computed(
  () =>
    !busy.value &&
    !loadingDocument.value &&
    document.value !== null &&
    !dirty.value &&
    (approval.value === null || approval.value.expiresAt <= now.value)
)
const approvalExpired = computed(
  () => approval.value !== null && approval.value.expiresAt <= now.value
)

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
    return t('chat.workflow.duration.minutes', {
      minutes,
      seconds: seconds % 60
    })
  }
  return t('chat.workflow.duration.hours', {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60
  })
}

async function loadCatalog(): Promise<void> {
  const requestId = ++catalogRequestId
  const sessionId = props.sessionId
  loadingCatalog.value = true
  errorMessage.value = null
  try {
    const loaded = await workflowClient.listSaved(sessionId)
    if (disposed || requestId !== catalogRequestId || sessionId !== props.sessionId) {
      return
    }
    catalog.value = loaded
    const restored = restoreDraft(sessionId, loaded.directoryPath)
    if (pendingInvocationRequest.value) {
      await processPendingInvocation()
      return
    }
    if (restored) {
      return
    }
    const selectedStillExists = loaded.workflows.some(
      (workflow) => workflow.name === selectedName.value
    )
    if (selectedStillExists) {
      await loadDocument(selectedName.value, sessionId)
    } else if (loaded.workflows[0]) {
      await loadDocument(loaded.workflows[0].name, sessionId)
    } else {
      resetEditor()
    }
  } catch (error) {
    if (!disposed && requestId === catalogRequestId && sessionId === props.sessionId) {
      console.warn('[SavedWorkflowPanel] Failed to list saved workflows:', error)
      errorMessage.value = t('common.error.requestFailed')
    }
  } finally {
    if (!disposed && requestId === catalogRequestId && sessionId === props.sessionId) {
      loadingCatalog.value = false
    }
  }
}

async function loadDocument(name: string, sessionId = props.sessionId): Promise<void> {
  deleteCurrentDraft(sessionId)
  const requestId = ++documentRequestId
  selectedName.value = name
  document.value = null
  draftName.value = name
  draftSource.value = ''
  loadingDocument.value = true
  errorMessage.value = null
  approval.value = null
  try {
    const loaded = await workflowClient.readSaved(sessionId, name)
    if (
      disposed ||
      requestId !== documentRequestId ||
      sessionId !== props.sessionId ||
      selectedName.value !== name
    ) {
      return
    }
    document.value = loaded
    draftName.value = loaded.name
    draftSource.value = loaded.source
  } catch (error) {
    if (
      !disposed &&
      requestId === documentRequestId &&
      sessionId === props.sessionId &&
      selectedName.value === name
    ) {
      console.warn('[SavedWorkflowPanel] Failed to read saved workflow:', error)
      errorMessage.value = t('common.error.requestFailed')
    }
  } finally {
    if (
      !disposed &&
      requestId === documentRequestId &&
      sessionId === props.sessionId &&
      selectedName.value === name
    ) {
      loadingDocument.value = false
    }
  }
}

function selectSavedWorkflow(event: Event): void {
  const name = (event.target as HTMLSelectElement).value
  if (!name) {
    resetEditor()
    return
  }
  void loadDocument(name)
}

function reloadDocument(): void {
  const name = document.value?.name
  if (name) {
    void loadDocument(name)
  }
}

function createDraft(): void {
  deleteCurrentDraft()
  documentRequestId += 1
  loadingDocument.value = false
  document.value = null
  selectedName.value = ''
  draftName.value = ''
  draftSource.value = DEFAULT_SOURCE
  approval.value = null
  errorMessage.value = null
}

function resetEditor(): void {
  deleteCurrentDraft()
  clearEditor()
}

function clearEditor(): void {
  documentRequestId += 1
  loadingDocument.value = false
  document.value = null
  selectedName.value = ''
  draftName.value = ''
  draftSource.value = ''
  approval.value = null
}

async function saveDraft(): Promise<void> {
  if (!canSave.value) {
    return
  }
  const requestId = ++operationRequestId
  const sessionId = props.sessionId
  busy.value = true
  errorMessage.value = null
  approval.value = null
  try {
    const saved = await workflowClient.saveSaved(sessionId, {
      name: draftName.value,
      source: draftSource.value,
      expectedSourceHash: document.value?.sourceHash ?? null
    })
    if (disposed || requestId !== operationRequestId || sessionId !== props.sessionId) {
      return
    }
    document.value = saved
    selectedName.value = saved.name
    draftName.value = saved.name
    draftSource.value = saved.source
    upsertCatalog(saved)
    deleteCurrentDraft(sessionId)
    window.dispatchEvent(
      new CustomEvent(WORKFLOW_EVENTS.SAVED_CHANGED, {
        detail: {
          sessionId
        }
      })
    )
  } catch (error) {
    if (!disposed && requestId === operationRequestId && sessionId === props.sessionId) {
      console.warn('[SavedWorkflowPanel] Failed to save workflow:', error)
      errorMessage.value = t('common.error.operationFailed')
    }
  } finally {
    if (!disposed && requestId === operationRequestId && sessionId === props.sessionId) {
      busy.value = false
    }
  }
}

async function prepareLaunch(): Promise<boolean> {
  const current = document.value
  if (!current || !canPrepare.value) {
    return false
  }
  const requestId = ++operationRequestId
  const sessionId = props.sessionId
  busy.value = true
  errorMessage.value = null
  try {
    const allowedAgentIds = parseAgentIds(agentIdsText.value)
    const prepared = await workflowClient.prepareSavedLaunch(sessionId, {
      name: current.name,
      argsText: argsText.value,
      expectedSourceHash: current.sourceHash,
      ...(allowedAgentIds.length > 0 ? { allowedAgentIds } : {})
    })
    if (disposed || requestId !== operationRequestId || sessionId !== props.sessionId) {
      return false
    }
    approval.value = prepared
    now.value = Date.now()
    return true
  } catch (error) {
    if (!disposed && requestId === operationRequestId && sessionId === props.sessionId) {
      console.warn('[SavedWorkflowPanel] Failed to prepare workflow launch:', error)
      errorMessage.value = t('common.error.operationFailed')
    }
    return false
  } finally {
    if (!disposed && requestId === operationRequestId && sessionId === props.sessionId) {
      busy.value = false
    }
  }
}

async function launchApproved(): Promise<void> {
  const currentApproval = approval.value
  if (!currentApproval || approvalExpired.value || busy.value) {
    return
  }
  const requestId = ++operationRequestId
  const sessionId = props.sessionId
  busy.value = true
  errorMessage.value = null
  try {
    const run = await workflowClient.launch(sessionId, currentApproval.approvalId)
    if (disposed || requestId !== operationRequestId || sessionId !== props.sessionId) {
      return
    }
    approval.value = null
    emit('launched', run)
  } catch (error) {
    if (!disposed && requestId === operationRequestId && sessionId === props.sessionId) {
      console.warn('[SavedWorkflowPanel] Failed to launch saved workflow:', error)
      errorMessage.value = t('common.error.operationFailed')
    }
  } finally {
    if (!disposed && requestId === operationRequestId && sessionId === props.sessionId) {
      busy.value = false
    }
  }
}

function upsertCatalog(saved: WorkflowSavedDocument): void {
  const current = catalog.value
  if (!current) {
    return
  }
  const summary = {
    name: saved.name,
    relativePath: saved.relativePath,
    byteLength: saved.byteLength,
    updatedAt: saved.updatedAt
  }
  catalog.value = {
    ...current,
    workflows: [
      ...current.workflows.filter((workflow) => workflow.name !== saved.name),
      summary
    ].sort((left, right) => {
      if (left.name === right.name) {
        return 0
      }
      return left.name < right.name ? -1 : 1
    })
  }
}

function parseAgentIds(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/u)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ]
}

async function processPendingInvocation(): Promise<void> {
  const request = pendingInvocationRequest.value
  const currentCatalog = catalog.value
  if (
    !request ||
    !currentCatalog ||
    request.id === lastConsumedInvocationRequestId ||
    processingInvocationRequestId !== null
  ) {
    return
  }

  processingInvocationRequestId = request.id
  const sessionId = props.sessionId
  let handled = false
  try {
    if (dirty.value) {
      errorMessage.value = t('chat.workflow.saved.unsaved')
      return
    }
    const exists = currentCatalog.workflows.some((workflow) => workflow.name === request.name)
    if (currentCatalog.directoryPath === null || !exists) {
      errorMessage.value = t('common.error.requestFailed')
      return
    }

    await loadDocument(request.name, sessionId)
    if (
      disposed ||
      sessionId !== props.sessionId ||
      processingInvocationRequestId !== request.id ||
      pendingInvocationRequest.value?.id !== request.id ||
      document.value?.name !== request.name
    ) {
      return
    }

    argsText.value = request.argsText.trim() || '{}'
    agentIdsText.value = ''
    handled = await prepareLaunch()
  } finally {
    if (processingInvocationRequestId === request.id) {
      processingInvocationRequestId = null
    }
    if (handled && pendingInvocationRequest.value?.id === request.id) {
      pendingInvocationRequest.value = null
      lastConsumedInvocationRequestId = request.id
      emit('consumed', request.id)
    }
    if (pendingInvocationRequest.value && pendingInvocationRequest.value.id !== request.id) {
      void processPendingInvocation()
    }
  }
}

watch([draftSource, argsText, agentIdsText], () => {
  approval.value = null
})

watch(dirty, (isDirty) => {
  if (!isDirty && pendingInvocationRequest.value) {
    void processPendingInvocation()
  }
})

watch(now, (currentTime) => {
  if (approval.value && approval.value.expiresAt <= currentTime) {
    approval.value = null
  }
})

watch(
  () => props.invocationRequest,
  (request) => {
    if (!request || request.id === lastConsumedInvocationRequestId) {
      return
    }
    pendingInvocationRequest.value = { ...request }
    void processPendingInvocation()
  },
  { immediate: true }
)

watch(
  () => props.sessionId,
  (_, previousSessionId) => {
    persistCurrentDraft(previousSessionId, catalog.value?.directoryPath)
    catalogRequestId += 1
    documentRequestId += 1
    operationRequestId += 1
    busy.value = false
    catalog.value = null
    pendingInvocationRequest.value = props.invocationRequest ? { ...props.invocationRequest } : null
    processingInvocationRequestId = null
    lastConsumedInvocationRequestId = null
    clearEditor()
    argsText.value = '{}'
    agentIdsText.value = ''
    void loadCatalog()
  }
)

onMounted(() => {
  disposed = false
  clockTimer = window.setInterval(() => {
    now.value = Date.now()
  }, 1_000)
  void loadCatalog()
})

onBeforeUnmount(() => {
  persistCurrentDraft(props.sessionId, catalog.value?.directoryPath)
  disposed = true
  catalogRequestId += 1
  documentRequestId += 1
  operationRequestId += 1
  if (clockTimer !== null) {
    window.clearInterval(clockTimer)
    clockTimer = null
  }
})

function persistCurrentDraft(sessionId: string, directoryPath: string | null | undefined): void {
  if (!directoryPath) {
    return
  }
  const shouldPreserve =
    editing.value &&
    (dirty.value || argsText.value !== '{}' || agentIdsText.value.trim().length > 0)
  if (!shouldPreserve) {
    deleteWorkflowAuthoringDraft(sessionId, directoryPath)
    return
  }
  saveWorkflowAuthoringDraft(sessionId, directoryPath, {
    selectedName: selectedName.value,
    document: document.value,
    draftName: draftName.value,
    draftSource: draftSource.value,
    argsText: argsText.value,
    agentIdsText: agentIdsText.value
  })
}

function restoreDraft(sessionId: string, directoryPath: string | null): boolean {
  if (!directoryPath) {
    return false
  }
  const restored = readWorkflowAuthoringDraft(sessionId, directoryPath)
  if (!restored) {
    return false
  }
  applyDraft(restored)
  return true
}

function applyDraft(restored: WorkflowAuthoringDraft): void {
  documentRequestId += 1
  loadingDocument.value = false
  selectedName.value = restored.selectedName
  document.value = restored.document
  draftName.value = restored.draftName
  draftSource.value = restored.draftSource
  argsText.value = restored.argsText
  agentIdsText.value = restored.agentIdsText
  approval.value = null
  errorMessage.value = null
}

function deleteCurrentDraft(sessionId = props.sessionId): void {
  const directoryPath = catalog.value?.directoryPath
  if (directoryPath) {
    deleteWorkflowAuthoringDraft(sessionId, directoryPath)
  }
}
</script>
