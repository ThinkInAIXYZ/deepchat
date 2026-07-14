import { describe, expect, it, vi } from 'vitest'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { AcpAgentConfig, AcpAgentInstallState } from '@shared/presenter'
import type { AcpAgentDescriptor } from '@/agent/shared/agentDescriptors'
import { toAcpRemoteSessionId, toAppSessionId } from '@/agent/shared/agentSessionIds'
import { AcpPromptController, AcpRuntimeOwner, type AcpClientRuntime } from '@/agent/acp/client'
import { AcpAgentRuntime, type AcpAgentRuntimeSessionInput } from '@/agent/acp/instance'
import type { AcpPendingInputFacet } from '@/agent/acp/instance'
import { AcpSessionController, type AcpSessionRecord } from '@/agent/acp/runtime'
import type { PendingSessionInputRecord, SendMessageInput } from '@shared/types/agent-interface'

const descriptor: AcpAgentDescriptor = {
  id: 'agent',
  kind: 'acp',
  source: 'manual',
  name: 'Agent',
  enabled: true,
  protected: false,
  description: null,
  icon: null,
  avatar: null,
  launch: { command: 'agent', args: [], env: {} }
}

const agent: AcpAgentConfig = {
  id: 'agent',
  name: 'Agent',
  command: 'agent',
  args: [],
  env: {},
  source: 'manual'
}

function createInput(
  overrides?: Partial<AcpAgentRuntimeSessionInput>
): AcpAgentRuntimeSessionInput {
  return {
    sessionId: toAppSessionId('session'),
    descriptor,
    agent,
    scope: 'regular',
    workdir: '/workspace',
    ...overrides
  }
}

class FakePendingInputs implements AcpPendingInputFacet {
  readonly records: PendingSessionInputRecord[] = []
  readonly queuedStates: Array<PendingSessionInputRecord['state']> = []
  private nextId = 1

  listPendingInputs(sessionId: ReturnType<typeof toAppSessionId>) {
    return this.records.filter(
      (record) => record.sessionId === sessionId && record.state !== 'consumed'
    )
  }

  queuePendingInput(
    sessionId: ReturnType<typeof toAppSessionId>,
    input: string | SendMessageInput,
    options?: { state?: 'pending' | 'claimed' | 'consumed' }
  ) {
    const record = this.create(sessionId, 'queue', input, options?.state)
    this.queuedStates.push(record.state)
    return record
  }

  queueSteerInput(
    sessionId: ReturnType<typeof toAppSessionId>,
    input: string | SendMessageInput,
    options?: { mergeItemId?: string | null }
  ) {
    const existing = options?.mergeItemId
      ? this.records.find((record) => record.id === options.mergeItemId)
      : undefined
    if (existing) {
      const next = this.normalize(input)
      existing.payload.text = [existing.payload.text, next.text].filter(Boolean).join('\n\n')
      return existing
    }
    return this.create(sessionId, 'steer', input)
  }

  updateQueuedInput(
    _sessionId: ReturnType<typeof toAppSessionId>,
    itemId: string,
    input: string | SendMessageInput
  ) {
    const record = this.require(itemId)
    record.payload = this.normalize(input)
    return record
  }

  moveQueuedInput(sessionId: ReturnType<typeof toAppSessionId>, _itemId: string, _toIndex: number) {
    return this.listPendingInputs(sessionId)
  }

  convertPendingInputToSteer(_sessionId: ReturnType<typeof toAppSessionId>, itemId: string) {
    const record = this.require(itemId)
    record.mode = 'steer'
    record.queueOrder = null
    return record
  }

  restoreSteerInputToQueue(_sessionId: ReturnType<typeof toAppSessionId>, itemId: string) {
    const record = this.require(itemId)
    record.mode = 'queue'
    record.queueOrder = this.records.length
    return record
  }

  deletePendingInput(_sessionId: ReturnType<typeof toAppSessionId>, itemId: string) {
    this.records.splice(this.records.indexOf(this.require(itemId)), 1)
  }

  getNextQueuedInput(sessionId: ReturnType<typeof toAppSessionId>) {
    return (
      this.records.find(
        (record) =>
          record.sessionId === sessionId && record.mode === 'queue' && record.state === 'pending'
      ) ?? null
    )
  }

  getNextSteerInput(sessionId: ReturnType<typeof toAppSessionId>) {
    return (
      this.records.find(
        (record) =>
          record.sessionId === sessionId && record.mode === 'steer' && record.state === 'pending'
      ) ?? null
    )
  }

  claimQueuedInput(_sessionId: ReturnType<typeof toAppSessionId>, itemId: string) {
    return this.claim(itemId)
  }

  claimSteerInput(_sessionId: ReturnType<typeof toAppSessionId>, itemId: string) {
    return this.claim(itemId)
  }

  releaseClaimedInput(_sessionId: ReturnType<typeof toAppSessionId>, itemId: string) {
    const record = this.require(itemId)
    record.state = 'pending'
    return record
  }

  consumeQueuedInput(_sessionId: ReturnType<typeof toAppSessionId>, itemId: string) {
    this.require(itemId).state = 'consumed'
  }

  consumeSteerInput(_sessionId: ReturnType<typeof toAppSessionId>, itemId: string) {
    this.require(itemId).state = 'consumed'
  }

  hasPendingTurnInput(sessionId: ReturnType<typeof toAppSessionId>) {
    return Boolean(this.getNextSteerInput(sessionId) ?? this.getNextQueuedInput(sessionId))
  }

  private create(
    sessionId: ReturnType<typeof toAppSessionId>,
    mode: 'queue' | 'steer',
    input: string | SendMessageInput,
    state: 'pending' | 'claimed' | 'consumed' = 'pending'
  ) {
    const record: PendingSessionInputRecord = {
      id: `pending-${this.nextId++}`,
      sessionId,
      mode,
      state,
      payload: this.normalize(input),
      queueOrder: mode === 'queue' ? this.records.length : null,
      claimedAt: null,
      consumedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.records.push(record)
    return record
  }

  private claim(itemId: string) {
    const record = this.require(itemId)
    record.state = 'claimed'
    return record
  }

  private require(itemId: string) {
    const record = this.records.find((candidate) => candidate.id === itemId)
    if (!record) throw new Error(`Missing pending input: ${itemId}`)
    return record
  }

  private normalize(input: string | SendMessageInput): SendMessageInput {
    return typeof input === 'string' ? { text: input, files: [] } : input
  }
}

function createHarness(options?: {
  prepareRejects?: boolean
  preparePromise?: Promise<AcpSessionRecord>
  clearRejects?: boolean
  clearPromise?: Promise<void>
  resourceRejects?: boolean
  firstPromptNeverSettles?: boolean
  pendingInputs?: FakePendingInputs
}) {
  const calls: string[] = []
  let hooks:
    | {
        onEvents?(events: readonly never[]): void
        onPermission(
          request: schema.RequestPermissionRequest
        ): Promise<schema.RequestPermissionResponse>
        onProcessExit?(sessionId: ReturnType<typeof toAcpRemoteSessionId>): void
      }
    | undefined
  let prepareHooks:
    | {
        onProcessExit?(sessionId: ReturnType<typeof toAcpRemoteSessionId>): void
        signal?: AbortSignal
      }
    | undefined
  let promptCount = 0
  const connection = {
    prompt: vi.fn(async () => {
      promptCount += 1
      calls.push(`prompt.${promptCount}`)
      if (options?.firstPromptNeverSettles && promptCount === 1) {
        return await new Promise<schema.PromptResponse>(() => {})
      }
      return { stopReason: 'end_turn' } as schema.PromptResponse
    }),
    cancel: vi.fn(async () => {
      calls.push('connection.cancel')
    })
  }
  const session = {
    sessionId: toAcpRemoteSessionId('remote'),
    connection,
    detachHandlers: [],
    workdir: '/workspace',
    providerId: 'acp',
    agentId: 'agent',
    conversationId: 'session',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    metadata: {}
  } as AcpSessionRecord
  const sessions = {
    open: vi.fn(async (_id, _agent, nextHooks) => {
      hooks = nextHooks
      return session
    }),
    prepare: vi.fn(async (_id, _agent, _workdir, nextHooks) => {
      prepareHooks = nextHooks
      calls.push('session.prepare')
      if (options?.prepareRejects) throw new Error('prepare failed')
      if (options?.preparePromise) return await options.preparePromise
      return session
    }),
    updateWorkdir: vi.fn(async (_id, _agentId, workdir) => workdir ?? '/workspace'),
    getSession: vi.fn(() => session),
    clearMappedSession: vi.fn(),
    clear: vi.fn(async () => {
      calls.push('session.clear')
      if (options?.clearPromise) await options.clearPromise
      if (options?.clearRejects) throw new Error('clear failed')
    }),
    getModes: vi.fn(() => null),
    setMode: vi.fn(),
    getConfigOptions: vi.fn(() => null),
    setConfigOption: vi.fn(async () => null),
    getCommands: vi.fn(() => [])
  }
  const client = {
    promptController: new AcpPromptController(),
    sessionController: sessions,
    sessionManager: {
      clearAllSessions: vi.fn(),
      clearSessionsByAgent: vi.fn()
    },
    processManager: {
      shutdown: vi.fn(),
      release: vi.fn()
    }
  } as unknown as AcpClientRuntime
  const createClient = vi.fn(() => client)
  const owner = new AcpRuntimeOwner(createClient)
  const runtime = new AcpAgentRuntime(
    owner,
    () => ({
      promptResources: {
        resolve: vi.fn(async ({ content }) => {
          if (options?.resourceRejects) throw new Error('resource failed')
          const text = typeof content === 'string' ? content : content.text
          return {
            latestUserMessage: { role: 'user', content: text },
            userContent: { text, files: [], links: [], search: false, think: false },
            sections: {
              configured: '',
              runtime: '',
              environment: '',
              skills: '',
              activeSkills: '',
              tooling: '',
              permission: '',
              verification: ''
            },
            localToolDefinitions: [],
            traceEnabled: false,
            viewManifest: {
              taskType: 'chat',
              policy: 'legacy_context_v1',
              policyVersion: null,
              tokenBudget: {
                contextLength: 8192,
                requestedMaxTokens: 4096,
                effectiveMaxTokens: 4096,
                reserveTokens: 4096,
                toolReserveTokens: 0
              },
              summaryCursorOrderSeq: 1,
              supportsVision: false,
              supportsAudioInput: false,
              traceDebugEnabled: false
            }
          }
        })
      },
      promptBuilder: {
        build: ({ latestUserMessage }) => ({
          messages: [latestUserMessage],
          localToolDefinitions: []
        })
      },
      projection: {
        setStatus: vi.fn(),
        begin: vi.fn(() => ({
          requestId: 'assistant',
          messageId: 'assistant',
          userMessageId: 'user',
          requestSeq: 1
        })),
        attemptViewManifest: vi.fn(),
        applyEvents: vi.fn(),
        presentPermission: vi.fn(),
        settlePermission: vi.fn(),
        complete: vi.fn(() => ({ status: 'completed', stopReason: 'complete' })),
        fail: vi.fn(() => ({ status: 'error', stopReason: 'error', errorMessage: 'error' })),
        cancel: vi.fn(() => {
          calls.push('projection.cancel')
          return {
            status: 'aborted',
            stopReason: 'user_stop',
            errorMessage: 'cancelled'
          }
        })
      },
      trace: { writePrompt: vi.fn() },
      rateGate: { wait: vi.fn(), clearWaiting: vi.fn() },
      turns: { startTurn: vi.fn(), finishTurn: vi.fn() },
      debug: { appendDebugEvent: vi.fn() },
      observer: { userPromptSubmitted: vi.fn(), terminal: vi.fn() }
    }),
    options?.pendingInputs
  )
  return {
    calls,
    client,
    connection,
    createClient,
    hooks: () => hooks,
    owner,
    prepareHooks: () => prepareHooks,
    runtime,
    session,
    sessions
  }
}

function installOpeningController(
  harness: ReturnType<typeof createHarness>,
  opening: Promise<AcpSessionRecord>
) {
  const events = {
    modesReady: vi.fn(),
    configOptionsReady: vi.fn(),
    commandsReady: vi.fn()
  }
  const sessionManager = {
    getOrCreateSession: vi.fn(async () => await opening),
    cancelPendingSession: vi.fn(() => true),
    discardLateSession: vi.fn(async (_conversationId, session: AcpSessionRecord) => {
      session.detachHandlers.splice(0).forEach((dispose) => dispose())
    }),
    getSession: vi.fn(() => null),
    listSessions: vi.fn(() => []),
    clearSession: vi.fn(async () => undefined),
    clearSessionsByAgent: vi.fn(async () => undefined),
    clearAllSessions: vi.fn(async () => undefined)
  }
  const persistence = {
    isWorkdirUsable: vi.fn(() => true),
    resolveWorkdir: vi.fn((workdir?: string | null) => workdir ?? '/workspace'),
    getSessionData: vi.fn(async () => ({ workdir: '/workspace' })),
    updateWorkdir: vi.fn(async () => undefined),
    clearSession: vi.fn(async () => undefined)
  }
  const controller = new AcpSessionController(
    sessionManager as never,
    {} as never,
    persistence as never,
    events
  )
  Object.assign(harness.client, {
    sessionController: controller,
    sessionManager
  })
  return { events, sessionManager }
}

describe('AcpAgentRuntime', () => {
  it('hydrates one lazy instance per app session and shares the owner runtime', async () => {
    const harness = createHarness()
    const input = createInput()

    const [first, second] = await Promise.all([
      harness.runtime.getOrHydrate(input),
      harness.runtime.getOrHydrate(input)
    ])

    expect(first).toBe(second)
    expect(harness.createClient).toHaveBeenCalledTimes(1)
  })

  it('cleans live owner session state without hydrating a direct instance', async () => {
    const harness = createHarness()
    const sessionId = toAppSessionId('session')
    harness.owner.getOrCreate()

    await harness.runtime.cleanupSession(sessionId)

    expect(harness.runtime.getHydrated(sessionId)).toBeUndefined()
    expect(harness.sessions.clear).toHaveBeenCalledWith(sessionId)
    expect(harness.createClient).toHaveBeenCalledOnce()
  })

  it('does not materialize the owner while cleaning an unhydrated session', async () => {
    const harness = createHarness()

    await harness.runtime.cleanupSession(toAppSessionId('orphan'))

    expect(harness.createClient).not.toHaveBeenCalled()
    expect(harness.sessions.clear).not.toHaveBeenCalled()
  })

  it('rejects an in-flight descriptor identity mismatch without replacing the instance', async () => {
    const harness = createHarness()
    const firstInput = createInput()
    const secondInput = createInput({
      descriptor: { ...descriptor, name: 'Agent v2' },
      agent: { ...agent, name: 'Agent v2' }
    })

    const first = harness.runtime.getOrHydrate(firstInput)
    await expect(harness.runtime.getOrHydrate(secondInput)).rejects.toThrow(
      'ACP session identity mismatch for session'
    )

    expect(harness.runtime.getHydrated(secondInput.sessionId)).toBe(await first)
    expect(harness.calls).not.toContain('session.clear')
  })

  it('rejects a cached descriptor identity mismatch without clearing the binding', async () => {
    const harness = createHarness()
    const first = await harness.runtime.getOrHydrate(createInput())
    const changedDescriptor = { ...descriptor, name: 'Agent v2' }
    await expect(
      harness.runtime.getOrHydrate(
        createInput({ descriptor: changedDescriptor, agent: { ...agent, name: 'Agent v2' } })
      )
    ).rejects.toThrow('ACP session identity mismatch for session')

    expect(harness.runtime.getHydrated(createInput().sessionId)).toBe(first)
    expect(harness.calls).not.toContain('session.clear')
  })

  it('keeps registry identity across install timestamp refreshes', async () => {
    const harness = createHarness()
    const installState: AcpAgentInstallState = {
      status: 'installed',
      distributionType: 'npx',
      version: '1.0.0',
      installDir: '/agents/agent',
      installedAt: 100,
      lastCheckedAt: 100
    }
    const registryDescriptor: AcpAgentDescriptor = {
      id: 'agent',
      kind: 'acp',
      source: 'registry',
      name: 'Agent',
      enabled: true,
      protected: false,
      description: null,
      icon: null,
      avatar: null,
      registry: {
        id: 'agent',
        version: '1.0.0',
        distribution: { npx: { package: '@example/agent' } }
      },
      installState
    }
    const registryAgent: AcpAgentConfig = {
      ...agent,
      source: 'registry',
      installState
    }
    const first = await harness.runtime.getOrHydrate(
      createInput({ descriptor: registryDescriptor, agent: registryAgent })
    )
    const refreshedInstallState = {
      ...installState,
      installedAt: 200,
      lastCheckedAt: 300
    }

    const refreshed = await harness.runtime.getOrHydrate(
      createInput({
        descriptor: { ...registryDescriptor, installState: refreshedInstallState },
        agent: { ...registryAgent, installState: refreshedInstallState }
      })
    )

    expect(refreshed).toBe(first)
    const movedInstallState = { ...refreshedInstallState, installDir: '/agents/moved' }
    await expect(
      harness.runtime.getOrHydrate(
        createInput({
          descriptor: { ...registryDescriptor, installState: movedInstallState },
          agent: { ...registryAgent, installState: movedInstallState }
        })
      )
    ).rejects.toThrow('ACP session identity mismatch for session')
  })

  it('rejects malformed descriptor/config identity before hydration', async () => {
    const harness = createHarness()

    await expect(
      harness.runtime.getOrHydrate(createInput({ agent: { ...agent, id: 'other' } }))
    ).rejects.toThrow('ACP descriptor/config mismatch: agent != other')
    await expect(
      harness.runtime.getOrHydrate(createInput({ agent: { ...agent, source: 'registry' } }))
    ).rejects.toThrow('ACP descriptor/config mismatch for agent "agent"')
    expect(harness.createClient).not.toHaveBeenCalled()
  })

  it('evicts a failed draft preparation without sending a prompt or creating a projection', async () => {
    const harness = createHarness({ prepareRejects: true })
    const input = createInput()

    await expect(harness.runtime.prepare(input)).rejects.toThrow('prepare failed')

    expect(harness.runtime.getHydrated(input.sessionId)).toBeUndefined()
    expect(harness.connection.prompt).not.toHaveBeenCalled()
    expect(harness.sessions.open).not.toHaveBeenCalled()
    expect(harness.calls).toEqual(['session.prepare', 'session.clear'])
  })

  it('evicts a failed preparation even when cleanup also fails', async () => {
    const harness = createHarness({ clearRejects: true, prepareRejects: true })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const input = createInput()

    await expect(harness.runtime.prepare(input)).rejects.toThrow('prepare failed')

    expect(harness.runtime.getHydrated(input.sessionId)).toBeUndefined()
    expect(warning).toHaveBeenCalledWith(
      '[ACP] Failed to close instance after preparation error:',
      expect.objectContaining({ message: 'clear failed' })
    )
    warning.mockRestore()
  })

  it('evicts a closed instance while preserving its session clear error', async () => {
    const harness = createHarness({ clearRejects: true })
    const input = createInput()
    await harness.runtime.getOrHydrate(input)

    await expect(harness.runtime.close(input.sessionId)).rejects.toThrow('clear failed')

    expect(harness.runtime.getHydrated(input.sessionId)).toBeUndefined()
  })

  it('evicts live state on process exit without clearing the durable session binding', async () => {
    const harness = createHarness()
    const input = createInput()
    const sending = harness.runtime.send(input, 'hello')
    await vi.waitFor(() => expect(harness.hooks()).toBeDefined())

    harness.hooks()?.onProcessExit?.(toAcpRemoteSessionId('remote'))
    await sending

    expect(harness.runtime.getHydrated(input.sessionId)).toBeUndefined()
    expect(harness.calls).not.toContain('session.clear')
  })

  it('drains queued inputs in order through the shared pending coordinator facet', async () => {
    const pendingInputs = new FakePendingInputs()
    const harness = createHarness({ pendingInputs })
    const input = createInput()

    await harness.runtime.queuePendingInput(input, { text: 'first', files: [] })
    await harness.runtime.queuePendingInput(input, { text: 'second', files: [] })

    await vi.waitFor(() => expect(harness.connection.prompt).toHaveBeenCalledTimes(2))
    expect(pendingInputs.queuedStates[0]).toBe('claimed')
    expect(harness.connection.prompt.mock.calls.map(([request]) => request.prompt)).toEqual([
      [{ type: 'text', text: 'first' }],
      [{ type: 'text', text: 'second' }]
    ])
    expect(pendingInputs.records.map((record) => record.state)).toEqual(['consumed', 'consumed'])
  })

  it('waits for in-flight hydration before closing all instances', async () => {
    const harness = createHarness()
    const input = createInput()

    const hydrating = harness.runtime.getOrHydrate(input)
    await harness.runtime.closeAll()
    await hydrating

    expect(harness.runtime.getHydrated(input.sessionId)).toBeUndefined()
    expect(harness.calls).toContain('session.clear')
  })

  it('atomically fences lazy hydration when owner shutdown starts', async () => {
    const harness = createHarness()
    const input = createInput()

    const hydrating = harness.runtime.getOrHydrate(input)
    const shutdown = harness.owner.shutdown()
    const instance = await hydrating
    await shutdown

    await expect(instance.snapshot()).resolves.toMatchObject({ status: 'closed' })
    expect(harness.runtime.getHydrated(input.sessionId)).toBeUndefined()
    expect(harness.client.processManager.shutdown).toHaveBeenCalledTimes(1)
    expect(() => harness.owner.getOrCreate()).toThrow('Runtime owner is closed')
    await expect(harness.runtime.getOrHydrate(input)).rejects.toThrow('Direct runtime is closed')
  })

  it('keeps the cached identity after a rejected replacement until shutdown', async () => {
    let resolveClear!: () => void
    const clearPromise = new Promise<void>((resolve) => {
      resolveClear = resolve
    })
    const harness = createHarness({ clearPromise })
    const input = createInput()
    await harness.runtime.getOrHydrate(input)
    await expect(
      harness.runtime.getOrHydrate(
        createInput({
          descriptor: { ...descriptor, name: 'Agent v2' },
          agent: { ...agent, name: 'Agent v2' }
        })
      )
    ).rejects.toThrow('ACP session identity mismatch for session')
    expect(harness.sessions.clear).not.toHaveBeenCalled()

    const shutdown = harness.owner.shutdown()
    await vi.waitFor(() => expect(harness.sessions.clear).toHaveBeenCalledTimes(1))
    resolveClear()

    await shutdown
    expect(harness.runtime.getHydrated(input.sessionId)).toBeUndefined()
    expect(harness.createClient).toHaveBeenCalledTimes(1)
  })

  it('aborts and closes in-flight preparation before owner shutdown completes', async () => {
    let resolvePrepare!: (session: AcpSessionRecord) => void
    const preparePromise = new Promise<AcpSessionRecord>((resolve) => {
      resolvePrepare = resolve
    })
    const harness = createHarness({ preparePromise })
    const input = createInput()
    const preparing = harness.runtime.prepare(input)
    await vi.waitFor(() => expect(harness.sessions.prepare).toHaveBeenCalledTimes(1))

    const shutdown = harness.owner.shutdown()
    resolvePrepare(harness.session)

    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' })
    await shutdown
    expect(harness.sessions.open).not.toHaveBeenCalled()
    expect(harness.runtime.getHydrated(input.sessionId)).toBeUndefined()
    expect(harness.client.processManager.shutdown).toHaveBeenCalledTimes(1)
  })

  it('settles an in-flight send before shared owner shutdown', async () => {
    const harness = createHarness({ firstPromptNeverSettles: true })
    const input = createInput()
    const sending = harness.runtime.send(input, 'active')
    await vi.waitFor(() => expect(harness.connection.prompt).toHaveBeenCalledTimes(1))

    await harness.owner.shutdown()
    await sending

    expect(harness.calls.indexOf('projection.cancel')).toBeLessThan(
      harness.calls.indexOf('session.clear')
    )
    expect(harness.runtime.getHydrated(input.sessionId)).toBeUndefined()
    expect(harness.client.processManager.shutdown).toHaveBeenCalledTimes(1)
  })

  it.each(['prepare', 'send'] as const)(
    'settles a %s blocked in session open without waiting for the RPC',
    async (operation) => {
      const harness = createHarness()
      const installed = installOpeningController(harness, new Promise<AcpSessionRecord>(() => {}))
      const input = createInput()
      const running =
        operation === 'prepare'
          ? harness.runtime.prepare(input)
          : harness.runtime.send(input, 'blocked open')
      const outcome = running.then(
        () => ({ status: 'resolved' as const }),
        (error: unknown) => ({ status: 'rejected' as const, error })
      )
      await vi.waitFor(() =>
        expect(installed.sessionManager.getOrCreateSession).toHaveBeenCalledTimes(1)
      )

      await harness.owner.shutdown()
      const result = await outcome

      if (operation === 'prepare') {
        expect(result).toMatchObject({
          status: 'rejected',
          error: expect.objectContaining({ name: 'AbortError' })
        })
      } else {
        expect(result).toEqual({ status: 'resolved' })
      }
      expect(installed.sessionManager.cancelPendingSession).toHaveBeenCalledTimes(1)
      expect(installed.sessionManager.clearAllSessions).toHaveBeenCalledTimes(1)
      expect(harness.client.processManager.shutdown).toHaveBeenCalledTimes(1)
      expect(harness.runtime.getHydrated(input.sessionId)).toBeUndefined()
    }
  )

  it('disposes a late session-open record after shutdown without publishing it', async () => {
    let resolveOpen!: (session: AcpSessionRecord) => void
    const opening = new Promise<AcpSessionRecord>((resolve) => {
      resolveOpen = resolve
    })
    const harness = createHarness()
    const installed = installOpeningController(harness, opening)
    const input = createInput()
    const preparing = harness.runtime.prepare(input).catch((error) => error as Error)
    await vi.waitFor(() =>
      expect(installed.sessionManager.getOrCreateSession).toHaveBeenCalledTimes(1)
    )
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    try {
      await harness.owner.shutdown()
      await expect(preparing).resolves.toMatchObject({ name: 'AbortError' })

      const detach = vi.fn()
      resolveOpen({
        ...harness.session,
        detachHandlers: [detach]
      })
      await vi.waitFor(() =>
        expect(installed.sessionManager.discardLateSession).toHaveBeenCalledTimes(1)
      )
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(detach).toHaveBeenCalledTimes(1)
      expect(installed.events.modesReady).not.toHaveBeenCalled()
      expect(installed.events.configOptionsReady).not.toHaveBeenCalled()
      expect(installed.events.commandsReady).not.toHaveBeenCalled()
      expect(installed.sessionManager.listSessions()).toEqual([])
      expect(harness.runtime.getHydrated(input.sessionId)).toBeUndefined()
      expect(harness.client.processManager.shutdown).toHaveBeenCalledTimes(1)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('waits for matching in-flight hydration before closing an agent', async () => {
    const harness = createHarness()
    const input = createInput()

    const hydrating = harness.runtime.getOrHydrate(input)
    await harness.runtime.closeByAgent(input.agent.id)
    await hydrating

    expect(harness.runtime.getHydrated(input.sessionId)).toBeUndefined()
    expect(harness.calls).toContain('session.clear')
  })

  it('queues and auto-drains steer input after cancelling an active direct turn', async () => {
    const pendingInputs = new FakePendingInputs()
    const harness = createHarness({ firstPromptNeverSettles: true, pendingInputs })
    const input = createInput()
    const active = harness.runtime.send(input, 'active')
    await vi.waitFor(() => expect(harness.connection.prompt).toHaveBeenCalledTimes(1))

    await harness.runtime.steer(input, 'steer')
    await active

    await vi.waitFor(() => expect(harness.connection.prompt).toHaveBeenCalledTimes(2))
    expect(harness.connection.prompt.mock.calls[1][0].prompt).toEqual([
      { type: 'text', text: 'steer' }
    ])
    await vi.waitFor(() => expect(pendingInputs.records[0].state).toBe('consumed'))
  })

  it('promotes a queued item into active steer after terminal cancellation', async () => {
    const pendingInputs = new FakePendingInputs()
    const harness = createHarness({ firstPromptNeverSettles: true, pendingInputs })
    const input = createInput()
    const active = harness.runtime.send(input, 'active')
    await vi.waitFor(() => expect(harness.connection.prompt).toHaveBeenCalledTimes(1))
    const queued = pendingInputs.queuePendingInput(input.sessionId, {
      text: 'promoted steer',
      files: []
    })

    await expect(
      harness.runtime.steerPendingInput(input.sessionId, queued.id)
    ).resolves.toMatchObject({ id: queued.id, mode: 'steer' })
    await active

    await vi.waitFor(() => expect(harness.connection.prompt).toHaveBeenCalledTimes(2))
    expect(harness.calls.indexOf('projection.cancel')).toBeLessThan(
      harness.calls.indexOf('prompt.2')
    )
    expect(harness.connection.prompt.mock.calls[1][0].prompt).toEqual([
      { type: 'text', text: 'promoted steer' }
    ])
    await vi.waitFor(() => expect(pendingInputs.records[0].state).toBe('consumed'))
  })

  it('does not cancel preparation and drains a steer after the draft becomes ready', async () => {
    let resolvePrepare!: (session: AcpSessionRecord) => void
    const preparePromise = new Promise<AcpSessionRecord>((resolve) => {
      resolvePrepare = resolve
    })
    const pendingInputs = new FakePendingInputs()
    const harness = createHarness({ pendingInputs, preparePromise })
    const input = createInput()
    const preparing = harness.runtime.prepare(input)
    await vi.waitFor(() => expect(harness.sessions.prepare).toHaveBeenCalledTimes(1))

    await harness.runtime.steer(input, 'after prepare')
    expect(harness.connection.cancel).not.toHaveBeenCalled()
    resolvePrepare(harness.session)
    await preparing

    await vi.waitFor(() => expect(harness.connection.prompt).toHaveBeenCalledTimes(1))
    expect(pendingInputs.records[0].state).toBe('consumed')
  })

  it('evicts prepare-only state on process exit without clearing the durable binding', async () => {
    let resolvePrepare!: (session: AcpSessionRecord) => void
    const preparePromise = new Promise<AcpSessionRecord>((resolve) => {
      resolvePrepare = resolve
    })
    const harness = createHarness({ preparePromise })
    const input = createInput()
    const preparing = harness.runtime.prepare(input)
    await vi.waitFor(() => expect(harness.prepareHooks()).toBeDefined())

    harness.prepareHooks()?.onProcessExit?.(toAcpRemoteSessionId('remote'))
    resolvePrepare(harness.session)
    const exited = await preparing

    expect(harness.runtime.getHydrated(input.sessionId)).toBeUndefined()
    expect(harness.calls).not.toContain('session.clear')
    const restored = await harness.runtime.getOrHydrate(input)
    expect(restored).not.toBe(exited)
    expect(harness.createClient).toHaveBeenCalledTimes(1)
  })

  it('releases a claimed pending input when direct preparation resources fail', async () => {
    const pendingInputs = new FakePendingInputs()
    const harness = createHarness({ pendingInputs, resourceRejects: true })
    const input = createInput()

    const record = await harness.runtime.queuePendingInput(input, { text: 'retry me', files: [] })

    await vi.waitFor(async () => {
      expect(await harness.runtime.getHydrated(input.sessionId)?.snapshot()).toMatchObject({
        status: 'error'
      })
      expect(pendingInputs.records[0].state).toBe('pending')
    })
    expect(record.id).toBe(pendingInputs.records[0].id)
    expect(harness.connection.prompt).not.toHaveBeenCalled()
  })
})
