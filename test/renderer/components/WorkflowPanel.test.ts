import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkflowInvocationProjection,
  WorkflowRunDetail,
  WorkflowRunSummary
} from '@shared/workflow/projection'
import { WORKFLOW_RUNTIME_DEFAULT_LIMITS } from '@shared/workflow/runtimeProtocol'

const client = vi.hoisted(() => {
  let runChanged: ((payload: { schemaVersion: 1; run: WorkflowRunSummary }) => void) | null = null
  return {
    list: vi.fn(),
    inspect: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
    retry: vi.fn(),
    synthesize: vi.fn(),
    selectSession: vi.fn(),
    onRunChanged: vi.fn((listener: typeof runChanged) => {
      runChanged = listener
      return vi.fn()
    }),
    emitRunChanged(run: WorkflowRunSummary) {
      runChanged?.({ schemaVersion: 1, run })
    },
    reset() {
      runChanged = null
    }
  }
})

vi.mock('@api/WorkflowClient', () => ({
  createWorkflowClient: () => client
}))

vi.mock('@/stores/ui/session', () => ({
  useSessionStore: () => ({
    selectSession: client.selectSession
  })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<i />'
  })
}))

vi.mock('@shadcn/components/ui/button', () => ({
  Button: defineComponent({
    name: 'Button',
    emits: ['click'],
    template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
  })
}))

vi.mock('@shadcn/components/ui/alert-dialog', () => {
  const passthrough = (name: string) =>
    defineComponent({
      name,
      template: '<div><slot /></div>'
    })
  return {
    AlertDialog: defineComponent({
      name: 'AlertDialog',
      props: {
        open: Boolean
      },
      template: '<div v-if="open"><slot /></div>'
    }),
    AlertDialogAction: defineComponent({
      name: 'AlertDialogAction',
      emits: ['click'],
      template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
    }),
    AlertDialogCancel: passthrough('AlertDialogCancel'),
    AlertDialogContent: passthrough('AlertDialogContent'),
    AlertDialogDescription: passthrough('AlertDialogDescription'),
    AlertDialogFooter: passthrough('AlertDialogFooter'),
    AlertDialogHeader: passthrough('AlertDialogHeader'),
    AlertDialogTitle: passthrough('AlertDialogTitle')
  }
})

import WorkflowPanel from '@/components/sidepanel/WorkflowPanel.vue'

const invocationCounts = {
  queued: 0,
  admitted: 0,
  running: 0,
  waiting_interaction: 0,
  succeeded: 0,
  failed: 0,
  timed_out: 0,
  cancelled: 0,
  interrupted: 0
}

function runSummary(overrides: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary {
  return {
    schemaVersion: 1,
    id: 'run-1',
    parentSessionId: 'parent-1',
    parentMessageId: null,
    namedWorkflowPath: '/repo/.deepchat/workflows/review.js',
    workspacePath: '/repo',
    capabilityScopeHash: 'c'.repeat(64),
    scriptHash: 'a'.repeat(64),
    runtimeApiVersion: 1,
    status: 'running',
    phase: { key: 'review', label: 'Review' },
    error: null,
    usage: { totalTokens: 12 },
    cancellationReason: null,
    interruptionReason: null,
    resultDeliveryState: 'not_ready',
    resultDeliveryId: null,
    invocationCounts: { ...invocationCounts, running: 1 },
    createdAt: 1,
    startedAt: 2,
    updatedAt: 3,
    completedAt: null,
    revision: 1,
    ...overrides
  }
}

function invocation(
  overrides: Partial<WorkflowInvocationProjection> = {}
): WorkflowInvocationProjection {
  return {
    id: 'invocation-1',
    runId: 'run-1',
    seq: 1,
    callPath: 'root/agent/review',
    attempt: 1,
    executionEpoch: 1,
    key: 'review',
    label: 'Review implementation',
    phase: 'review',
    agentId: 'deepchat',
    promptPreview: {
      text: 'Review the implementation',
      byteLength: 25,
      truncated: false
    },
    hasCustomSchema: false,
    inputHash: 'd'.repeat(64),
    policyHash: 'b'.repeat(64),
    childCorrelationSlot: 'slot-1',
    childSessionId: 'child-1',
    status: 'running',
    timeoutDeadlineAt: null,
    resultPreview: null,
    error: null,
    effectState: 'read',
    effectEvidence: null,
    usage: null,
    tapeLinkReceipt: null,
    invalidatedAt: null,
    invalidationReason: null,
    waitingInteractions: [],
    createdAt: 2,
    startedAt: 3,
    updatedAt: 3,
    completedAt: null,
    ...overrides
  }
}

function runDetail(
  summary: WorkflowRunSummary,
  overrides: Partial<WorkflowRunDetail> = {}
): WorkflowRunDetail {
  return {
    ...summary,
    limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS,
    allowedAgentIds: ['deepchat'],
    budget: { maxTotalTokens: 10_000 },
    resultPreview: null,
    invalidatedFromSeq: null,
    invocations: [invocation()],
    ...overrides
  }
}

async function mountPanel(
  summary: WorkflowRunSummary,
  detail: WorkflowRunDetail,
  selectedRunId?: string
) {
  client.list.mockResolvedValue([summary])
  client.inspect.mockResolvedValue(detail)
  const wrapper = mount(WorkflowPanel, {
    props: {
      sessionId: 'parent-1',
      expanded: true,
      selectedRunId
    }
  })
  await flushPromises()
  return wrapper
}

describe('WorkflowPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    client.reset()
  })

  it('renders durable progress, waiting interaction facts, and opens the child session', async () => {
    const summary = runSummary({
      status: 'waiting_interaction',
      invocationCounts: { ...invocationCounts, waiting_interaction: 1 }
    })
    const detail = runDetail(summary, {
      invocations: [
        invocation({
          status: 'waiting_interaction',
          waitingInteractions: [
            {
              kind: 'question',
              messageId: 'message-1',
              toolCallId: 'question-1',
              toolName: 'ask_user',
              label: 'Which implementation should be used?'
            }
          ]
        })
      ]
    })
    const wrapper = await mountPanel(summary, detail)

    expect(wrapper.get('[data-testid="workflow-run-detail"]').text()).toContain(
      'Which implementation should be used?'
    )
    await wrapper.get('[data-testid="workflow-open-child-invocation-1"]').trigger('click')
    expect(client.selectSession).toHaveBeenCalledWith('child-1')

    client.inspect.mockResolvedValue({
      ...detail,
      revision: 2,
      status: 'running',
      invocations: [invocation({ status: 'running' })]
    })
    client.emitRunChanged({
      ...summary,
      revision: 2,
      status: 'running',
      updatedAt: 4
    })
    await flushPromises()

    expect(client.inspect).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('inspects a requested historical run even when it is absent from the bounded list', async () => {
    const newest = runSummary({
      id: 'run-newest',
      updatedAt: 10
    })
    const requestedSummary = runSummary({
      id: 'run-historical',
      updatedAt: 2
    })
    const requestedDetail = runDetail(requestedSummary)

    const wrapper = await mountPanel(newest, requestedDetail, 'run-historical')

    expect(client.inspect).toHaveBeenCalledWith('parent-1', 'run-historical')
    expect(wrapper.get('[data-testid="workflow-run-detail"]').text()).toContain('run-historical')
    expect(wrapper.findAll('[data-testid="workflow-run-list"] button')).toHaveLength(2)
    wrapper.unmount()
  })

  it('keeps the last durable detail visible when a live refresh fails', async () => {
    const summary = runSummary()
    const detail = runDetail(summary)
    const wrapper = await mountPanel(summary, detail)

    client.inspect.mockRejectedValueOnce(new Error('temporary inspect failure'))
    client.emitRunChanged({
      ...summary,
      revision: 2,
      updatedAt: 4
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="workflow-run-detail"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="workflow-detail-error"]').text()).toContain(
      'common.error.requestFailed'
    )
    wrapper.unmount()
  })

  it('requires explicit confirmation before retrying a write-effect suffix', async () => {
    const summary = runSummary({
      status: 'interrupted',
      interruptionReason: 'DeepChat restarted.',
      invocationCounts: { ...invocationCounts, interrupted: 1 },
      completedAt: 5
    })
    const detail = runDetail(summary, {
      invocations: [
        invocation({
          status: 'interrupted',
          effectState: 'write',
          completedAt: 5
        })
      ]
    })
    client.retry.mockResolvedValue({
      ...summary,
      status: 'queued',
      revision: 2,
      updatedAt: 6
    })
    const wrapper = await mountPanel(summary, detail)

    await wrapper.get('[data-testid="workflow-retry-from-invocation-1"]').trigger('click')
    expect(client.retry).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="workflow-effect-confirm"]').trigger('click')
    await flushPromises()

    expect(client.retry).toHaveBeenCalledWith('parent-1', 'run-1', 'invocation-1', {
      fromHere: true,
      confirmEffects: true
    })
    expect(wrapper.find('[data-testid="workflow-retry-from-invocation-1"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('queues explicit parent synthesis without inferring a parent turn', async () => {
    const summary = runSummary({
      status: 'succeeded',
      resultDeliveryState: 'delivered',
      resultDeliveryId: 'delivery-1',
      invocationCounts: { ...invocationCounts, succeeded: 1 },
      completedAt: 5
    })
    const detail = runDetail(summary, {
      resultPreview: {
        text: '{"answer":42}',
        byteLength: 13,
        truncated: false
      },
      invocations: [
        invocation({
          status: 'succeeded',
          resultPreview: {
            text: '{"answer":42}',
            byteLength: 13,
            truncated: false
          },
          completedAt: 5
        })
      ]
    })
    client.synthesize.mockResolvedValue({
      runId: 'run-1',
      pendingInputId: 'pending-1',
      state: 'pending'
    })
    const wrapper = await mountPanel(summary, detail)

    await wrapper.get('[data-testid="workflow-synthesize"]').trigger('click')
    await flushPromises()

    expect(client.synthesize).toHaveBeenCalledWith('parent-1', 'run-1')
    expect(wrapper.get('[data-testid="workflow-synthesis-state"]').text()).toContain(
      'chat.workflow.states.synthesisQueued'
    )
    expect(wrapper.find('[data-testid="workflow-synthesize"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
