import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { WORKFLOW_RUNTIME_DEFAULT_LIMITS } from '@shared/workflow/runtimeProtocol'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const workflowDatabaseModule = Database
  ? await import('@/workflow/data/database').catch(() => null)
  : null
const workflowRunsModule = Database
  ? await import('@/workflow/data/tables/workflowRuns').catch(() => null)
  : null
const workflowInvocationsModule = Database
  ? await import('@/workflow/data/tables/workflowInvocations').catch(() => null)
  : null
const workflowRepositoryModule = Database
  ? await import('@/workflow/repository').catch(() => null)
  : null

const DatabaseCtor = Database!
const WorkflowDatabaseCtor = workflowDatabaseModule?.WorkflowDatabase!
const WorkflowRunsTableCtor = workflowRunsModule?.WorkflowRunsTable!
const WorkflowInvocationsTableCtor = workflowInvocationsModule?.WorkflowInvocationsTable!
const WorkflowRepositoryCtor = workflowRepositoryModule?.WorkflowRepository!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(
    WorkflowDatabaseCtor &&
    WorkflowRunsTableCtor &&
    WorkflowInvocationsTableCtor &&
    WorkflowRepositoryCtor
  ),
  'Workflow persistence modules are unavailable'
)

describeIfSqlite('WorkflowRepository', () => {
  let db: InstanceType<typeof DatabaseCtor> | null
  let repository: InstanceType<typeof WorkflowRepositoryCtor>

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    db.exec('CREATE TABLE new_sessions (id TEXT PRIMARY KEY)')
    new WorkflowRunsTableCtor(db).createTable()
    new WorkflowInvocationsTableCtor(db).createTable()
    repository = new WorkflowRepositoryCtor(
      new WorkflowDatabaseCtor({
        getDatabase: () => db!
      })
    )
    addSession('parent')
  })

  afterEach(() => {
    db?.close()
    db = null
  })

  function addSession(id: string): void {
    db!.prepare('INSERT INTO new_sessions (id) VALUES (?)').run(id)
  }

  function createRun(id = 'run-1', now = 100) {
    return repository.createRun({
      id,
      parentSessionId: 'parent',
      workspacePath: '/repo',
      capabilityScopeHash: 'a'.repeat(64),
      scriptSource: 'return input',
      input: { z: 1, a: 2 },
      limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS,
      allowedAgentIds: ['writer', 'reader', 'writer'],
      now
    })
  }

  function createInvocation(
    runId: string,
    key: string,
    options: { id?: string; prompt?: string; timeoutMs?: number; now?: number } = {}
  ) {
    return repository.createInvocation({
      id: options.id ?? `invocation-${key}`,
      runId,
      request: {
        callPath: `root/${key}`,
        prompt: options.prompt ?? `Do ${key}`,
        options: options.timeoutMs == null ? { key } : { key, timeoutMs: options.timeoutMs }
      },
      now: options.now ?? 200
    })
  }

  function attachAndRun(invocationId: string, childSessionId: string, now = 300): void {
    addSession(childSessionId)
    repository.attachChildSession(invocationId, childSessionId, now)
    repository.markInvocationAdmitted(invocationId, now + 1)
    repository.markInvocationRunning(invocationId, now + 2)
  }

  function receipt(
    childSessionId: string,
    outcome: 'completed' | 'error' | 'cancelled' = 'completed'
  ) {
    return {
      linkEntry: {
        sessionId: 'parent',
        entryId: 9
      },
      childSessionId,
      childHeadEntryId: 14,
      childEntryCount: 5,
      outcome
    } as const
  }

  function effectEvidence(classification: 'read' | 'unknown' | 'write', toolId: string) {
    return {
      toolId,
      source: 'builtin' as const,
      basis: 'reviewed_contract' as const,
      classification,
      reason: `Reviewed ${classification} contract`
    }
  }

  it('stores a bounded immutable source and deterministic policy snapshot', () => {
    const run = createRun()

    expect(run).toMatchObject({
      id: 'run-1',
      input: { a: 2, z: 1 },
      allowedAgentIds: ['reader', 'writer'],
      status: 'queued',
      executionEpoch: 1,
      nextInvocationSeq: 1
    })
    expect(run.scriptHash).toBe(createHash('sha256').update('return input', 'utf8').digest('hex'))

    expect(() =>
      repository.createRun({
        id: 'orphan',
        parentSessionId: 'missing',
        workspacePath: '/repo',
        capabilityScopeHash: 'a'.repeat(64),
        scriptSource: 'return input',
        input: null,
        limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS,
        allowedAgentIds: ['reader']
      })
    ).toThrow('parent session does not exist')
    expect(() => repository.listRunsByParent('parent', Number.NaN)).toThrow()

    expect(() =>
      db!
        .prepare("UPDATE workflow_runs SET script_source = 'return 42' WHERE run_id = 'run-1'")
        .run()
    ).toThrow('workflow run snapshot is immutable')
    db!.exec('DROP TRIGGER trg_workflow_runs_immutable_snapshot')
    db!.prepare("UPDATE workflow_runs SET script_source = 'return 42' WHERE run_id = 'run-1'").run()
    expect(() => repository.startRun('run-1', 110)).toThrow('source hash mismatch')
  })

  it('preserves the first start time and requires explicit epoch advancement to resume', () => {
    createRun()
    expect(repository.startRun('run-1', 110).startedAt).toBe(110)
    expect(repository.setRunWaiting('run-1', 120).startedAt).toBe(110)
    repository.failRun(
      'run-1',
      {
        code: 'PROVIDER_FAILED',
        message: 'provider unavailable',
        retriable: true
      },
      130
    )

    const resumed = repository.resumeRun('run-1', 140)
    expect(resumed).toMatchObject({
      status: 'running',
      executionEpoch: 2,
      startedAt: 110,
      completedAt: null,
      error: null
    })
    expect(() => repository.resumeRun('run-1', 150)).toThrow('cannot be resumed')
    expect(() => repository.setRunWaiting('run-1', 1.5)).toThrow(
      'workflow transition time must be a non-negative integer'
    )
  })

  it('allocates audit sequences transactionally and isolates logical calls by epoch', () => {
    const run = createRun()
    repository.startRun(run.id, 110)

    const firstAlpha = createInvocation(run.id, 'alpha')
    expect(firstAlpha).toMatchObject({
      seq: 1,
      attempt: 1,
      executionEpoch: 1
    })
    expect(
      createInvocation(run.id, 'beta', {
        id: 'invocation-beta',
        now: 201
      })
    ).toMatchObject({
      seq: 2,
      attempt: 1,
      executionEpoch: 1
    })
    expect(() =>
      createInvocation(run.id, 'alpha', {
        id: 'duplicate-alpha',
        now: 202
      })
    ).toThrow()
    expect(repository.requireRun(run.id).nextInvocationSeq).toBe(3)

    repository.reconcileInterruptedRun(run.id, 'utility exited', 210)
    repository.resumeRun(run.id, 220)
    const secondAlpha = createInvocation(run.id, 'alpha', {
      id: 'invocation-alpha-2',
      now: 230
    })
    expect(secondAlpha).toMatchObject({
      seq: 3,
      attempt: 2,
      executionEpoch: 2
    })
    expect(secondAlpha.childCorrelationSlot).not.toBe(firstAlpha.childCorrelationSlot)
    expect(
      repository.getInvocationByCorrelationSlot(run.id, secondAlpha.childCorrelationSlot)
    ).toMatchObject({
      id: secondAlpha.id,
      attempt: 2
    })
    expect(
      createInvocation(run.id, 'gamma', {
        id: 'timed-invocation',
        timeoutMs: 1_000,
        now: 240
      })
    ).toMatchObject({
      seq: 4,
      timeoutDeadlineAt: 1_240
    })
    expect(() =>
      createInvocation(run.id, 'delta', {
        id: 'invalid-deadline',
        timeoutMs: 1.5
      })
    ).toThrow()
    expect(repository.requireRun(run.id).nextInvocationSeq).toBe(5)
  })

  it('aggregates bounded invocation counts without loading invocation payloads', () => {
    const run = createRun()
    repository.startRun(run.id, 110)
    const admitted = createInvocation(run.id, 'admitted')
    createInvocation(run.id, 'queued', { id: 'queued-invocation' })
    repository.markInvocationAdmitted(admitted.id, 210)

    expect(repository.getInvocationCounts([run.id]).get(run.id)).toMatchObject({
      queued: 1,
      admitted: 1,
      running: 0,
      succeeded: 0,
      failed: 0
    })
    expect(() =>
      repository.getInvocationCounts(Array.from({ length: 501 }, (_, index) => `run-${index}`))
    ).toThrow('limited to 500 runs')
  })

  it('enforces the host-side total invocation limit across attempts', () => {
    const run = repository.createRun({
      id: 'limited-run',
      parentSessionId: 'parent',
      workspacePath: '/repo',
      capabilityScopeHash: 'a'.repeat(64),
      scriptSource: 'return input',
      input: null,
      limits: {
        ...WORKFLOW_RUNTIME_DEFAULT_LIMITS,
        maxInvocations: 1,
        maxPendingInvocations: 1
      },
      allowedAgentIds: ['reader'],
      now: 100
    })
    repository.startRun(run.id, 110)
    createInvocation(run.id, 'first')

    expect(() =>
      createInvocation(run.id, 'second', {
        id: 'second-invocation',
        now: 201
      })
    ).toThrow('exceeds its 1-invocation limit')
    expect(repository.requireRun(run.id).nextInvocationSeq).toBe(2)
  })

  it('enforces the launch allowlist and pending limit before allocating child work', () => {
    const run = repository.createRun({
      id: 'bounded-run',
      parentSessionId: 'parent',
      workspacePath: '/repo',
      capabilityScopeHash: 'a'.repeat(64),
      scriptSource: 'return input',
      input: null,
      limits: {
        ...WORKFLOW_RUNTIME_DEFAULT_LIMITS,
        maxInvocations: 3,
        maxPendingInvocations: 1
      },
      allowedAgentIds: ['reader'],
      now: 100
    })
    repository.startRun(run.id, 110)

    expect(() =>
      repository.createInvocation({
        id: 'disallowed-invocation',
        runId: run.id,
        request: {
          callPath: 'root/disallowed',
          prompt: 'Do not launch',
          options: {
            key: 'disallowed',
            agentId: 'writer'
          }
        },
        now: 190
      })
    ).toThrow('outside the launch allowlist')
    expect(repository.requireRun(run.id).nextInvocationSeq).toBe(1)

    createInvocation(run.id, 'first', {
      id: 'bounded-first',
      now: 200
    })
    expect(() =>
      createInvocation(run.id, 'second', {
        id: 'bounded-second',
        now: 201
      })
    ).toThrow('exceeds its 1-pending-invocation limit')
    expect(repository.requireRun(run.id).nextInvocationSeq).toBe(2)
  })

  it('replays only the latest matching attempt, including recorded timeout failures', () => {
    const run = createRun()
    repository.startRun(run.id, 110)
    const first = createInvocation(run.id, 'alpha')
    attachAndRun(first.id, 'child-1')
    repository.succeedInvocation(first.id, null, receipt('child-1'), null, 310)

    expect(repository.findReplayOutcome(run.id, first.request)).toMatchObject({
      id: first.id,
      status: 'succeeded',
      result: null
    })

    repository.reconcileInterruptedRun(run.id, 'runtime restart', 320)
    repository.resumeRun(run.id, 330)
    const second = createInvocation(run.id, 'alpha', {
      id: 'invocation-alpha-2',
      now: 340
    })
    attachAndRun(second.id, 'child-2', 350)
    repository.failInvocation(
      second.id,
      {
        status: 'timed_out',
        error: {
          code: 'INVOCATION_TIMEOUT',
          message: 'deadline reached',
          retriable: true
        }
      },
      360,
      { totalTokens: 7 }
    )

    expect(repository.findReplayOutcome(run.id, second.request)).toMatchObject({
      id: second.id,
      status: 'timed_out',
      usage: { totalTokens: 7 },
      error: {
        code: 'INVOCATION_TIMEOUT'
      }
    })

    repository.failRun(
      run.id,
      {
        code: 'WORKFLOW_INVOCATION_FAILED',
        message: 'an invocation timed out',
        retriable: true
      },
      365
    )
    expect(() => repository.invalidateFrom(run.id, 99, 'missing boundary', 369)).toThrow(
      'has no invocation'
    )
    repository.invalidateFrom(run.id, second.seq, 'retry from here', 370)
    expect(repository.findReplayOutcome(run.id, second.request)).toBeNull()
  })

  it('persists monotonic effect intent and requires a matching completed Tape receipt', () => {
    const run = createRun()
    repository.startRun(run.id, 110)
    const invocation = createInvocation(run.id, 'write')
    attachAndRun(invocation.id, 'child-write')

    expect(() =>
      repository.recordEffectIntent(
        invocation.id,
        'read',
        {
          toolId: 'remote_search',
          source: 'mcp',
          basis: 'conservative_fallback',
          classification: 'read',
          reason: 'Untrusted remote metadata claimed this was read-only'
        },
        308
      )
    ).toThrow('Read-only recovery requires a reviewed built-in tool contract')
    expect(() =>
      repository.recordEffectIntent(
        invocation.id,
        'read',
        effectEvidence('write', 'write_file'),
        309
      )
    ).toThrow('classification does not match')
    repository.recordEffectIntent(invocation.id, 'read', effectEvidence('read', 'read_file'), 310)
    repository.recordEffectIntent(
      invocation.id,
      'write',
      effectEvidence('write', 'write_file'),
      311
    )
    const effect = repository.recordEffectIntent(
      invocation.id,
      'read',
      effectEvidence('read', 'read_file_after_write'),
      312
    )
    expect(effect).toMatchObject({
      effectState: 'write',
      effectEvidence: {
        classification: 'write',
        toolId: 'write_file'
      }
    })
    expect(repository.getInvocationByChildSessionId('child-write')).toMatchObject({
      id: invocation.id,
      runId: run.id
    })

    expect(() =>
      repository.succeedInvocation(
        invocation.id,
        { ok: true },
        receipt('child-write', 'error'),
        null,
        320
      )
    ).toThrow('not a completed outcome')
    expect(() =>
      repository.succeedInvocation(
        invocation.id,
        { ok: true },
        {
          ...receipt('child-write'),
          linkEntry: { sessionId: 'another-parent', entryId: 9 }
        },
        null,
        320
      )
    ).toThrow('parent does not match')
    expect(() =>
      repository.succeedInvocation(invocation.id, { ok: true }, receipt('another-child'), null, 320)
    ).toThrow('child does not match')
    expect(() =>
      repository.succeedInvocation(
        invocation.id,
        { ok: true },
        {
          ...receipt('child-write'),
          childHeadEntryId: 4,
          childEntryCount: 5
        },
        null,
        320
      )
    ).toThrow('entry count cannot exceed')

    const completedReceipt = receipt('child-write')
    repository.recordInvocationTapeReceipt(invocation.id, completedReceipt, 320)
    expect(() =>
      repository.succeedInvocation(
        invocation.id,
        { ok: true },
        {
          ...completedReceipt,
          childHeadEntryId: 15
        },
        null,
        320
      )
    ).toThrow('already has another Tape receipt')
    expect(
      repository.succeedInvocation(
        invocation.id,
        { ok: true },
        completedReceipt,
        { inputTokens: 10 },
        321
      )
    ).toMatchObject({
      status: 'succeeded',
      result: { ok: true },
      usage: { inputTokens: 10 }
    })
  })

  it('records an idempotent Tape receipt after a terminal child failure', () => {
    const run = createRun()
    repository.startRun(run.id, 110)
    const invocation = createInvocation(run.id, 'cancelled-child')
    attachAndRun(invocation.id, 'cancelled-child')
    repository.failInvocation(
      invocation.id,
      {
        status: 'cancelled',
        error: {
          code: 'INVOCATION_CANCELLED',
          message: 'cancelled by caller',
          retriable: false
        }
      },
      310
    )
    const cancelledReceipt = receipt('cancelled-child', 'cancelled')

    expect(
      repository.recordInvocationTapeReceipt(invocation.id, cancelledReceipt, 311)
    ).toMatchObject({
      status: 'cancelled',
      tapeLinkReceipt: cancelledReceipt
    })
    expect(
      repository.recordInvocationTapeReceipt(invocation.id, cancelledReceipt, 312)
    ).toMatchObject({
      tapeLinkReceipt: cancelledReceipt
    })
    expect(() =>
      repository.recordInvocationTapeReceipt(
        invocation.id,
        {
          ...cancelledReceipt,
          childHeadEntryId: 15
        },
        313
      )
    ).toThrow('already has another Tape receipt')
  })

  it('blocks late work after cancellation while retaining a crash-window child identity', () => {
    const run = createRun()
    repository.startRun(run.id, 110)
    const invocation = createInvocation(run.id, 'active')
    attachAndRun(invocation.id, 'active-child')

    expect(() =>
      repository.succeedRun(run.id, { summary: 'too early' }, 'early-delivery', null, 310)
    ).toThrow()
    expect(repository.requireRun(run.id).status).toBe('running')

    repository.setRunCancelling(run.id, 'user cancelled', 320)
    expect(() =>
      repository.recordEffectIntent(
        invocation.id,
        'write',
        effectEvidence('write', 'write_file'),
        321
      )
    ).toThrow('could not be persisted')
    expect(() =>
      repository.succeedInvocation(invocation.id, { ok: true }, receipt('active-child'), null, 322)
    ).toThrow()
    repository.failInvocation(
      invocation.id,
      {
        status: 'cancelled',
        error: {
          code: 'INVOCATION_CANCELLED',
          message: 'user cancelled',
          retriable: false
        }
      },
      323
    )
    expect(repository.cancelRun(run.id, 'user cancelled', 324).status).toBe('cancelled')

    const recoveryRun = createRun('recovery-run', 400)
    repository.startRun(recoveryRun.id, 410)
    const failedBeforeAttach = createInvocation(recoveryRun.id, 'crash-window', {
      id: 'crash-window-invocation',
      now: 420
    })
    repository.failInvocation(
      failedBeforeAttach.id,
      {
        status: 'failed',
        error: {
          code: 'CHILD_ATTACH_INTERRUPTED',
          message: 'main process exited after child creation',
          retriable: true
        }
      },
      421
    )
    addSession('recovered-child')
    expect(
      repository.attachChildSession(failedBeforeAttach.id, 'recovered-child', 422)
    ).toMatchObject({
      status: 'failed',
      childSessionId: 'recovered-child'
    })
  })

  it('atomically interrupts active work while leaving persisted queued runs untouched', () => {
    const active = createRun('active-run', 100)
    createRun('queued-run', 101)
    repository.startRun(active.id, 110)
    const queuedInvocation = createInvocation(active.id, 'queued')
    const runningInvocation = createInvocation(active.id, 'running', {
      id: 'running-invocation',
      now: 201
    })
    attachAndRun(runningInvocation.id, 'running-child')

    const result = repository.reconcileInterruptedRuns('application restarted', 300)

    expect(result).toEqual({
      runsInterrupted: 1,
      invocationsInterrupted: 2
    })
    expect(repository.requireRun(active.id)).toMatchObject({
      status: 'interrupted',
      interruptionReason: 'application restarted',
      completedAt: 300
    })
    expect(repository.requireInvocation(queuedInvocation.id)).toMatchObject({
      status: 'interrupted',
      completedAt: 300
    })
    expect(repository.requireInvocation(runningInvocation.id)).toMatchObject({
      status: 'interrupted',
      completedAt: 300
    })
    expect(repository.requireRun('queued-run')).toMatchObject({
      status: 'queued',
      completedAt: null
    })
  })

  it('delivers a terminal result idempotently without accepting another delivery identity', () => {
    createRun()
    repository.startRun('run-1', 110)
    expect(
      repository.succeedRun('run-1', { summary: 'done' }, 'delivery-1', null, 120)
    ).toMatchObject({
      status: 'succeeded',
      resultDeliveryState: 'pending',
      resultDeliveryId: 'delivery-1'
    })

    expect(repository.markResultDelivered('run-1', 'wrong-id', 130)).toBe(false)
    expect(repository.listPendingResultDeliveries()).toEqual([
      expect.objectContaining({
        id: 'run-1',
        resultDeliveryId: 'delivery-1'
      })
    ])
    expect(repository.markResultDelivered('run-1', 'delivery-1', 131)).toBe(true)
    expect(repository.markResultDelivered('run-1', 'delivery-1', 132)).toBe(true)
    expect(repository.requireRun('run-1').resultDeliveryState).toBe('delivered')
    expect(repository.listPendingResultDeliveries()).toEqual([])
  })

  it('enforces workflow references even when SQLite foreign keys are disabled', () => {
    db!.pragma('foreign_keys = OFF')
    expect(db!.pragma('foreign_keys', { simple: true })).toBe(0)
    const run = createRun()
    repository.startRun(run.id, 110)
    const invocation = createInvocation(run.id, 'child')
    attachAndRun(invocation.id, 'child-session')

    db!.prepare("DELETE FROM new_sessions WHERE id = 'child-session'").run()
    expect(repository.requireInvocation(invocation.id).childSessionId).toBe('child-session')

    db!.prepare("DELETE FROM new_sessions WHERE id = 'parent'").run()
    expect(repository.getRun(run.id)).toBeNull()
    expect(repository.listInvocations(run.id)).toEqual([])
  })

  it('prevents one child session from being attributed to two invocation attempts', () => {
    const run = createRun()
    repository.startRun(run.id, 110)
    const first = createInvocation(run.id, 'first')
    const second = createInvocation(run.id, 'second', {
      id: 'second-invocation',
      now: 201
    })
    addSession('shared-child')

    repository.attachChildSession(first.id, 'shared-child', 210)
    expect(() => repository.attachChildSession(second.id, 'shared-child', 211)).toThrow()
  })

  it('fails closed on semantically invalid JSON and database state', () => {
    createRun()
    db!
      .prepare(
        `UPDATE workflow_runs
         SET status = 'failed',
             error_json = '{}',
             completed_at = 200
         WHERE run_id = 'run-1'`
      )
      .run()
    expect(() => repository.getRun('run-1')).toThrow('Stored workflow error is invalid')

    expect(() =>
      db!
        .prepare(
          `UPDATE workflow_runs
           SET status = 'succeeded',
               error_json = NULL,
               completed_at = 200
           WHERE run_id = 'run-1'`
        )
        .run()
    ).toThrow()
    expect(() =>
      db!.prepare("UPDATE workflow_runs SET updated_at = 1.5 WHERE run_id = 'run-1'").run()
    ).toThrow()

    const healthyRun = createRun('healthy-run', 300)
    repository.startRun(healthyRun.id, 310)
    const invocation = createInvocation(healthyRun.id, 'hash-check', {
      id: 'hash-check-invocation',
      now: 320
    })
    db!.exec('DROP TRIGGER trg_workflow_invocations_immutable_identity')
    db!
      .prepare('UPDATE workflow_invocations SET input_hash = ? WHERE invocation_id = ?')
      .run('0'.repeat(64), invocation.id)
    expect(() => repository.requireInvocation(invocation.id)).toThrow('request hash mismatch')
  })
})
