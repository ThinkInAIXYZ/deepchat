import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentInvocationAdmission } from '@/agent/invocationAdmission'
import { WorkflowInvocationContextRegistry } from '@/workflow/invocationContextRegistry'
import { createWorkflowChildLineageSlot } from '@/workflow/childIdentity'
import { WORKFLOW_RUNTIME_DEFAULT_LIMITS } from '@shared/workflow/runtimeProtocol'
import type { JsonValue } from '@shared/contracts/common'
import type { ConversationSessionInfo, CreateSubagentSessionInput } from '@/tool/runtimePorts'
import type { SessionRuntimeUpdate } from '@/session/runtimeEvents'
import type { WorkflowInvocation } from '@shared/workflow/domain'
import type {
  WorkflowStructuredOutputLease,
  WorkflowStructuredOutputPort
} from '@/workflow/structuredOutput/contracts'
import {
  WORKFLOW_STRUCTURED_OUTPUT_TOOL_NAME,
  WorkflowStructuredOutputRegistry
} from '@/workflow/structuredOutput/registry'
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
const childExecutorModule = Database
  ? await import('@/workflow/childExecutor').catch(() => null)
  : null

const DatabaseCtor = Database!
const WorkflowDatabaseCtor = workflowDatabaseModule?.WorkflowDatabase!
const WorkflowRunsTableCtor = workflowRunsModule?.WorkflowRunsTable!
const WorkflowInvocationsTableCtor = workflowInvocationsModule?.WorkflowInvocationsTable!
const WorkflowRepositoryCtor = workflowRepositoryModule?.WorkflowRepository!
const WorkflowChildExecutorCtor = childExecutorModule?.WorkflowChildExecutor!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(
    WorkflowDatabaseCtor &&
    WorkflowRunsTableCtor &&
    WorkflowInvocationsTableCtor &&
    WorkflowRepositoryCtor &&
    WorkflowChildExecutorCtor
  ),
  'Workflow child execution modules are unavailable'
)

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

const unavailableSubagents = {
  available: false,
  reason: 'unsupported_session',
  cacheKey: 'unavailable'
} as const

function parentSession(providerId = 'openai'): ConversationSessionInfo {
  return {
    sessionId: 'parent',
    agentId: 'deepchat',
    agentName: 'DeepChat',
    agentType: 'deepchat',
    providerId,
    modelId: providerId === 'acp' ? 'compat-agent' : 'model-1',
    projectDir: '/repo',
    permissionMode: 'default',
    generationSettings: null,
    disabledAgentTools: [],
    activeSkills: [],
    sessionKind: 'regular',
    parentSessionId: null,
    subagentMeta: null,
    subagentCapability: unavailableSubagents
  }
}

describeIfSqlite('WorkflowChildExecutor', () => {
  let db: InstanceType<typeof DatabaseCtor> | null
  let repository: InstanceType<typeof WorkflowRepositoryCtor>
  let contexts: WorkflowInvocationContextRegistry
  let sessions: ReturnType<typeof createSessionPort>
  let output: ReturnType<typeof createStructuredOutputPort>
  let now: number
  let capabilityScopeHash: string

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
    addSessionRow('parent')
    contexts = new WorkflowInvocationContextRegistry()
    sessions = createSessionPort(parentSession(), (invocationId) =>
      repository.getInvocation(invocationId)
    )
    sessions.addSessionRow = addSessionRow
    output = createStructuredOutputPort()
    now = 300
    capabilityScopeHash = 'a'.repeat(64)
  })

  afterEach(() => {
    vi.useRealTimers()
    db?.close()
    db = null
  })

  function addSessionRow(id: string): void {
    db!.prepare('INSERT INTO new_sessions (id) VALUES (?)').run(id)
  }

  function createRunAndInvocation(
    options: {
      runId?: string
      invocationId?: string
      agentId?: string
      timeoutMs?: number
      schema?: JsonValue
    } = {}
  ) {
    const runId = options.runId ?? 'run-1'
    const invocationId = options.invocationId ?? 'invocation-1'
    const run = repository.createRun({
      id: runId,
      parentSessionId: 'parent',
      workspacePath: '/repo',
      capabilityScopeHash: 'a'.repeat(64),
      scriptSource: 'return await agent("work", { key: "work" })',
      input: null,
      limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS,
      allowedAgentIds: ['deepchat', 'reviewer', 'direct-acp'],
      now: 100
    })
    repository.startRun(run.id, 110)
    const invocation = repository.createInvocation({
      id: invocationId,
      runId: run.id,
      request: {
        callPath: 'root/agent/work',
        prompt: 'Complete the delegated work.',
        options: {
          key: 'work',
          label: 'Workflow worker',
          ...(options.agentId ? { agentId: options.agentId } : {}),
          ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
          ...(options.schema ? { schema: options.schema } : {})
        }
      },
      now: 200
    })
    return { run, invocation }
  }

  function createExecutor(
    admission = new AgentInvocationAdmission(1, 8),
    structuredOutput: WorkflowStructuredOutputPort = output,
    onInvocationChanged?: (invocation: WorkflowInvocation) => void
  ) {
    return new WorkflowChildExecutorCtor({
      repository,
      sessions,
      admission,
      launchScope: {
        resolve: vi.fn(async (input) => ({
          workspacePath: '/repo',
          allowedAgentIds: [...new Set(input.allowedAgentIds)].sort(),
          capabilityScopeHash,
          capabilities: []
        }))
      },
      invocationContexts: contexts,
      structuredOutput,
      onInvocationChanged,
      now: () => now++
    })
  }

  it('creates, binds, observes interaction state, links Tape, and succeeds in order', async () => {
    const { invocation } = createRunAndInvocation()
    const setInteractionState = vi.spyOn(repository, 'setInvocationInteractionState')
    const setRunning = vi.spyOn(repository, 'markInvocationRunning')
    const onInvocationChanged = vi.fn()
    const admission = new AgentInvocationAdmission(1, 8)
    const acquire = vi.spyOn(admission, 'acquire')
    sessions.onSend = async (sessionId) => {
      expect(contexts.get(sessionId)).toEqual({
        runId: 'run-1',
        invocationId: invocation.id
      })
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'generating',
        updatedAt: 310
      })
      sessions.emit({
        sessionId,
        kind: 'blocks',
        responseMarkdown: 'Working',
        waitingInteraction: {
          type: 'question',
          messageId: 'message-1',
          toolCallId: 'question-1',
          actionBlock: {} as any
        },
        updatedAt: 311
      })
      sessions.emit({
        sessionId,
        kind: 'blocks',
        responseMarkdown: 'Still working',
        waitingInteraction: {
          type: 'question',
          messageId: 'message-1',
          toolCallId: 'question-1',
          actionBlock: {} as any
        },
        updatedAt: 312
      })
      sessions.emit({
        sessionId,
        kind: 'blocks',
        responseMarkdown: 'Done',
        waitingInteraction: null,
        updatedAt: 313
      })
      sessions.emit({
        sessionId,
        kind: 'blocks',
        responseMarkdown: 'Done',
        waitingInteraction: null,
        updatedAt: 314
      })
      output.current!.resolve({ answer: 42 })
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'idle',
        usage: { inputTokens: 7, outputTokens: 5, totalTokens: 12 },
        updatedAt: 315
      })
    }

    const result = await createExecutor(admission, output, onInvocationChanged).execute(
      invocation.id
    )

    expect(result).toMatchObject({
      status: 'succeeded',
      result: { answer: 42 },
      childSessionId: 'child-1',
      tapeLinkReceipt: {
        childSessionId: 'child-1',
        outcome: 'completed'
      },
      usage: { inputTokens: 7, outputTokens: 5, totalTokens: 12 }
    })
    expect(setInteractionState.mock.calls.map(([, waiting]) => waiting)).toEqual([true, false])
    expect(setRunning).toHaveBeenCalledOnce()
    expect(onInvocationChanged.mock.calls.map(([changed]) => changed.status)).toEqual(
      expect.arrayContaining(['admitted', 'running', 'waiting_interaction'])
    )
    expect(
      onInvocationChanged.mock.calls.some(([changed]) => changed.childSessionId === 'child-1')
    ).toBe(true)
    expect(sessions.createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        slotId: invocation.childCorrelationSlot,
        projectDir: '/repo',
        workflowContext: {
          runId: 'run-1',
          invocationId: invocation.id,
          correlationSlot: invocation.childCorrelationSlot,
          lineageSlot: createWorkflowChildLineageSlot('run-1', invocation.callPath)
        }
      })
    )
    expect(sessions.linkSubagentTape).toHaveBeenCalledWith(
      expect.objectContaining({
        childSessionId: 'child-1',
        taskId: invocation.id,
        outcome: 'completed',
        resultSummary: '{"answer":42}'
      })
    )
    expect(output.open).toHaveBeenCalledWith(
      expect.objectContaining({
        childSessionId: 'child-1',
        providerId: 'openai'
      })
    )
    expect(output.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        maxResultBytes: WORKFLOW_RUNTIME_DEFAULT_LIMITS.maxResultBytes
      })
    )
    expect(output.close).toHaveBeenCalledOnce()
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'workflow:run-1',
        maxActiveForOwner: 4
      })
    )
    expect(contexts.size).toBe(0)
  })

  it('revalidates durable scope after admission wait and fails before creating a child', async () => {
    const { invocation } = createRunAndInvocation()
    const admission = new AgentInvocationAdmission(1, 8)
    const blocker = await admission.acquire({ ownerId: 'other-work' })
    const execution = createExecutor(admission).execute(invocation.id)
    await vi.waitFor(() => expect(admission.snapshot().pending).toBe(1))

    capabilityScopeHash = 'b'.repeat(64)
    blocker.release()

    await expect(execution).rejects.toThrow('capability scope changed after launch')
    expect(repository.requireInvocation(invocation.id)).toMatchObject({
      status: 'failed',
      error: {
        code: 'WORKFLOW_CAPABILITY_SCOPE_CHANGED',
        retriable: false
      }
    })
    expect(sessions.createSubagentSession).not.toHaveBeenCalled()
  })

  it('coalesces duplicate execution requests without sending a second handoff', async () => {
    const { invocation } = createRunAndInvocation()
    const sent = deferred<void>()
    const allowCompletion = deferred<void>()
    sessions.onSend = async (sessionId) => {
      sent.resolve()
      await allowCompletion.promise
      output.current!.resolve({ answer: 42 })
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'idle',
        updatedAt: 315
      })
    }
    const executor = createExecutor()

    const first = executor.execute(invocation.id)
    const duplicate = executor.execute(invocation.id)

    expect(duplicate).toBe(first)
    await sent.promise
    allowCompletion.resolve()
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      expect.objectContaining({ status: 'succeeded' }),
      expect.objectContaining({ status: 'succeeded' })
    ])
    expect(sessions.createSubagentSession).toHaveBeenCalledOnce()
    expect(sessions.sendConversationMessage).toHaveBeenCalledOnce()
    expect(sessions.linkSubagentTape).toHaveBeenCalledOnce()
    expect(repository.requireInvocation(invocation.id).usage).toBeNull()
  })

  it('preserves observed usage when run interruption wins the terminal persistence race', async () => {
    const { run, invocation } = createRunAndInvocation()
    const linkStarted = deferred<void>()
    const allowLink = deferred<void>()
    sessions.linkSubagentTape.mockImplementation(async (input) => {
      linkStarted.resolve()
      await allowLink.promise
      return {
        linkEntry: {
          sessionId: input.parentSessionId,
          entryId: 1
        },
        childSessionId: input.childSessionId,
        childHeadEntryId: 2,
        childEntryCount: 2,
        outcome: input.outcome
      }
    })
    sessions.onSend = async (sessionId) => {
      output.current!.resolve({ answer: 42 })
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'idle',
        usage: { totalTokens: 12 },
        updatedAt: 316
      })
    }

    const execution = createExecutor().execute(invocation.id)
    await linkStarted.promise
    repository.reconcileInterruptedRun(run.id, 'utility exited', 317)
    allowLink.resolve()

    await expect(execution).resolves.toMatchObject({
      status: 'interrupted',
      usage: { totalTokens: 12 }
    })
  })

  it('does not restart an invocation already persisted as active', async () => {
    const { invocation } = createRunAndInvocation()
    repository.markInvocationAdmitted(invocation.id, 205)

    await expect(createExecutor().execute(invocation.id)).rejects.toThrow(
      'cannot start from status admitted'
    )
    expect(repository.requireInvocation(invocation.id).status).toBe('admitted')
    expect(sessions.createSubagentSession).not.toHaveBeenCalled()
  })

  it('does not fail work when another executor wins the persisted admission race', async () => {
    const { invocation } = createRunAndInvocation()
    const sent = deferred<void>()
    const allowCompletion = deferred<void>()
    sessions.onSend = async (sessionId) => {
      sent.resolve()
      await allowCompletion.promise
      output.current!.resolve({ answer: 42 })
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'idle',
        updatedAt: 318
      })
    }
    const admission = new AgentInvocationAdmission(2, 8)

    const winningExecution = createExecutor(admission).execute(invocation.id)
    const competingExecution = createExecutor(admission).execute(invocation.id)

    await sent.promise
    await expect(competingExecution).rejects.toThrow('already owned by another executor')
    expect(repository.requireInvocation(invocation.id).status).not.toBe('failed')
    allowCompletion.resolve()
    await expect(winningExecution).resolves.toMatchObject({
      status: 'succeeded'
    })
    expect(sessions.createSubagentSession).toHaveBeenCalledOnce()
    expect(sessions.sendConversationMessage).toHaveBeenCalledOnce()
  })

  it('reattaches a correlated crash-window child instead of creating a duplicate', async () => {
    const { run, invocation } = createRunAndInvocation()
    const existing = sessions.addCorrelatedChild({
      id: 'recovered-child',
      parent: sessions.parent,
      targetAgentId: 'deepchat',
      runId: run.id,
      invocationId: invocation.id,
      correlationSlot: invocation.childCorrelationSlot
    })
    addSessionRow(existing.sessionId)
    sessions.onSend = async (sessionId) => {
      output.current!.resolve({ recovered: true })
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'idle',
        updatedAt: 320
      })
    }

    const result = await createExecutor().execute(invocation.id)

    expect(result).toMatchObject({
      status: 'succeeded',
      childSessionId: 'recovered-child',
      result: { recovered: true }
    })
    expect(sessions.createSubagentSession).not.toHaveBeenCalled()
    expect(sessions.sendConversationMessage).toHaveBeenCalledWith(
      'recovered-child',
      expect.stringContaining('Complete the delegated work.')
    )
  })

  it('reattaches an orphan by logical lineage after recovery creates a new attempt', async () => {
    const { run, invocation: first } = createRunAndInvocation()
    const lineageSlot = createWorkflowChildLineageSlot(run.id, first.callPath)
    const orphan = sessions.addCorrelatedChild({
      id: 'lineage-orphan',
      parent: sessions.parent,
      targetAgentId: 'deepchat',
      runId: run.id,
      invocationId: first.id,
      correlationSlot: first.childCorrelationSlot
    })
    addSessionRow(orphan.sessionId)
    repository.reconcileInterruptedRun(run.id, 'utility crashed', 210)
    repository.queueRunResume(run.id, 220)
    repository.resumeRun(run.id, 230)
    const second = repository.createInvocation({
      id: 'invocation-2',
      runId: run.id,
      request: first.request,
      now: 240
    })
    sessions.onSend = async (sessionId) => {
      output.current!.resolve({ recovered: true })
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'idle',
        updatedAt: 321
      })
    }

    const result = await createExecutor().execute(second.id)

    expect(result).toMatchObject({
      status: 'succeeded',
      childSessionId: orphan.sessionId,
      result: { recovered: true }
    })
    expect(repository.requireInvocation(first.id).childSessionId).toBeNull()
    expect(sessions.rebindWorkflowChild).toHaveBeenCalledWith({
      sessionId: orphan.sessionId,
      slotId: second.childCorrelationSlot,
      workflowContext: {
        runId: run.id,
        invocationId: second.id,
        correlationSlot: second.childCorrelationSlot,
        lineageSlot
      }
    })
    expect(sessions.createSubagentSession).not.toHaveBeenCalled()
  })

  it('creates a fresh child when the lineage candidate belongs to an earlier attempt', async () => {
    const { run, invocation: first } = createRunAndInvocation()
    const lineageSlot = createWorkflowChildLineageSlot(run.id, first.callPath)
    const priorChild = sessions.addCorrelatedChild({
      id: 'prior-attempt-child',
      parent: sessions.parent,
      targetAgentId: 'deepchat',
      runId: run.id,
      invocationId: first.id,
      correlationSlot: first.childCorrelationSlot,
      lineageSlot
    })
    addSessionRow(priorChild.sessionId)
    repository.markInvocationAdmitted(first.id, 210)
    repository.attachChildSession(first.id, priorChild.sessionId, 220)
    repository.markInvocationRunning(first.id, 230)
    repository.reconcileInterruptedRun(run.id, 'utility crashed', 240)
    repository.queueRunResume(run.id, 250)
    repository.resumeRun(run.id, 260)
    const second = repository.createInvocation({
      id: 'invocation-2',
      runId: run.id,
      request: first.request,
      now: 270
    })
    sessions.onSend = async (sessionId) => {
      output.current!.resolve({ fresh: true })
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'idle',
        updatedAt: 322
      })
    }

    const result = await createExecutor().execute(second.id)

    expect(result).toMatchObject({
      status: 'succeeded',
      result: { fresh: true }
    })
    expect(result.childSessionId).not.toBe(priorChild.sessionId)
    expect(sessions.rebindWorkflowChild).not.toHaveBeenCalled()
    expect(sessions.createSubagentSession).toHaveBeenCalledOnce()
  })

  it('does not replace an attached child whose session can no longer be resolved', async () => {
    const { invocation } = createRunAndInvocation()
    addSessionRow('missing-child')
    repository.attachChildSession(invocation.id, 'missing-child', 210)

    const result = await createExecutor().execute(invocation.id)

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'WORKFLOW_CHILD_MISSING'
      },
      childSessionId: 'missing-child'
    })
    expect(sessions.createSubagentSession).not.toHaveBeenCalled()
  })

  it('rejects direct ACP before admission while allowing DeepChat-loop ACP compatibility', async () => {
    const direct = createRunAndInvocation({
      runId: 'direct-run',
      invocationId: 'direct-invocation',
      agentId: 'direct-acp'
    })
    sessions.agentTypes.set('direct-acp', 'acp')

    await expect(createExecutor().execute(direct.invocation.id)).resolves.toMatchObject({
      status: 'failed',
      error: {
        code: 'DIRECT_ACP_UNSUPPORTED'
      }
    })
    expect(sessions.createSubagentSession).not.toHaveBeenCalled()

    sessions.parent = parentSession('acp')
    const compatible = createRunAndInvocation({
      runId: 'compat-run',
      invocationId: 'compat-invocation'
    })
    sessions.onSend = async (sessionId) => {
      output.current!.resolve({ compatible: true })
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'idle',
        updatedAt: 330
      })
    }

    await expect(createExecutor().execute(compatible.invocation.id)).resolves.toMatchObject({
      status: 'succeeded',
      result: { compatible: true }
    })
    expect(output.open).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerId: 'acp'
      })
    )
  })

  it('rejects an unsafe output schema before allocating a child', async () => {
    const { invocation } = createRunAndInvocation({
      schema: {
        type: 'object',
        properties: {},
        additionalProperties: true
      }
    })
    const structuredOutput = new WorkflowStructuredOutputRegistry({
      onCatalogChanged: vi.fn()
    })

    const result = await createExecutor(
      new AgentInvocationAdmission(1, 8),
      structuredOutput
    ).execute(invocation.id)

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'STRUCTURED_SCHEMA_INVALID',
        retriable: false
      }
    })
    expect(sessions.createSubagentSession).not.toHaveBeenCalled()
  })

  it('accepts a normal-provider result through the invocation-scoped tool', async () => {
    const { invocation } = createRunAndInvocation({
      schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' }
        },
        required: ['answer'],
        additionalProperties: false
      }
    })
    const structuredOutput = new WorkflowStructuredOutputRegistry({
      onCatalogChanged: vi.fn()
    })
    sessions.onSend = async (sessionId) => {
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'generating',
        updatedAt: 335
      })
      await structuredOutput.callTool({
        id: 'result-call',
        type: 'function',
        function: {
          name: WORKFLOW_STRUCTURED_OUTPUT_TOOL_NAME,
          arguments: '{"answer":"Done"}'
        },
        conversationId: sessionId
      })
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'idle',
        updatedAt: 336
      })
    }

    const result = await createExecutor(
      new AgentInvocationAdmission(1, 8),
      structuredOutput
    ).execute(invocation.id)

    expect(result).toMatchObject({
      status: 'succeeded',
      result: {
        answer: 'Done'
      }
    })
    expect(structuredOutput.getToolDefinitions('child-1')).toEqual([])
  })

  it('corrects ACP-backed DeepChat output in the same child session', async () => {
    sessions.parent = parentSession('acp')
    const { invocation } = createRunAndInvocation({
      schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' }
        },
        required: ['answer'],
        additionalProperties: false
      }
    })
    const structuredOutput = new WorkflowStructuredOutputRegistry({
      onCatalogChanged: vi.fn()
    })
    const setInteractionState = vi.spyOn(repository, 'setInvocationInteractionState')
    let turn = 0
    sessions.onSend = async (sessionId) => {
      turn += 1
      const answer = turn === 1 ? '```json\n{"answer":"wrapped"}\n```' : '{"answer":"corrected"}'
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'generating',
        updatedAt: 337 + turn * 3
      })
      sessions.emit({
        sessionId,
        kind: 'blocks',
        responseMarkdown: answer,
        deliverySegments: [
          {
            key: `answer-${turn}`,
            kind: 'answer',
            text: answer,
            sourceMessageId: `message-${turn}`
          }
        ],
        waitingInteraction:
          turn === 1
            ? {
                type: 'question',
                messageId: 'correction-question',
                toolCallId: 'correction-tool',
                actionBlock: {} as any
              }
            : null,
        updatedAt: 338 + turn * 3
      })
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'idle',
        usage: {
          inputTokens: turn * 2,
          outputTokens: turn,
          totalTokens: turn * 3
        },
        updatedAt: 339 + turn * 3
      })
    }

    const result = await createExecutor(
      new AgentInvocationAdmission(1, 8),
      structuredOutput
    ).execute(invocation.id)

    expect(result).toMatchObject({
      status: 'succeeded',
      result: {
        answer: 'corrected'
      },
      usage: {
        inputTokens: 6,
        outputTokens: 3,
        totalTokens: 9
      }
    })
    expect(sessions.sendConversationMessage).toHaveBeenCalledTimes(2)
    expect(sessions.sendConversationMessage).toHaveBeenNthCalledWith(
      2,
      'child-1',
      expect.stringContaining('Structured output rejected (1/3)')
    )
    expect(setInteractionState.mock.calls.map(([, waiting]) => waiting)).toEqual([true, false])
    expect(structuredOutput.getToolDefinitions('child-1')).toEqual([])
  })

  it('fails after bounded normal-provider correction turns without leaking the output tool', async () => {
    const { invocation } = createRunAndInvocation({
      schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' }
        },
        required: ['answer'],
        additionalProperties: false
      }
    })
    const structuredOutput = new WorkflowStructuredOutputRegistry({
      onCatalogChanged: vi.fn()
    })
    sessions.onSend = async (sessionId) => {
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'idle',
        updatedAt: 355
      })
    }

    const result = await createExecutor(
      new AgentInvocationAdmission(1, 8),
      structuredOutput
    ).execute(invocation.id)

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'STRUCTURED_OUTPUT_EXHAUSTED',
        retriable: false
      },
      tapeLinkReceipt: {
        outcome: 'error'
      }
    })
    expect(sessions.sendConversationMessage).toHaveBeenCalledTimes(3)
    expect(structuredOutput.getToolDefinitions('child-1')).toEqual([])
    expect(contexts.size).toBe(0)
  })

  it('maps a provider terminal error without waiting for structured output', async () => {
    const { invocation } = createRunAndInvocation()
    sessions.onSend = async (sessionId) => {
      sessions.emit({
        sessionId,
        kind: 'blocks',
        responseMarkdown: 'Provider failed',
        waitingInteraction: null,
        updatedAt: 356
      })
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'error',
        updatedAt: 357
      })
    }

    const result = await createExecutor().execute(invocation.id)

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'CHILD_RUNTIME_FAILED',
        message: 'Provider failed'
      },
      tapeLinkReceipt: {
        outcome: 'error'
      }
    })
    expect(output.close).toHaveBeenCalledOnce()
    expect(contexts.size).toBe(0)
  })

  it('releases effect protection when terminal status carries invalid usage', async () => {
    const { invocation } = createRunAndInvocation()
    sessions.onSend = async (sessionId) => {
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'idle',
        usage: { totalTokens: -1 },
        updatedAt: 358
      })
    }

    const result = await createExecutor().execute(invocation.id)

    expect(result).toMatchObject({
      status: 'failed',
      tapeLinkReceipt: {
        outcome: 'error'
      }
    })
    expect(sessions.cancelConversation).not.toHaveBeenCalled()
    expect(contexts.size).toBe(0)
  })

  it('starts the host timeout after admission instead of spending it in the queue', async () => {
    vi.useFakeTimers()
    const { invocation } = createRunAndInvocation({ timeoutMs: 1_000 })
    const admission = new AgentInvocationAdmission(1, 8)
    const blocker = await admission.acquire({ ownerId: 'other-work' })
    const sent = deferred<void>()
    sessions.onSend = async (sessionId) => {
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'generating',
        updatedAt: 359
      })
      sent.resolve()
      await new Promise<void>(() => undefined)
    }
    const execution = createExecutor(admission).execute(invocation.id)
    await vi.waitFor(() => expect(admission.snapshot().pending).toBe(1))

    now = 2_000
    await vi.advanceTimersByTimeAsync(10_000)
    expect(repository.requireInvocation(invocation.id)).toMatchObject({
      status: 'queued',
      timeoutDeadlineAt: null
    })
    expect(sessions.createSubagentSession).not.toHaveBeenCalled()

    blocker.release()
    await sent.promise
    expect(repository.requireInvocation(invocation.id)).toMatchObject({
      status: 'running',
      timeoutDeadlineAt: 3_000
    })
    await vi.advanceTimersByTimeAsync(1_000)

    const result = await execution

    expect(result).toMatchObject({
      status: 'timed_out',
      error: {
        code: 'INVOCATION_TIMEOUT'
      }
    })
    expect(sessions.createSubagentSession).toHaveBeenCalledOnce()
    expect(repository.findReplayOutcome('run-1', invocation.request)).toMatchObject({
      status: 'timed_out'
    })
  })

  it('cancels an active child, freezes its Tape, and releases the tool-effect context', async () => {
    const { invocation } = createRunAndInvocation()
    const controller = new AbortController()
    const sent = deferred<void>()
    sessions.onSend = async (sessionId) => {
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'generating',
        updatedAt: 340
      })
      sent.resolve()
    }

    const execution = createExecutor().execute(invocation.id, {
      signal: controller.signal
    })
    await sent.promise
    controller.abort()
    const result = await execution

    expect(result).toMatchObject({
      status: 'cancelled',
      error: {
        code: 'INVOCATION_CANCELLED'
      },
      tapeLinkReceipt: {
        outcome: 'cancelled'
      }
    })
    expect(sessions.cancelConversation).toHaveBeenCalledWith('child-1')
    expect(sessions.linkSubagentTape).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'cancelled'
      })
    )
    expect(contexts.size).toBe(0)
  })

  it('keeps effect protection until terminal evidence arrives after cancellation resolves', async () => {
    vi.useFakeTimers()
    const { invocation } = createRunAndInvocation()
    const controller = new AbortController()
    const sent = deferred<void>()
    const cancellationRequested = deferred<void>()
    const cancellation = deferred<void>()
    sessions.cancelConversation.mockImplementation(async () => {
      cancellationRequested.resolve()
      await cancellation.promise
    })
    sessions.onSend = async (sessionId) => {
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'generating',
        updatedAt: 345
      })
      sent.resolve()
    }

    const execution = createExecutor().execute(invocation.id, {
      signal: controller.signal
    })
    await sent.promise
    controller.abort()
    await cancellationRequested.promise
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(execution).resolves.toMatchObject({
      status: 'cancelled',
      tapeLinkReceipt: null
    })
    expect(contexts.size).toBe(1)

    cancellation.resolve()
    await Promise.resolve()
    expect(contexts.size).toBe(1)

    sessions.emit({
      sessionId: 'child-1',
      kind: 'status',
      status: 'idle',
      updatedAt: 346
    })
    await vi.waitFor(() => {
      expect(contexts.size).toBe(0)
      expect(repository.requireInvocation(invocation.id).tapeLinkReceipt).toMatchObject({
        outcome: 'cancelled'
      })
    })
  })

  it('ignores an idle cancellation event until a delayed child turn actually starts and stops', async () => {
    vi.useFakeTimers()
    const { invocation } = createRunAndInvocation()
    const controller = new AbortController()
    const sendStarted = deferred<void>()
    sessions.onSend = async () => {
      sendStarted.resolve()
      await new Promise<void>(() => undefined)
    }

    const execution = createExecutor().execute(invocation.id, {
      signal: controller.signal
    })
    await sendStarted.promise
    controller.abort()
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(execution).resolves.toMatchObject({
      status: 'cancelled',
      tapeLinkReceipt: null
    })
    expect(contexts.size).toBe(1)

    sessions.emit({
      sessionId: 'child-1',
      kind: 'status',
      status: 'generating',
      updatedAt: 347
    })
    expect(contexts.size).toBe(1)
    sessions.emit({
      sessionId: 'child-1',
      kind: 'status',
      status: 'idle',
      updatedAt: 348
    })
    await vi.waitFor(() => {
      expect(contexts.size).toBe(0)
      expect(repository.requireInvocation(invocation.id).tapeLinkReceipt).toMatchObject({
        outcome: 'cancelled'
      })
    })
  })

  it('releases effect protection after a rejected cancellation is followed by terminal evidence', async () => {
    const { invocation } = createRunAndInvocation()
    const controller = new AbortController()
    const sent = deferred<void>()
    sessions.cancelConversation.mockRejectedValue(new Error('cancel transport failed'))
    sessions.onSend = async (sessionId) => {
      sessions.emit({
        sessionId,
        kind: 'status',
        status: 'generating',
        updatedAt: 346
      })
      sent.resolve()
    }

    const execution = createExecutor().execute(invocation.id, {
      signal: controller.signal
    })
    await sent.promise
    controller.abort()

    await vi.waitFor(() => expect(sessions.cancelConversation).toHaveBeenCalledOnce())
    expect(contexts.size).toBe(1)

    sessions.emit({
      sessionId: 'child-1',
      kind: 'status',
      status: 'idle',
      updatedAt: 347
    })
    await expect(execution).resolves.toMatchObject({
      status: 'cancelled',
      tapeLinkReceipt: {
        outcome: 'cancelled'
      }
    })
    expect(contexts.size).toBe(0)
  })

  it('rejects explicit lineage metadata that masks a different persisted call path', async () => {
    const { run, invocation: first } = createRunAndInvocation()
    const requestedLineage = createWorkflowChildLineageSlot(run.id, first.callPath)
    const unrelated = repository.createInvocation({
      id: 'unrelated-invocation',
      runId: run.id,
      request: {
        ...first.request,
        callPath: 'unrelated'
      },
      now: 205
    })
    const orphan = sessions.addCorrelatedChild({
      id: 'mislabelled-lineage-orphan',
      parent: sessions.parent,
      targetAgentId: 'deepchat',
      runId: run.id,
      invocationId: unrelated.id,
      correlationSlot: unrelated.childCorrelationSlot,
      lineageSlot: requestedLineage
    })
    addSessionRow(orphan.sessionId)
    repository.reconcileInterruptedRun(run.id, 'utility crashed', 210)
    repository.queueRunResume(run.id, 220)
    repository.resumeRun(run.id, 230)
    const second = repository.createInvocation({
      id: 'invocation-2',
      runId: run.id,
      request: first.request,
      now: 240
    })

    const result = await createExecutor().execute(second.id)

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'WORKFLOW_CHILD_LINEAGE_MISMATCH'
      }
    })
    expect(sessions.rebindWorkflowChild).not.toHaveBeenCalled()
    expect(sessions.sendConversationMessage).not.toHaveBeenCalled()
  })

  it('fails on a mismatched recovered child before sending a handoff', async () => {
    const { run, invocation } = createRunAndInvocation()
    const mismatched = sessions.addCorrelatedChild({
      id: 'wrong-child',
      parent: sessions.parent,
      targetAgentId: 'deepchat',
      runId: run.id,
      invocationId: 'another-invocation',
      correlationSlot: invocation.childCorrelationSlot
    })
    addSessionRow(mismatched.sessionId)

    const result = await createExecutor().execute(invocation.id)

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'WORKFLOW_CHILD_CORRELATION_MISMATCH'
      }
    })
    expect(sessions.sendConversationMessage).not.toHaveBeenCalled()
    expect(sessions.cancelConversation).not.toHaveBeenCalled()
  })

  it('does not cancel an attached child whose correlation slot conflicts with the invocation', async () => {
    const { run, invocation } = createRunAndInvocation()
    const mismatched = sessions.addCorrelatedChild({
      id: 'attached-wrong-child',
      parent: sessions.parent,
      targetAgentId: 'deepchat',
      runId: run.id,
      invocationId: invocation.id,
      correlationSlot: 'another-slot'
    })
    addSessionRow(mismatched.sessionId)
    repository.attachChildSession(invocation.id, mismatched.sessionId, 210)

    const result = await createExecutor().execute(invocation.id)

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'WORKFLOW_CHILD_CORRELATION_MISMATCH'
      }
    })
    expect(sessions.sendConversationMessage).not.toHaveBeenCalled()
    expect(sessions.cancelConversation).not.toHaveBeenCalled()
  })
})

function createSessionPort(
  initialParent: ConversationSessionInfo,
  resolveInvocation?: (invocationId: string) => WorkflowInvocation | null
) {
  const listeners = new Set<(update: SessionRuntimeUpdate) => void>()
  const children = new Map<string, ConversationSessionInfo>()
  let sequence = 0
  const port = {
    parent: initialParent,
    agentTypes: new Map<string, 'deepchat' | 'acp' | null>([
      ['deepchat', 'deepchat'],
      ['reviewer', 'deepchat']
    ]),
    onSend: null as ((sessionId: string, content: string) => Promise<void>) | null,
    resolveSessionInfo: vi.fn(async (sessionId: string) => {
      if (sessionId === port.parent.sessionId) {
        return port.parent
      }
      return children.get(sessionId) ?? null
    }),
    resolveAgentType: vi.fn(async (agentId: string) => port.agentTypes.get(agentId) ?? null),
    findCorrelatedChild: vi.fn(async (parentSessionId: string, correlationSlot: string) => {
      const matches = [...children.values()].filter(
        (child) =>
          child.parentSessionId === parentSessionId &&
          child.subagentMeta?.workflow?.correlationSlot === correlationSlot
      )
      if (matches.length > 1) {
        throw new Error(`Duplicate workflow children for ${correlationSlot}`)
      }
      return matches[0] ?? null
    }),
    findLineageChild: vi.fn(async (parentSessionId: string, lineageSlot: string) => {
      const matches = [...children.values()].filter((child) => {
        const workflow = child.subagentMeta?.workflow
        const priorInvocation = workflow ? resolveInvocation?.(workflow.invocationId) : null
        const effectiveLineage =
          workflow?.lineageSlot ??
          (priorInvocation
            ? createWorkflowChildLineageSlot(priorInvocation.runId, priorInvocation.callPath)
            : null)
        return child.parentSessionId === parentSessionId && effectiveLineage === lineageSlot
      })
      if (matches.length > 1) {
        throw new Error(`Duplicate workflow children for lineage ${lineageSlot}`)
      }
      return matches[0] ?? null
    }),
    rebindWorkflowChild: vi.fn(
      async (input: {
        sessionId: string
        slotId: string
        workflowContext: NonNullable<
          NonNullable<ConversationSessionInfo['subagentMeta']>['workflow']
        >
      }) => {
        const child = children.get(input.sessionId)
        if (!child?.subagentMeta) {
          return null
        }
        const rebound: ConversationSessionInfo = {
          ...child,
          subagentMeta: {
            ...child.subagentMeta,
            slotId: input.slotId,
            workflow: input.workflowContext
          }
        }
        children.set(rebound.sessionId, rebound)
        return rebound
      }
    ),
    createSubagentSession: vi.fn(async (input: CreateSubagentSessionInput) => {
      const sessionId = `child-${++sequence}`
      const child: ConversationSessionInfo = {
        sessionId,
        agentId: input.agentId,
        agentName: input.displayName,
        agentType: port.agentTypes.get(input.agentId) ?? null,
        providerId: input.providerId,
        modelId: input.modelId,
        projectDir: input.projectDir ?? null,
        permissionMode: input.permissionMode,
        generationSettings: null,
        disabledAgentTools: input.disabledAgentTools ?? [],
        activeSkills: input.activeSkills ?? [],
        sessionKind: 'subagent',
        parentSessionId: input.parentSessionId,
        subagentMeta: {
          slotId: input.slotId,
          displayName: input.displayName,
          targetAgentId: input.targetAgentId,
          ...(input.workflowContext ? { workflow: input.workflowContext } : {})
        },
        subagentCapability: unavailableSubagents
      }
      children.set(sessionId, child)
      port.addSessionRow?.(sessionId)
      return child
    }),
    addSessionRow: null as ((sessionId: string) => void) | null,
    linkSubagentTape: vi.fn(async (input) => ({
      linkEntry: {
        sessionId: input.parentSessionId,
        entryId: 1
      },
      childSessionId: input.childSessionId,
      childHeadEntryId: 2,
      childEntryCount: 2,
      outcome: input.outcome
    })),
    sendConversationMessage: vi.fn(async (sessionId: string, content: string) => {
      await port.onSend?.(sessionId, content)
    }),
    cancelConversation: vi.fn(async (sessionId: string) => {
      port.emit({
        sessionId,
        kind: 'status',
        status: 'idle',
        updatedAt: 1_000
      })
    }),
    subscribeSessionRuntimeUpdates: vi.fn((listener: (update: SessionRuntimeUpdate) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    emit(update: SessionRuntimeUpdate) {
      for (const listener of listeners) {
        listener(update)
      }
    },
    addCorrelatedChild(input: {
      id: string
      parent: ConversationSessionInfo
      targetAgentId: string
      runId: string
      invocationId: string
      correlationSlot: string
      lineageSlot?: string
    }): ConversationSessionInfo {
      const child: ConversationSessionInfo = {
        ...input.parent,
        sessionId: input.id,
        agentId: input.targetAgentId,
        agentName: input.targetAgentId,
        agentType: 'deepchat',
        sessionKind: 'subagent',
        parentSessionId: input.parent.sessionId,
        subagentMeta: {
          slotId: input.correlationSlot,
          displayName: input.targetAgentId,
          targetAgentId: input.targetAgentId,
          workflow: {
            runId: input.runId,
            invocationId: input.invocationId,
            correlationSlot: input.correlationSlot,
            ...(input.lineageSlot ? { lineageSlot: input.lineageSlot } : {})
          }
        },
        subagentCapability: unavailableSubagents
      }
      children.set(child.sessionId, child)
      return child
    }
  }
  return port
}

function createStructuredOutputPort() {
  const close = vi.fn()
  const completeTurn = vi.fn(() => null)
  const open = vi.fn((): WorkflowStructuredOutputLease => {
    const current = deferred<any>()
    port.current = current
    return {
      instruction: 'Submit one value through the workflow structured-output channel.',
      result: current.promise,
      completeTurn,
      close
    }
  })
  const port = {
    current: null as (Deferred<unknown> & { resolve(value: unknown): void }) | null,
    close,
    completeTurn,
    open,
    prepare: vi.fn(() => ({ open }))
  } satisfies WorkflowStructuredOutputPort & {
    current: (Deferred<unknown> & { resolve(value: unknown): void }) | null
    close: ReturnType<typeof vi.fn>
    completeTurn: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
  }
  return port
}
