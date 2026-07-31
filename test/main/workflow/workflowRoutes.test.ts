import { describe, expect, it, vi } from 'vitest'
import {
  workflowInspectRoute,
  workflowLaunchRoute,
  workflowListRoute,
  workflowPrepareLaunchRoute,
  workflowRetryRoute,
  workflowSavedListRoute,
  workflowSavedPrepareLaunchRoute,
  workflowSavedReadRoute,
  workflowSavedSaveRoute,
  workflowSynthesizeRoute
} from '@shared/contracts/routes'
import { WORKFLOW_RUNTIME_DEFAULT_LIMITS } from '@shared/workflow/runtimeProtocol'
import type { WorkflowInvocation, WorkflowRun } from '@shared/workflow/domain'
import { createWorkflowRoutes } from '@/workflow/routes'
import type { WorkflowService } from '@/workflow/service'

const run = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: 'run-1',
  parentSessionId: 'parent-1',
  parentMessageId: null,
  namedWorkflowPath: null,
  workspacePath: '/repo',
  capabilityScopeHash: 'c'.repeat(64),
  scriptSource: 'return null',
  scriptHash: 'a'.repeat(64),
  input: null,
  runtimeApiVersion: 1,
  limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS,
  allowedAgentIds: ['deepchat'],
  policyHash: 'b'.repeat(64),
  budget: null,
  status: 'queued',
  executionEpoch: 1,
  nextInvocationSeq: 1,
  phase: null,
  result: null,
  error: null,
  usage: null,
  cancellationReason: null,
  interruptionReason: null,
  invalidatedFromSeq: null,
  resultDeliveryState: 'not_ready',
  resultDeliveryId: null,
  createdAt: 1,
  startedAt: null,
  updatedAt: 1,
  completedAt: null,
  revision: 0,
  ...overrides
})

const invocation = (overrides: Partial<WorkflowInvocation> = {}): WorkflowInvocation => ({
  id: 'invocation-1',
  runId: 'run-1',
  seq: 1,
  callPath: 'root/review',
  attempt: 1,
  executionEpoch: 1,
  request: {
    callPath: 'root/review',
    prompt: 'Review the change.',
    options: {
      key: 'review'
    }
  },
  inputHash: 'c'.repeat(64),
  policyHash: 'b'.repeat(64),
  childCorrelationSlot: 'workflow-run-1-invocation-1',
  childSessionId: 'child-1',
  status: 'waiting_interaction',
  timeoutDeadlineAt: null,
  result: null,
  error: null,
  effectState: 'none',
  effectEvidence: null,
  usage: null,
  tapeLinkReceipt: null,
  invalidatedAt: null,
  invalidationReason: null,
  createdAt: 2,
  startedAt: 3,
  updatedAt: 4,
  completedAt: null,
  ...overrides
})

function createService() {
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
  return {
    prepareLaunch: vi.fn().mockResolvedValue({
      approvalId: '50d6dbb8-45cb-4a76-af9c-9137cb4695ac',
      sourceHash: 'a'.repeat(64),
      scopeHash: 'b'.repeat(64),
      expiresAt: 10_000,
      summary: {
        workspacePath: '/repo',
        capabilityScopeHash: 'c'.repeat(64),
        allowedAgentIds: ['deepchat'],
        maxInvocations: WORKFLOW_RUNTIME_DEFAULT_LIMITS.maxInvocations,
        maxPendingInvocations: WORKFLOW_RUNTIME_DEFAULT_LIMITS.maxPendingInvocations,
        budget: null,
        capabilities: ['deepchat-child-sessions'],
        outline: {
          schemaVersion: 1,
          confidence: 'exact',
          truncated: false,
          nodes: []
        }
      }
    }),
    launch: vi.fn().mockResolvedValue(run()),
    listRuns: vi.fn().mockReturnValue([run()]),
    getRun: vi
      .fn()
      .mockImplementation((runId: string) =>
        run({ id: runId, parentSessionId: runId === 'foreign' ? 'parent-2' : 'parent-1' })
      ),
    listInvocations: vi.fn().mockReturnValue([]),
    getInvocationCounts: vi.fn(
      (runIds: readonly string[]) =>
        new Map(runIds.map((runId) => [runId, { ...invocationCounts }]))
    ),
    cancel: vi.fn().mockReturnValue(run({ status: 'cancelled', completedAt: 2 })),
    resume: vi.fn().mockReturnValue(run()),
    retryInvocation: vi.fn().mockReturnValue(run()),
    synthesize: vi.fn().mockResolvedValue({
      runId: 'run-1',
      pendingInputId: 'pending-1',
      state: 'pending'
    })
  } as unknown as WorkflowService
}

const context = { webContentsId: 1, windowId: 1 }

describe('workflow routes', () => {
  it('validates prepare and binds launch to the declared parent session', async () => {
    const service = createService()
    const routes = createWorkflowRoutes(service)
    const prepare = routes.get(workflowPrepareLaunchRoute.name)!
    const launch = routes.get(workflowLaunchRoute.name)!

    await expect(
      prepare(
        {
          parentSessionId: 'parent-1',
          scriptSource: 'return null',
          input: null,
          allowedAgentIds: ['deepchat']
        },
        context
      )
    ).resolves.toMatchObject({
      approval: {
        approvalId: '50d6dbb8-45cb-4a76-af9c-9137cb4695ac'
      }
    })

    await launch(
      {
        parentSessionId: 'parent-1',
        approvalId: '50d6dbb8-45cb-4a76-af9c-9137cb4695ac'
      },
      context
    )
    expect(service.launch).toHaveBeenCalledWith('50d6dbb8-45cb-4a76-af9c-9137cb4695ac', 'parent-1')
  })

  it('returns bounded projections without source or input', async () => {
    const service = createService()
    const routes = createWorkflowRoutes(service)
    const list = routes.get(workflowListRoute.name)!
    const inspect = routes.get(workflowInspectRoute.name)!

    const listed = await list({ parentSessionId: 'parent-1', limit: 20 }, context)
    const inspected = await inspect({ parentSessionId: 'parent-1', runId: 'run-1' }, context)

    expect(listed).toMatchObject({
      runs: [{ id: 'run-1', schemaVersion: 1 }]
    })
    expect(inspected).toMatchObject({
      run: { id: 'run-1', invocations: [] }
    })
    expect(JSON.stringify({ listed, inspected })).not.toContain('return null')
  })

  it('injects only pending child interaction summaries into inspection', async () => {
    const service = createService()
    vi.mocked(service.listInvocations).mockReturnValue([
      invocation(),
      invocation({
        id: 'invocation-2',
        seq: 2,
        callPath: 'root/done',
        childSessionId: 'child-2',
        status: 'succeeded',
        result: { text: 'done' },
        completedAt: 5
      })
    ])
    const resolveWaitingInteractions = vi.fn().mockReturnValue([
      {
        kind: 'permission',
        messageId: 'message-1',
        toolCallId: 'tool-call-1',
        toolName: 'write_file',
        label: 'Allow write_file'
      }
    ])
    const routes = createWorkflowRoutes(service, { resolveWaitingInteractions })
    const inspect = routes.get(workflowInspectRoute.name)!

    const inspected = await inspect({ parentSessionId: 'parent-1', runId: 'run-1' }, context)

    expect(resolveWaitingInteractions).toHaveBeenCalledOnce()
    expect(resolveWaitingInteractions).toHaveBeenCalledWith('child-1')
    expect(inspected.run.invocations[0].waitingInteractions).toEqual([
      expect.objectContaining({
        kind: 'permission',
        toolCallId: 'tool-call-1'
      })
    ])
    expect(inspected.run.invocations[1].waitingInteractions).toEqual([])
  })

  it('rejects cross-session inspection and mutation before calling the service action', async () => {
    const service = createService()
    const routes = createWorkflowRoutes(service)
    const inspect = routes.get(workflowInspectRoute.name)!
    const retry = routes.get(workflowRetryRoute.name)!
    const synthesize = routes.get(workflowSynthesizeRoute.name)!

    await expect(
      inspect({ parentSessionId: 'parent-1', runId: 'foreign' }, context)
    ).rejects.toThrow('does not belong to session')
    await expect(
      retry(
        {
          parentSessionId: 'parent-1',
          runId: 'foreign',
          invocationId: 'invocation-1'
        },
        context
      )
    ).rejects.toThrow('does not belong to session')
    await expect(
      synthesize({ parentSessionId: 'parent-1', runId: 'foreign' }, context)
    ).rejects.toThrow('does not belong to session')
    expect(service.retryInvocation).not.toHaveBeenCalled()
    expect(service.synthesize).not.toHaveBeenCalled()
  })

  it('queues explicit parent synthesis for an owned run', async () => {
    const service = createService()
    const routes = createWorkflowRoutes(service)
    const synthesize = routes.get(workflowSynthesizeRoute.name)!

    await expect(
      synthesize({ parentSessionId: 'parent-1', runId: 'run-1' }, context)
    ).resolves.toEqual({
      receipt: {
        runId: 'run-1',
        pendingInputId: 'pending-1',
        state: 'pending'
      }
    })
    expect(service.synthesize).toHaveBeenCalledWith('run-1')
  })

  it('resolves saved workflows from the main-owned parent workspace', async () => {
    const service = createService()
    const savedDocument = {
      name: 'review',
      relativePath: '.deepchat/workflows/review.js',
      absolutePath: '/repo/.deepchat/workflows/review.js',
      sourceHash: 'd'.repeat(64),
      source: 'return await agent(input.prompt, { key: "review" })',
      byteLength: 51,
      updatedAt: 100
    }
    const store = {
      list: vi.fn().mockResolvedValue({
        directoryPath: '/repo/.deepchat/workflows',
        workflows: [
          {
            name: savedDocument.name,
            relativePath: savedDocument.relativePath,
            byteLength: savedDocument.byteLength,
            updatedAt: savedDocument.updatedAt
          }
        ]
      }),
      read: vi.fn().mockResolvedValue(savedDocument),
      save: vi.fn().mockResolvedValue(savedDocument)
    }
    const resolveContext = vi.fn().mockResolvedValue({
      workspacePath: '/repo',
      defaultAgentId: 'parent-agent'
    })
    const routes = createWorkflowRoutes(service, {
      savedWorkflows: {
        store,
        resolveContext
      }
    })

    await expect(
      routes.get(workflowSavedListRoute.name)!({ parentSessionId: 'parent-1' }, context)
    ).resolves.toMatchObject({
      directoryPath: '/repo/.deepchat/workflows',
      workflows: [{ name: 'review' }]
    })
    await expect(
      routes.get(workflowSavedReadRoute.name)!(
        { parentSessionId: 'parent-1', name: 'review' },
        context
      )
    ).resolves.toEqual({ workflow: savedDocument })
    await routes.get(workflowSavedSaveRoute.name)!(
      {
        parentSessionId: 'parent-1',
        name: 'review',
        source: savedDocument.source,
        expectedSourceHash: savedDocument.sourceHash
      },
      context
    )
    expect(store.save).toHaveBeenCalledWith({
      workspacePath: '/repo',
      name: 'review',
      source: savedDocument.source,
      expectedSourceHash: savedDocument.sourceHash
    })

    await routes.get(workflowSavedPrepareLaunchRoute.name)!(
      {
        parentSessionId: 'parent-1',
        name: 'review',
        argsText: '{"prompt":"Inspect the change"}',
        expectedSourceHash: savedDocument.sourceHash
      },
      context
    )
    expect(service.prepareLaunch).toHaveBeenCalledWith(
      {
        parentSessionId: 'parent-1',
        namedWorkflowPath: savedDocument.absolutePath,
        scriptSource: savedDocument.source,
        input: {
          prompt: 'Inspect the change'
        },
        allowedAgentIds: ['parent-agent']
      },
      {
        expectedWorkspacePath: '/repo'
      }
    )
    expect(resolveContext).toHaveBeenCalledWith('parent-1')

    store.read.mockResolvedValueOnce({
      ...savedDocument,
      sourceHash: 'e'.repeat(64),
      source: 'return "changed outside DeepChat"'
    })
    await expect(
      routes.get(workflowSavedPrepareLaunchRoute.name)!(
        {
          parentSessionId: 'parent-1',
          name: 'review',
          argsText: '{}',
          expectedSourceHash: savedDocument.sourceHash
        },
        context
      )
    ).rejects.toThrow('changed since it was loaded')
    expect(service.prepareLaunch).toHaveBeenCalledTimes(1)
  })

  it('rejects unsafe saved-workflow args before preparing an approval', async () => {
    const service = createService()
    const routes = createWorkflowRoutes(service, {
      savedWorkflows: {
        store: {
          list: vi.fn(),
          read: vi.fn().mockResolvedValue({
            name: 'review',
            relativePath: '.deepchat/workflows/review.js',
            absolutePath: '/repo/.deepchat/workflows/review.js',
            sourceHash: 'd'.repeat(64),
            source: 'return null',
            byteLength: 11,
            updatedAt: 100
          }),
          save: vi.fn()
        },
        resolveContext: vi.fn().mockResolvedValue({
          workspacePath: '/repo',
          defaultAgentId: 'parent-agent'
        })
      }
    })

    await expect(
      routes.get(workflowSavedPrepareLaunchRoute.name)!(
        {
          parentSessionId: 'parent-1',
          name: 'review',
          argsText: '{"__proto__":{"polluted":true}}',
          expectedSourceHash: 'd'.repeat(64)
        },
        context
      )
    ).rejects.toThrow('unsafe key')
    expect(service.prepareLaunch).not.toHaveBeenCalled()
  })
})
