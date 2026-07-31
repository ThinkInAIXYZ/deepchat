import type Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database as NativeDatabase, nativeSqliteDescribeIf } from '../nativeSqliteHarness'
import type { JsonValue } from '@shared/contracts/common'
import type { WorkflowInvocation, WorkflowRun } from '@shared/workflow/domain'
import {
  WORKFLOW_RUNTIME_DEFAULT_LIMITS,
  WORKFLOW_RUNTIME_PROTOCOL_VERSION,
  type WorkflowGuestAgentRequest,
  type WorkflowInvocationOutcome,
  type WorkflowRuntimeCommand,
  type WorkflowRuntimeEvent
} from '@shared/workflow/runtimeProtocol'
import { WorkflowDatabase } from '@/workflow/data/database'
import { WorkflowInvocationsTable } from '@/workflow/data/tables/workflowInvocations'
import { WorkflowRunsTable } from '@/workflow/data/tables/workflowRuns'
import { WorkflowRepository } from '@/workflow/repository'
import { WorkflowRunAdmission } from '@/workflow/runAdmission'
import {
  WorkflowEffectConfirmationRequiredError,
  WorkflowService,
  type WorkflowChildExecutionPort,
  type WorkflowLaunchScopePort,
  type WorkflowServiceUpdate,
  type WorkflowUtilityHostPort
} from '@/workflow/service'
import type { WorkflowUtilityProcessHostOptions } from '@/workflow/runtime/workflowUtilityProcessHost'

const DatabaseCtor = NativeDatabase!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(NativeDatabase),
  'Workflow SQLite modules are unavailable'
)

type HostEventPayload = WorkflowRuntimeEvent extends infer Event
  ? Event extends WorkflowRuntimeEvent
    ? Omit<Event, 'protocolVersion' | 'runId'>
    : never
  : never

class FakeWorkflowHost implements WorkflowUtilityHostPort {
  readonly settlements: Array<{ requestId: string; outcome: WorkflowInvocationOutcome }> = []
  startCommand: Extract<WorkflowRuntimeCommand, { type: 'START' }> | null = null
  cancelReason: string | null = null
  shutdownCount = 0
  killCount = 0
  exitOnShutdown = true
  exitOnKill = true
  private exited = false

  constructor(readonly options: WorkflowUtilityProcessHostOptions) {}

  async start(command: Extract<WorkflowRuntimeCommand, { type: 'START' }>): Promise<void> {
    this.startCommand = command
  }

  settleInvocation(requestId: string, outcome: WorkflowInvocationOutcome): void {
    this.settlements.push({ requestId, outcome })
  }

  cancel(reason: string): void {
    this.cancelReason = reason
  }

  shutdown(): void {
    this.shutdownCount += 1
    if (this.exitOnShutdown) {
      this.exit(0, true)
    }
  }

  kill(): void {
    this.killCount += 1
    if (this.exitOnKill) {
      this.exit(1, true)
    }
  }

  emit(event: HostEventPayload): void {
    this.options.onEvent({
      ...event,
      protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
      runId: this.options.runId
    } as WorkflowRuntimeEvent)
  }

  exit(code = 1, expected = false): void {
    if (this.exited) {
      return
    }
    this.exited = true
    this.options.onExit({
      runId: this.options.runId,
      code,
      expected
    })
  }
}

describeIfSqlite('WorkflowService', () => {
  let db: Database.Database
  let repository: WorkflowRepository
  let hosts: FakeWorkflowHost[]
  let now: number
  let idSequence: number
  let services: WorkflowService[]

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    db.exec('CREATE TABLE new_sessions (id TEXT PRIMARY KEY)')
    db.prepare('INSERT INTO new_sessions (id) VALUES (?)').run('parent')
    new WorkflowRunsTable(db).createTable()
    new WorkflowInvocationsTable(db).createTable()
    repository = new WorkflowRepository(
      new WorkflowDatabase({
        getDatabase: () => db
      })
    )
    hosts = []
    now = 1_000
    idSequence = 0
    services = []
  })

  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all(services.map(async (service) => await service.stop()))
    db.close()
  })

  function createService(
    childExecutor: WorkflowChildExecutionPort = succeedingChildExecutor(),
    runAdmission = new WorkflowRunAdmission(4, 64),
    options: {
      cancelGraceMs?: number
      onUpdate?: (update: WorkflowServiceUpdate) => void
      launchScope?: WorkflowLaunchScopePort
    } = {}
  ): WorkflowService {
    const service = new WorkflowService({
      repository,
      childExecutor,
      runAdmission,
      launchScope: options.launchScope ?? {
        resolve: vi.fn(
          async (input): Promise<Awaited<ReturnType<WorkflowLaunchScopePort['resolve']>>> => ({
            workspacePath: '/repo',
            allowedAgentIds: [...new Set(input.allowedAgentIds)].sort(),
            capabilityScopeHash: 'a'.repeat(64),
            capabilities: ['Delegate with the current parent permission policy']
          })
        )
      },
      hostFactory: (hostOptions) => {
        const host = new FakeWorkflowHost(hostOptions)
        hosts.push(host)
        return host
      },
      now: () => now++,
      idFactory: () => `workflow-id-${++idSequence}`,
      cancelGraceMs: options.cancelGraceMs,
      onUpdate: options.onUpdate
    })
    service.start()
    services.push(service)
    return service
  }

  async function prepareAndLaunch(
    service: WorkflowService,
    options: {
      source?: string
      input?: JsonValue
      budget?: { maxTotalTokens?: number; maxExecutionMs?: number } | null
    } = {}
  ): Promise<WorkflowRun> {
    const approval = await service.prepareLaunch({
      parentSessionId: 'parent',
      scriptSource: options.source ?? 'return await agent("Do the work", { key: "work" })',
      input: options.input ?? null,
      allowedAgentIds: ['deepchat'],
      budget: options.budget ?? null
    })
    return await service.launch(approval.approvalId)
  }

  function succeedingChildExecutor(
    usage: Record<string, number> = { inputTokens: 3, outputTokens: 2, totalTokens: 5 }
  ): WorkflowChildExecutionPort {
    return {
      execute: vi.fn(async (invocationId: string) => {
        const invocation = repository.requireInvocation(invocationId)
        const childSessionId = `child-${invocation.id}`
        db.prepare('INSERT INTO new_sessions (id) VALUES (?)').run(childSessionId)
        repository.markInvocationAdmitted(invocation.id, now++)
        repository.attachChildSession(invocation.id, childSessionId, now++)
        repository.markInvocationRunning(invocation.id, now++)
        const run = repository.requireRun(invocation.runId)
        const receipt = {
          linkEntry: {
            sessionId: run.parentSessionId,
            entryId: 1
          },
          childSessionId,
          childHeadEntryId: 2,
          childEntryCount: 2,
          outcome: 'completed' as const
        }
        repository.recordInvocationTapeReceipt(invocation.id, receipt, now++)
        return repository.succeedInvocation(
          invocation.id,
          { text: `result:${invocation.callPath}` },
          receipt,
          usage,
          now++
        )
      })
    }
  }

  function createDormantRun(
    status: 'failed' | 'interrupted',
    budget: JsonValue | null = null
  ): WorkflowRun {
    const run = repository.createRun({
      id: `dormant-${++idSequence}`,
      parentSessionId: 'parent',
      workspacePath: '/repo',
      capabilityScopeHash: 'a'.repeat(64),
      scriptSource: 'return await agent("Do the work", { key: "work" })',
      input: null,
      limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS,
      allowedAgentIds: ['deepchat'],
      budget,
      now: now++
    })
    repository.startRun(run.id, now++)
    if (status === 'failed') {
      return repository.failRun(
        run.id,
        {
          code: 'WORKFLOW_TEST_FAILURE',
          message: 'test failure',
          retriable: true
        },
        now++
      )
    }
    repository.reconcileInterruptedRun(run.id, 'test interruption', now++)
    return repository.requireRun(run.id)
  }

  function request(callPath = 'root/agent/work'): WorkflowGuestAgentRequest {
    return {
      callPath,
      prompt: 'Do the work',
      options: {
        key: callPath.split('/').at(-1) ?? 'work'
      }
    }
  }

  async function waitForHost(index = 0): Promise<FakeWorkflowHost> {
    await vi.waitFor(() => expect(hosts.length).toBeGreaterThan(index))
    return hosts[index]
  }

  async function waitForRun(runId: string, status: WorkflowRun['status']): Promise<WorkflowRun> {
    await vi.waitFor(() => expect(repository.requireRun(runId).status).toBe(status))
    return repository.requireRun(runId)
  }

  it('launches one process, settles durable invocations, and persists final usage', async () => {
    const childExecutor = succeedingChildExecutor()
    const service = createService(childExecutor)
    const run = await prepareAndLaunch(service)
    const host = await waitForHost()

    expect(host.startCommand).toMatchObject({
      runId: run.id,
      source: run.scriptSource,
      input: null
    })
    host.emit({
      type: 'INVOKE_AGENT',
      requestId: 'request-1',
      request: request()
    })
    await vi.waitFor(() => expect(host.settlements).toHaveLength(1))
    expect(host.settlements[0]).toMatchObject({
      requestId: 'request-1',
      outcome: {
        status: 'success',
        value: { text: 'result:root/agent/work' }
      }
    })

    host.emit({
      type: 'COMPLETE',
      value: { summary: 'done' }
    })
    const succeeded = await waitForRun(run.id, 'succeeded')
    expect(succeeded).toMatchObject({
      result: { summary: 'done' },
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      resultDeliveryState: 'pending'
    })
    expect(host.shutdownCount).toBe(1)
    expect(childExecutor.execute).toHaveBeenCalledOnce()
  })

  it('revalidates the main-resolved workspace when consuming a launch approval', async () => {
    let workspacePath = '/repo'
    const service = createService(succeedingChildExecutor(), new WorkflowRunAdmission(1, 1), {
      launchScope: {
        resolve: vi.fn(async (input) => ({
          workspacePath,
          allowedAgentIds: input.allowedAgentIds,
          capabilityScopeHash: 'a'.repeat(64),
          capabilities: ['Delegate with the current parent permission policy']
        }))
      }
    })
    const approval = await service.prepareLaunch({
      parentSessionId: 'parent',
      scriptSource: 'return null',
      input: null,
      allowedAgentIds: ['deepchat']
    })
    workspacePath = '/other-repo'

    await expect(service.launch(approval.approvalId)).rejects.toThrow(
      'workspace changed after launch approval'
    )
    expect(repository.listRunsByParent('parent')).toEqual([])
    expect(hosts).toEqual([])
  })

  it('invalidates approval when the effective child capability scope changes', async () => {
    let capabilityScopeHash = 'a'.repeat(64)
    const service = createService(succeedingChildExecutor(), new WorkflowRunAdmission(1, 1), {
      launchScope: {
        resolve: vi.fn(async (input) => ({
          workspacePath: '/repo',
          allowedAgentIds: input.allowedAgentIds,
          capabilityScopeHash,
          capabilities: ['Delegate with the current parent permission policy']
        }))
      }
    })
    const approval = await service.prepareLaunch({
      parentSessionId: 'parent',
      scriptSource: 'return null',
      input: null,
      allowedAgentIds: ['deepchat']
    })
    capabilityScopeHash = 'b'.repeat(64)

    await expect(service.launch(approval.approvalId)).rejects.toThrow(
      'capability scope changed after launch approval'
    )
    expect(repository.listRunsByParent('parent')).toEqual([])
  })

  it('fails the whole run when capability scope changes before a child dispatch', async () => {
    let capabilityScopeHash = 'a'.repeat(64)
    const childExecutor = succeedingChildExecutor()
    const service = createService(childExecutor, new WorkflowRunAdmission(1, 1), {
      launchScope: {
        resolve: vi.fn(async (input) => ({
          workspacePath: '/repo',
          allowedAgentIds: input.allowedAgentIds,
          capabilityScopeHash,
          capabilities: ['Delegate with the current parent permission policy']
        }))
      }
    })
    const run = await prepareAndLaunch(service)
    const host = await waitForHost()
    capabilityScopeHash = 'b'.repeat(64)

    host.emit({
      type: 'INVOKE_AGENT',
      requestId: 'scope-changed',
      request: request()
    })

    const failed = await waitForRun(run.id, 'failed')
    expect(failed.error).toMatchObject({
      code: 'WORKFLOW_CAPABILITY_SCOPE_CHANGED',
      retriable: false
    })
    expect(childExecutor.execute).not.toHaveBeenCalled()
  })

  it('fails a resumed run before starting a utility when its durable scope changed', async () => {
    const dormant = createDormantRun('failed')
    const service = createService(succeedingChildExecutor(), new WorkflowRunAdmission(1, 1), {
      launchScope: {
        resolve: vi.fn(async (input) => ({
          workspacePath: '/repo',
          allowedAgentIds: input.allowedAgentIds,
          capabilityScopeHash: 'b'.repeat(64),
          capabilities: ['Delegate with the current parent permission policy']
        }))
      }
    })

    service.resume(dormant.id)

    await vi.waitFor(() =>
      expect(repository.requireRun(dormant.id).error?.code).toBe(
        'WORKFLOW_CAPABILITY_SCOPE_CHANGED'
      )
    )
    const failed = repository.requireRun(dormant.id)
    expect(failed.error).toMatchObject({
      code: 'WORKFLOW_CAPABILITY_SCOPE_CHANGED',
      retriable: false
    })
    expect(hosts).toEqual([])
  })

  it('keeps utility processes behind a separate active and queued bound', async () => {
    const admission = new WorkflowRunAdmission(1, 1)
    const service = createService(succeedingChildExecutor(), admission)
    const first = await prepareAndLaunch(service, { input: { order: 1 } })
    const second = await prepareAndLaunch(service, { input: { order: 2 } })
    const firstHost = await waitForHost(0)

    await Promise.resolve()
    expect(hosts).toHaveLength(1)
    expect(repository.requireRun(first.id).status).toBe('running')
    expect(repository.requireRun(second.id).status).toBe('queued')
    expect(admission.snapshot()).toMatchObject({ active: 1, pending: 1 })

    firstHost.emit({ type: 'COMPLETE', value: null })
    await waitForRun(first.id, 'succeeded')
    await waitForHost(1)
    expect(repository.requireRun(second.id).status).toBe('running')
  })

  it('reconciles active work and restarts only never-started queued runs on startup', async () => {
    const interrupted = repository.createRun({
      id: 'startup-active',
      parentSessionId: 'parent',
      workspacePath: '/repo',
      capabilityScopeHash: 'a'.repeat(64),
      scriptSource: 'return await agent("active", { key: "active" })',
      input: null,
      limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS,
      allowedAgentIds: ['deepchat'],
      now: now++
    })
    repository.startRun(interrupted.id, now++)
    const activeInvocation = repository.createInvocation({
      id: 'startup-active-invocation',
      runId: interrupted.id,
      request: request('root/agent/active'),
      now: now++
    })
    const queued = repository.createRun({
      id: 'startup-queued',
      parentSessionId: 'parent',
      workspacePath: '/repo',
      capabilityScopeHash: 'a'.repeat(64),
      scriptSource: 'return null',
      input: null,
      limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS,
      allowedAgentIds: ['deepchat'],
      now: now++
    })

    createService()
    const host = await waitForHost()

    expect(repository.requireRun(interrupted.id).status).toBe('interrupted')
    expect(repository.requireInvocation(activeInvocation.id).status).toBe('interrupted')
    expect(repository.requireRun(queued.id).status).toBe('running')
    expect(host.startCommand?.runId).toBe(queued.id)
  })

  it('restores a durable queued resume in a new execution epoch on startup', async () => {
    const run = createDormantRun('interrupted')
    const queued = repository.queueRunResume(run.id, now++)
    expect(queued).toMatchObject({
      status: 'queued',
      executionEpoch: 1
    })

    createService()
    const host = await waitForHost()

    expect(host.startCommand?.runId).toBe(run.id)
    expect(repository.requireRun(run.id)).toMatchObject({
      status: 'running',
      executionEpoch: 2
    })
  })

  it('fails a persisted queued run when the bounded utility queue is full', async () => {
    const admission = new WorkflowRunAdmission(1, 0)
    const service = createService(succeedingChildExecutor(), admission)
    await prepareAndLaunch(service, { input: { order: 1 } })
    const rejected = await prepareAndLaunch(service, { input: { order: 2 } })
    await waitForHost(0)

    const failed = await waitForRun(rejected.id, 'failed')
    expect(failed.error).toMatchObject({
      code: 'WORKFLOW_RUN_QUEUE_UNAVAILABLE',
      retriable: true
    })
    expect(hosts).toHaveLength(1)
  })

  it('atomically interrupts the run and active invocations when the utility exits', async () => {
    let resolveChild!: (invocation: WorkflowInvocation) => void
    const childExecutor: WorkflowChildExecutionPort = {
      execute: vi.fn(
        async () =>
          await new Promise<WorkflowInvocation>((resolve) => {
            resolveChild = resolve
          })
      )
    }
    const service = createService(childExecutor)
    const run = await prepareAndLaunch(service)
    const host = await waitForHost()
    host.emit({
      type: 'INVOKE_AGENT',
      requestId: 'request-active',
      request: request()
    })
    await vi.waitFor(() => expect(repository.listInvocations(run.id)).toHaveLength(1))

    host.exit(17, false)

    const interrupted = await waitForRun(run.id, 'interrupted')
    expect(interrupted.error).toMatchObject({ code: 'WORKFLOW_INTERRUPTED' })
    const [invocation] = repository.listInvocations(run.id)
    expect(invocation).toMatchObject({
      status: 'interrupted',
      error: { code: 'WORKFLOW_INTERRUPTED' }
    })
    resolveChild(invocation)
  })

  it('defers an explicit resume until the previous utility has actually exited', async () => {
    const service = createService()
    const run = await prepareAndLaunch(service)
    const firstHost = await waitForHost()
    firstHost.exitOnShutdown = false

    firstHost.emit({
      type: 'FAILED',
      error: {
        code: 'WORKFLOW_TEST_FAILURE',
        message: 'retry me',
        retriable: true
      }
    })
    await waitForRun(run.id, 'failed')

    service.resume(run.id)
    expect(hosts).toHaveLength(1)
    expect(repository.requireRun(run.id).status).toBe('queued')

    firstHost.exit(0, true)
    await waitForHost(1)
    expect(repository.requireRun(run.id).status).toBe('running')
  })

  it('allows cancellation to withdraw a resume queued behind prior utility teardown', async () => {
    const admission = new WorkflowRunAdmission(1, 1)
    const service = createService(succeedingChildExecutor(), admission)
    const run = await prepareAndLaunch(service)
    const firstHost = await waitForHost()
    firstHost.exitOnShutdown = false
    firstHost.emit({
      type: 'FAILED',
      error: {
        code: 'WORKFLOW_TEST_FAILURE',
        message: 'retry me',
        retriable: true
      }
    })
    await waitForRun(run.id, 'failed')

    service.resume(run.id)
    service.cancel(run.id, 'Withdraw resume')
    firstHost.exit(0, true)
    await vi.waitFor(() => expect(admission.snapshot()).toMatchObject({ active: 0, pending: 0 }))

    expect(hosts).toHaveLength(1)
    expect(repository.requireRun(run.id).status).toBe('cancelled')
  })

  it('coalesces duplicate resume requests while the first resume is still queued', async () => {
    const admission = new WorkflowRunAdmission(1, 4)
    const service = createService(succeedingChildExecutor(), admission)
    const blocker = await prepareAndLaunch(service)
    const blockerHost = await waitForHost()
    const dormant = createDormantRun('failed')

    service.resume(dormant.id)
    service.resume(dormant.id)
    expect(admission.snapshot()).toMatchObject({ active: 1, pending: 1 })

    blockerHost.emit({ type: 'COMPLETE', value: null })
    await waitForRun(blocker.id, 'succeeded')
    const resumedHost = await waitForHost(1)
    resumedHost.emit({
      type: 'FAILED',
      error: {
        code: 'WORKFLOW_TEST_FAILURE',
        message: 'still failed',
        retriable: true
      }
    })
    await waitForRun(dormant.id, 'failed')
    await vi.waitFor(() => expect(admission.snapshot()).toMatchObject({ active: 0, pending: 0 }))

    expect(hosts).toHaveLength(2)
  })

  it('replays a successful invocation without creating another child', async () => {
    const run = repository.createRun({
      id: 'replay-run',
      parentSessionId: 'parent',
      workspacePath: '/repo',
      capabilityScopeHash: 'a'.repeat(64),
      scriptSource: 'return await agent("Do the work", { key: "work" })',
      input: null,
      limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS,
      allowedAgentIds: ['deepchat'],
      budget: { maxTotalTokens: 5 },
      now: now++
    })
    repository.startRun(run.id, now++)
    const existing = repository.createInvocation({
      id: 'replay-invocation',
      runId: run.id,
      request: request(),
      now: now++
    })
    await succeedingChildExecutor().execute(existing.id)
    repository.failRun(
      run.id,
      {
        code: 'WORKFLOW_AFTER_CHILD_FAILED',
        message: 'failed after child completion',
        retriable: true
      },
      now++
    )
    const childExecutor = succeedingChildExecutor()
    const service = createService(childExecutor)

    service.resume(run.id)
    const host = await waitForHost()
    host.emit({
      type: 'INVOKE_AGENT',
      requestId: 'replayed',
      request: request()
    })
    await vi.waitFor(() => expect(host.settlements).toHaveLength(1))

    expect(host.settlements[0].outcome).toEqual({
      status: 'success',
      value: { text: 'result:root/agent/work' }
    })
    expect(childExecutor.execute).not.toHaveBeenCalled()
    expect(repository.listInvocations(run.id)).toHaveLength(1)
  })

  it('rejects a duplicate active call path before allocating a second child', async () => {
    let resolveChild!: (invocation: WorkflowInvocation) => void
    const childExecutor: WorkflowChildExecutionPort = {
      execute: vi.fn(
        async () =>
          await new Promise<WorkflowInvocation>((resolve) => {
            resolveChild = resolve
          })
      )
    }
    const service = createService(childExecutor)
    const run = await prepareAndLaunch(service)
    const host = await waitForHost()
    host.emit({
      type: 'INVOKE_AGENT',
      requestId: 'first',
      request: request()
    })
    await vi.waitFor(() => expect(repository.listInvocations(run.id)).toHaveLength(1))

    host.emit({
      type: 'INVOKE_AGENT',
      requestId: 'duplicate',
      request: request()
    })
    await vi.waitFor(() => expect(host.settlements).toHaveLength(1))

    expect(host.settlements[0]).toMatchObject({
      requestId: 'duplicate',
      outcome: {
        status: 'error',
        error: { code: 'WORKFLOW_INVOCATION_ALREADY_ACTIVE', retriable: false }
      }
    })
    const [activeInvocation] = repository.listInvocations(run.id)
    host.exit(1, false)
    resolveChild(repository.requireInvocation(activeInvocation.id))
  })

  it('requires explicit confirmation before retrying interrupted write work', async () => {
    const run = repository.createRun({
      id: 'write-run',
      parentSessionId: 'parent',
      workspacePath: '/repo',
      capabilityScopeHash: 'a'.repeat(64),
      scriptSource: 'return await agent("Write the file", { key: "write" })',
      input: null,
      limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS,
      allowedAgentIds: ['deepchat'],
      now: now++
    })
    repository.startRun(run.id, now++)
    const invocation = repository.createInvocation({
      id: 'write-invocation',
      runId: run.id,
      request: request('root/agent/write'),
      now: now++
    })
    repository.markInvocationAdmitted(invocation.id, now++)
    repository.markInvocationRunning(invocation.id, now++)
    repository.recordEffectIntent(
      invocation.id,
      'write',
      {
        toolId: 'write_file',
        source: 'builtin',
        basis: 'reviewed_contract',
        classification: 'write',
        reason: 'Writes a file'
      },
      now++
    )
    repository.reconcileInterruptedRun(run.id, 'crash', now++)
    const childExecutor = succeedingChildExecutor()
    const service = createService(childExecutor)

    service.resume(run.id)
    const firstHost = await waitForHost()
    firstHost.emit({
      type: 'INVOKE_AGENT',
      requestId: 'unsafe-replay',
      request: request('root/agent/write')
    })
    await vi.waitFor(() => expect(firstHost.settlements).toHaveLength(1))
    expect(firstHost.settlements[0].outcome).toMatchObject({
      status: 'error',
      error: { code: 'WORKFLOW_RETRY_CONFIRMATION_REQUIRED' }
    })
    firstHost.emit({
      type: 'FAILED',
      error: {
        code: 'WORKFLOW_RETRY_CONFIRMATION_REQUIRED',
        message: 'confirmation required',
        retriable: true
      }
    })
    await waitForRun(run.id, 'failed')

    expect(() =>
      service.retryInvocation({
        runId: run.id,
        invocationId: invocation.id
      })
    ).toThrow(WorkflowEffectConfirmationRequiredError)
    service.retryInvocation({
      runId: run.id,
      invocationId: invocation.id,
      confirmEffects: true
    })
    const secondHost = await waitForHost(1)
    secondHost.emit({
      type: 'INVOKE_AGENT',
      requestId: 'confirmed-retry',
      request: request('root/agent/write')
    })
    await vi.waitFor(() => expect(secondHost.settlements).toHaveLength(1))
    expect(secondHost.settlements[0].outcome.status).toBe('success')
    expect(repository.listInvocations(run.id)).toHaveLength(2)
  })

  it('stops scheduling after the durable token budget is exhausted', async () => {
    const run = createDormantRun('failed', { maxTotalTokens: 5 })
    repository.resumeRun(run.id, now++)
    const prior = repository.createInvocation({
      id: 'budget-prior',
      runId: run.id,
      request: request('root/agent/prior'),
      now: now++
    })
    await succeedingChildExecutor({ totalTokens: 5 }).execute(prior.id)
    repository.failRun(
      run.id,
      {
        code: 'WORKFLOW_CONTINUE',
        message: 'continue later',
        retriable: true
      },
      now++
    )
    const childExecutor = succeedingChildExecutor()
    const service = createService(childExecutor)

    service.resume(run.id)
    const host = await waitForHost()
    host.emit({
      type: 'INVOKE_AGENT',
      requestId: 'over-budget',
      request: request('root/agent/next')
    })
    await vi.waitFor(() => expect(host.settlements).toHaveLength(1))

    expect(host.settlements[0].outcome).toMatchObject({
      status: 'error',
      error: { code: 'WORKFLOW_TOKEN_BUDGET_EXCEEDED', retriable: false }
    })
    expect(childExecutor.execute).not.toHaveBeenCalled()
    expect(repository.listInvocations(run.id)).toHaveLength(1)
  })

  it('requires confirmation for downstream effects when retrying from an earlier node', async () => {
    const run = repository.createRun({
      id: 'downstream-effects-run',
      parentSessionId: 'parent',
      workspacePath: '/repo',
      capabilityScopeHash: 'a'.repeat(64),
      scriptSource: 'return await agent("Do the work", { key: "work" })',
      input: null,
      limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS,
      allowedAgentIds: ['deepchat'],
      now: now++
    })
    repository.startRun(run.id, now++)
    const first = repository.createInvocation({
      id: 'read-first',
      runId: run.id,
      request: request('root/agent/read'),
      now: now++
    })
    await succeedingChildExecutor().execute(first.id)
    const second = repository.createInvocation({
      id: 'write-second',
      runId: run.id,
      request: request('root/agent/write'),
      now: now++
    })
    repository.markInvocationAdmitted(second.id, now++)
    repository.markInvocationRunning(second.id, now++)
    repository.recordEffectIntent(
      second.id,
      'unknown',
      {
        toolId: 'third_party_tool',
        source: 'unknown',
        basis: 'conservative_fallback',
        classification: 'unknown',
        reason: 'No reviewed effect contract'
      },
      now++
    )
    repository.failInvocation(
      second.id,
      {
        status: 'failed',
        error: {
          code: 'TOOL_FAILED',
          message: 'tool failed',
          retriable: true
        }
      },
      now++
    )
    repository.failRun(
      run.id,
      {
        code: 'WORKFLOW_FAILED',
        message: 'workflow failed',
        retriable: true
      },
      now++
    )
    const service = createService()

    expect(() =>
      service.retryInvocation({
        runId: run.id,
        invocationId: first.id,
        fromHere: true
      })
    ).toThrow(WorkflowEffectConfirmationRequiredError)
    expect(repository.requireInvocation(first.id).invalidatedAt).toBeNull()
    expect(repository.requireInvocation(second.id).invalidatedAt).toBeNull()
  })

  it('cancels a queued run without ever spawning its utility process', async () => {
    const admission = new WorkflowRunAdmission(1, 1)
    const service = createService(succeedingChildExecutor(), admission)
    await prepareAndLaunch(service, { input: { order: 1 } })
    const queued = await prepareAndLaunch(service, { input: { order: 2 } })
    await waitForHost()

    const cancelled = service.cancel(queued.id, 'No longer needed')

    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'No longer needed'
    })
    await Promise.resolve()
    expect(hosts).toHaveLength(1)
  })

  it('forces active cancellation to one atomic terminal state after the grace period', async () => {
    vi.useFakeTimers()
    const childExecutor: WorkflowChildExecutionPort = {
      execute: vi.fn(
        async (_invocationId, options) =>
          await new Promise<WorkflowInvocation>((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => reject(new Error('child ignored cancellation')),
              { once: true }
            )
          })
      )
    }
    const service = createService(childExecutor, new WorkflowRunAdmission(1, 1), {
      cancelGraceMs: 100
    })
    const run = await prepareAndLaunch(service)
    const host = await waitForHost()
    host.emit({
      type: 'INVOKE_AGENT',
      requestId: 'active',
      request: request()
    })
    await vi.waitFor(() => expect(repository.listInvocations(run.id)).toHaveLength(1))

    service.cancel(run.id, 'Stop now')
    await vi.advanceTimersByTimeAsync(100)

    expect(repository.requireRun(run.id)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'Stop now'
    })
    expect(repository.listInvocations(run.id)[0]).toMatchObject({
      status: 'cancelled',
      error: { code: 'WORKFLOW_CANCELLED' }
    })
    expect(host.killCount).toBe(1)
    vi.useRealTimers()
  })

  it('does not create a child for an invocation arriving after cancellation starts', async () => {
    const childExecutor = succeedingChildExecutor()
    const service = createService(childExecutor)
    const run = await prepareAndLaunch(service)
    const host = await waitForHost()

    service.cancel(run.id, 'Stop before dispatch')
    host.emit({
      type: 'INVOKE_AGENT',
      requestId: 'late-after-cancel',
      request: request()
    })
    await vi.waitFor(() => expect(host.settlements).toHaveLength(1))

    expect(host.settlements[0].outcome).toMatchObject({
      status: 'error',
      error: {
        code: 'WORKFLOW_RUN_STOPPED',
        message: 'Stop before dispatch'
      }
    })
    expect(childExecutor.execute).not.toHaveBeenCalled()
    expect(repository.listInvocations(run.id)).toEqual([])

    host.emit({
      type: 'FAILED',
      error: {
        code: 'WORKFLOW_CANCELLED',
        message: 'Stop before dispatch',
        retriable: true
      }
    })
    await waitForRun(run.id, 'cancelled')
  })

  it('fails an execution epoch when its host-owned wall-clock budget expires', async () => {
    vi.useFakeTimers()
    const service = createService()
    const run = await prepareAndLaunch(service, {
      budget: { maxExecutionMs: 1_000 }
    })
    await waitForHost()

    await vi.advanceTimersByTimeAsync(1_000)

    expect(repository.requireRun(run.id)).toMatchObject({
      status: 'failed',
      error: { code: 'WORKFLOW_EXECUTION_BUDGET_EXCEEDED' }
    })
    vi.useRealTimers()
  })

  it('isolates projection failures from durable run completion', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const onUpdate = vi.fn(() => {
      throw new Error('renderer unavailable')
    })
    const service = createService(succeedingChildExecutor(), new WorkflowRunAdmission(1, 1), {
      onUpdate
    })
    const run = await prepareAndLaunch(service)
    const host = await waitForHost()

    host.emit({ type: 'COMPLETE', value: { ok: true } })

    await waitForRun(run.id, 'succeeded')
    expect(onUpdate).toHaveBeenCalled()
    expect(warning).toHaveBeenCalled()
  })

  it('bounds service shutdown when a utility ignores termination', async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = createService()
    const run = await prepareAndLaunch(service)
    const host = await waitForHost()
    host.exitOnKill = false

    const stopPromise = service.stop()
    await vi.advanceTimersByTimeAsync(12_000)
    await stopPromise

    expect(repository.requireRun(run.id).status).toBe('interrupted')
    expect(host.killCount).toBe(1)
    expect(warning).toHaveBeenCalledWith(
      'Workflow utility processes did not exit before service shutdown.'
    )

    host.exit(1, true)
    await Promise.resolve()
    vi.useRealTimers()
  })

  it('still terminates utilities when shutdown-state persistence fails transiently', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reconcile = vi.spyOn(repository, 'reconcileInterruptedRun').mockImplementationOnce(() => {
      throw new Error('database temporarily unavailable')
    })
    const service = createService()
    const run = await prepareAndLaunch(service)
    const host = await waitForHost()

    await service.stop()

    expect(host.killCount).toBe(1)
    expect(reconcile).toHaveBeenCalledTimes(2)
    expect(repository.requireRun(run.id).status).toBe('interrupted')
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist shutdown interruption'),
      expect.any(Error)
    )
  })
})
