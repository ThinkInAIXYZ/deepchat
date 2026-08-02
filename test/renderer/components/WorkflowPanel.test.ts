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
  let invocationChanged:
    | ((payload: {
        schemaVersion: 1
        parentSessionId: string
        runId: string
        invocation: WorkflowInvocationProjection
      }) => void)
    | null = null
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
    onInvocationChanged: vi.fn((listener: typeof invocationChanged) => {
      invocationChanged = listener
      return vi.fn()
    }),
    emitRunChanged(run: WorkflowRunSummary) {
      runChanged?.({ schemaVersion: 1, run })
    },
    emitInvocationChanged(next: WorkflowInvocationProjection) {
      invocationChanged?.({
        schemaVersion: 1,
        parentSessionId: 'parent-1',
        runId: next.runId,
        invocation: next
      })
    },
    reset() {
      runChanged = null
      invocationChanged = null
    }
  }
})

vi.mock('@api/WorkflowClient', () => ({
  createWorkflowClient: () => client
}))

vi.mock('@/components/sidepanel/SavedWorkflowPanel.vue', () => ({
  default: defineComponent({
    name: 'SavedWorkflowPanel',
    props: {
      invocationRequest: {
        type: Object,
        default: null
      }
    },
    emits: ['launched', 'consumed'],
    template:
      '<button data-testid="saved-workflow-panel-stub" @click="$emit(\'consumed\', invocationRequest?.id)">Saved</button>'
  })
}))

vi.mock('@/components/sidepanel/LiveDelegationPanel.vue', () => ({
  default: defineComponent({
    name: 'LiveDelegationPanel',
    emits: ['countChanged'],
    template: '<div data-testid="live-delegation-panel-stub" />'
  })
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
    outline: {
      schemaVersion: 1,
      confidence: 'exact',
      truncated: false,
      nodes: []
    },
    resultPreview: null,
    invalidatedFromSeq: null,
    invocations: [invocation()],
    ...overrides
  }
}

async function mountPanel(
  summary: WorkflowRunSummary,
  detail: WorkflowRunDetail,
  selectedRunId?: string,
  savedInvocationRequest?: { id: number; name: string; argsText: string },
  savedWorkflowsEnabled = true,
  expanded = true
) {
  client.list.mockResolvedValue([summary])
  client.inspect.mockResolvedValue(detail)
  const wrapper = mount(WorkflowPanel, {
    props: {
      sessionId: 'parent-1',
      expanded,
      selectedRunId,
      savedInvocationRequest,
      savedWorkflowsEnabled
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

  it('forwards saved Workflow requests and consumption acknowledgements', async () => {
    const summary = runSummary()
    const detail = runDetail(summary)
    const request = {
      id: 12,
      name: 'review',
      argsText: '{}'
    }
    const wrapper = await mountPanel(summary, detail, undefined, request)
    const savedPanel = wrapper.getComponent({ name: 'SavedWorkflowPanel' })

    expect(savedPanel.props('invocationRequest')).toEqual(request)
    await savedPanel.trigger('click')

    expect(wrapper.emitted('consumeSavedInvocation')).toEqual([[12]])
  })

  it('hides saved Workflow authoring for an incompatible parent without hiding run history', async () => {
    const summary = runSummary()
    const detail = runDetail(summary)
    const wrapper = await mountPanel(summary, detail, undefined, undefined, false)

    expect(wrapper.findComponent({ name: 'SavedWorkflowPanel' }).exists()).toBe(false)
    expect(wrapper.get('[data-testid="workflow-run-list"]').exists()).toBe(true)
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

    client.emitInvocationChanged(
      invocation({
        status: 'running',
        waitingInteractions: [],
        updatedAt: 5
      })
    )
    client.emitRunChanged({
      ...summary,
      revision: 2,
      status: 'running',
      updatedAt: 4
    })
    await flushPromises()

    expect(client.inspect).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="workflow-run-detail"]').text()).not.toContain(
      'Which implementation should be used?'
    )
    wrapper.unmount()
  })

  it('renders the source outline before the first durable invocation appears', async () => {
    const summary = runSummary({
      invocationCounts: { ...invocationCounts }
    })
    const detail = runDetail(summary, {
      invocations: [],
      outline: {
        schemaVersion: 1,
        confidence: 'partial',
        truncated: false,
        nodes: [
          {
            id: 'outline-1',
            ordinal: 1,
            kind: 'map_limit',
            key: 'reviews',
            label: null,
            itemCount: 4,
            stageCount: null,
            concurrency: 2,
            dynamic: false
          }
        ]
      }
    })
    const wrapper = await mountPanel(summary, detail)

    expect(wrapper.get('[data-testid="workflow-static-outline"]').text()).toContain('partial')
    expect(wrapper.get('[data-testid="workflow-static-outline"]').text()).toContain(
      'mapLimit · reviews · ×4 · ≤2'
    )
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

  it('keeps the last durable detail visible when a manual refresh fails', async () => {
    const summary = runSummary()
    const detail = runDetail(summary)
    const wrapper = await mountPanel(summary, detail)

    client.inspect.mockRejectedValueOnce(new Error('temporary inspect failure'))
    await wrapper.get('[aria-label="chat.workflow.actions.refresh"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="workflow-run-detail"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="workflow-detail-error"]').text()).toContain(
      'common.error.requestFailed'
    )
    wrapper.unmount()
  })

  it('merges invocation deltas by identity and ignores older updates', async () => {
    const summary = runSummary()
    const detail = runDetail(summary, {
      invocations: [invocation({ updatedAt: 10 })]
    })
    const wrapper = await mountPanel(summary, detail)

    client.emitInvocationChanged(
      invocation({
        status: 'waiting_interaction',
        waitingInteractions: [
          {
            kind: 'question',
            messageId: 'new-message',
            toolCallId: 'new-question',
            toolName: 'ask_user',
            label: 'Newest interaction'
          }
        ],
        updatedAt: 20
      })
    )
    client.emitInvocationChanged(
      invocation({
        status: 'running',
        waitingInteractions: [],
        updatedAt: 15
      })
    )
    await flushPromises()

    expect(wrapper.get('[data-testid="workflow-run-detail"]').text()).toContain(
      'Newest interaction'
    )
    expect(client.inspect).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('refreshes detail once when a successful run exposes its final result', async () => {
    const summary = runSummary()
    const detail = runDetail(summary)
    const succeededSummary = runSummary({
      status: 'succeeded',
      resultDeliveryState: 'pending',
      invocationCounts: { ...invocationCounts, succeeded: 1 },
      revision: 2,
      updatedAt: 6,
      completedAt: 6
    })
    const wrapper = await mountPanel(summary, detail)
    client.inspect.mockResolvedValueOnce(
      runDetail(succeededSummary, {
        resultPreview: {
          text: '{"summary":"done"}',
          byteLength: 18,
          truncated: false
        },
        invocations: [invocation({ status: 'succeeded', updatedAt: 5, completedAt: 5 })]
      })
    )

    client.emitRunChanged(succeededSummary)
    await flushPromises()

    expect(client.inspect).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="workflow-run-detail"]').text()).toContain(
      '{"summary":"done"}'
    )
    wrapper.unmount()
  })

  it('does not inspect details while collapsed and refreshes once when expanded', async () => {
    const summary = runSummary()
    const detail = runDetail(summary)
    const wrapper = await mountPanel(summary, detail, undefined, undefined, true, false)

    expect(client.list).toHaveBeenCalledOnce()
    expect(client.inspect).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('chat.orchestration.activityTitle')
    wrapper.getComponent({ name: 'LiveDelegationPanel' }).vm.$emit('countChanged', 3)
    await flushPromises()
    expect(wrapper.get('[data-testid="workflow-panel"] > button').text()).toContain('4')

    client.emitRunChanged({ ...summary, revision: 2, updatedAt: 4 })
    client.emitInvocationChanged(invocation({ status: 'succeeded', updatedAt: 5 }))
    await flushPromises()
    expect(client.inspect).not.toHaveBeenCalled()

    await wrapper.setProps({ expanded: true })
    await flushPromises()
    expect(client.inspect).toHaveBeenCalledOnce()
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
