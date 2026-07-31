import { describe, expect, it, vi } from 'vitest'
import {
  workflowInspectRoute,
  workflowLaunchRoute,
  workflowListRoute,
  workflowPrepareLaunchRoute,
  workflowRetryRoute,
  workflowSynthesizeRoute
} from '@shared/contracts/routes'
import { WORKFLOW_RUNTIME_DEFAULT_LIMITS } from '@shared/workflow/runtimeProtocol'
import type { WorkflowRun } from '@shared/workflow/domain'
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
        capabilities: ['deepchat-child-sessions']
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
})
