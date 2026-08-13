import logger from '@shared/logger'
import type {
  AssistantMessageBlock,
  ChatMessageRecord,
  DeepChatSessionState
} from '@shared/types/agent-interface'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { createLoopRun } from '@/agent/deepchat/loop/loopRun'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  RunLifecycleCoordinator,
  type RunLifecycleCoordinatorPorts
} from '@/agent/deepchat/runtime/runLifecycleCoordinator'
import {
  SessionStatusPublisher,
  type SessionStatusPublisherPorts
} from '@/agent/deepchat/runtime/sessionStatusPublisher'
import { POSIX_COMMAND_SHELL } from '../../../../helpers/commandShell'

const SESSION_ID = 'session'

function createState(status: DeepChatSessionState['status'] = 'idle'): DeepChatSessionState {
  return {
    status,
    providerId: 'openai',
    modelId: 'gpt-5',
    permissionMode: 'full_access'
  }
}

function createRun(
  sessionId: string,
  runId: string,
  messageId: string,
  abortController = new AbortController()
) {
  return createLoopRun({
    runId,
    sessionId: toAppSessionId(sessionId),
    messageId,
    abortController,
    messages: [],
    streamState: {},
    resources: { toolDefinitions: [], activeSkillNames: [], commandShell: POSIX_COMMAND_SHELL }
  })
}

function createPendingAction(toolCallId: string): AssistantMessageBlock {
  return {
    type: 'action',
    action_type: 'tool_call_permission',
    status: 'pending',
    timestamp: 1,
    tool_call: { id: toolCallId, name: 'write', params: '{}' },
    extra: { needsUserAction: true, permissionType: 'write' }
  }
}

function createMessage(
  id: string,
  blocks: AssistantMessageBlock[],
  orderSeq = 1,
  metadata = '{}'
): ChatMessageRecord {
  return {
    id,
    sessionId: SESSION_ID,
    orderSeq,
    role: 'assistant',
    content: JSON.stringify(blocks),
    status: 'pending',
    isContextEdge: 0,
    metadata,
    createdAt: 1,
    updatedAt: 1
  }
}

function createHarness(initialMessages: ChatMessageRecord[] = []) {
  const runtime = new DeepChatAgentRuntime()
  const messages = [...initialMessages]
  const statusPorts: SessionStatusPublisherPorts = {
    publishEvent: vi.fn(),
    publishSessionUpdate: vi.fn(),
    sessionUiPort: { refreshSessionUi: vi.fn() }
  }
  const transcript: RunLifecycleCoordinatorPorts['transcript'] = {
    getMessage: vi.fn((messageId: string) => messages.find(({ id }) => id === messageId) ?? null),
    getMessages: vi.fn((sessionId: string) =>
      messages.filter((message) => message.sessionId === sessionId)
    ),
    setMessageError: vi.fn()
  }
  const pendingInputWakeup: RunLifecycleCoordinatorPorts['pendingInputWakeup'] = {
    drain: vi.fn().mockResolvedValue(false)
  }
  const terminalObserver: RunLifecycleCoordinatorPorts['terminalObserver'] = {
    observeTerminal: vi.fn()
  }
  const emitMessageRefresh = vi.fn()
  const coordinator = new RunLifecycleCoordinator({
    runtime,
    statusPublisher: new SessionStatusPublisher(statusPorts),
    transcript,
    pendingInputWakeup,
    terminalObserver,
    messageProjection: { refresh: emitMessageRefresh }
  })

  return {
    coordinator,
    emitMessageRefresh,
    messages,
    pendingInputWakeup,
    runtime,
    statusPorts,
    terminalObserver,
    transcript
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('RunLifecycleCoordinator', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('replaces an aborted lingering run with a fresh operation controller', async () => {
    const { coordinator } = createHarness()
    const scope = coordinator.getOrCreateScope(SESSION_ID)
    const oldController = new AbortController()
    const permissionResolve = vi.fn().mockResolvedValue(undefined)
    coordinator.registerRun(scope, createRun(SESSION_ID, 'run-old', 'message-old', oldController))
    scope.instance.registerActiveProviderPermission({
      requestId: 'permission-old',
      messageId: 'message-old',
      toolCallId: 'tool-old',
      providerId: 'acp',
      permissionType: 'write',
      resolve: permissionResolve
    })
    oldController.abort()

    const replacement = coordinator.ensureOperationController(scope)
    await flushPromises()

    expect(replacement).not.toBe(oldController)
    expect(replacement.signal.aborted).toBe(false)
    expect(scope.instance.getActiveGeneration()).toBeUndefined()
    expect(scope.instance.getAbortController()).toBe(replacement)
    expect(permissionResolve).toHaveBeenCalledOnce()
    expect(permissionResolve).toHaveBeenCalledWith(false)
  })

  it('requires the exact controller owner before clearing operation state', () => {
    const { coordinator } = createHarness()
    const scope = coordinator.getOrCreateScope(SESSION_ID)
    const owned = coordinator.ensureOperationController(scope)
    const replacement = new AbortController()
    scope.instance.setAbortController(replacement)

    expect(coordinator.clearOperationController(scope)).toBe(false)
    expect(coordinator.clearOperationController(scope, owned)).toBe(false)
    expect(scope.instance.getAbortController()).toBe(replacement)
    expect(coordinator.clearOperationController(scope, replacement)).toBe(true)
    expect(scope.instance.getAbortController()).toBeUndefined()
  })

  it('cleans a stale scope run without touching a replacement instance', async () => {
    const { coordinator, runtime } = createHarness()
    const sessionId = toAppSessionId(SESSION_ID)
    const staleScope = coordinator.getOrCreateScope(SESSION_ID)
    const staleRun = createRun(SESSION_ID, 'shared-run', 'stale-message')
    const stalePermissionResolve = vi.fn().mockResolvedValue(undefined)
    coordinator.registerRun(staleScope, staleRun)
    staleScope.instance.registerActiveProviderPermission({
      requestId: 'stale-permission',
      messageId: 'stale-message',
      toolCallId: 'stale-tool',
      providerId: 'acp',
      permissionType: 'write',
      resolve: stalePermissionResolve
    })

    runtime.evict(sessionId)
    const currentScope = coordinator.getOrCreateScope(SESSION_ID)
    const currentRun = createRun(SESSION_ID, 'shared-run', 'current-message')
    coordinator.registerRun(currentScope, currentRun)

    expect(coordinator.clearRun(staleScope, staleRun.runId)).toBe(true)
    await flushPromises()

    expect(staleScope.instance.getActiveGeneration()).toBeUndefined()
    expect(currentScope.instance.getActiveGeneration()).toBe(currentRun)
    expect(stalePermissionResolve).toHaveBeenCalledOnce()
  })

  it('rejects a run whose session does not match its scope', () => {
    const { coordinator } = createHarness()
    const scope = coordinator.getOrCreateScope(SESSION_ID)
    const mismatchedRun = createRun('other', 'run-other', 'message-other')

    expect(() => coordinator.registerRun(scope, mismatchedRun)).toThrow(
      'Loop run run-other belongs to session other, not session'
    )
    expect(scope.instance.getActiveGeneration()).toBeUndefined()
  })

  it('keeps run, message and first-turn-ready fences distinct', async () => {
    const { coordinator } = createHarness()
    const scope = coordinator.getOrCreateScope(SESSION_ID)
    const run = createRun(SESSION_ID, 'run-1', 'message-1')
    coordinator.registerRun(scope, run)

    expect(coordinator.isRunCurrentForScope(scope, 'run-1')).toBe(true)
    expect(coordinator.isMessageAssociatedWithRun(run, 'message-1')).toBe(true)
    expect(coordinator.isMessageAssociatedWithRun(run, 'message-2')).toBe(false)
    expect(coordinator.resolveStreamRequestId(SESSION_ID, 'message-1')).toBe('run-1')
    expect(coordinator.resolveStreamRequestId(SESSION_ID, 'message-2')).toBe('message-2')
    expect(coordinator.markFirstTurnReady(scope, 'run-other')).toBe(false)

    const ready = scope.instance.waitForFirstTurnReady({ timeoutMs: 100 })
    expect(coordinator.markFirstTurnReady(scope, 'run-1')).toBe(true)
    await expect(ready).resolves.toBe(true)

    coordinator.clearFirstTurnReady(SESSION_ID)
    run.abortController.abort()
    expect(coordinator.markFirstTurnReady(scope, 'run-1')).toBe(false)
  })

  it('does not hydrate an evicted session while clearing first-turn readiness', () => {
    const { coordinator, runtime } = createHarness()
    const sessionId = toAppSessionId(SESSION_ID)
    coordinator.getOrCreateScope(SESSION_ID)
    runtime.evict(sessionId)

    coordinator.clearFirstTurnReady(SESSION_ID)

    expect(runtime.getHydrated(sessionId)).toBeUndefined()
  })

  it('observes a stale terminal result without overwriting the current run status', () => {
    const { coordinator, terminalObserver } = createHarness()
    const scope = coordinator.getOrCreateScope(SESSION_ID)
    scope.instance.setRuntimeState(createState('generating'))
    const staleRun = createRun(SESSION_ID, 'run-stale', 'message-stale')
    const currentRun = createRun(SESSION_ID, 'run-current', 'message-current')
    coordinator.registerRun(scope, staleRun)
    coordinator.registerRun(scope, currentRun)
    vi.mocked(terminalObserver.observeTerminal).mockImplementation(() => {
      expect(scope.state()?.status).toBe('generating')
    })

    coordinator.applyProcessResultStatus(
      SESSION_ID,
      { status: 'completed', stopReason: 'complete' },
      staleRun.runId
    )

    expect(terminalObserver.observeTerminal).toHaveBeenCalledOnce()
    expect(scope.state()?.status).toBe('generating')

    coordinator.applyProcessResultStatus(
      SESSION_ID,
      { status: 'completed', stopReason: 'complete' },
      currentRun.runId
    )

    expect(terminalObserver.observeTerminal).toHaveBeenCalledTimes(2)
    expect(scope.state()?.status).toBe('idle')
  })

  it('does not let an aborted turn overwrite a replacement operation status', () => {
    const message = createMessage('message-old', [])
    const { coordinator, terminalObserver, transcript } = createHarness([message])
    const scope = coordinator.getOrCreateScope(SESSION_ID)
    scope.instance.setRuntimeState(createState('generating'))
    const replacement = coordinator.ensureOperationController(scope)

    coordinator.settleAbortedTurn(SESSION_ID, message.id, 'run-old', '{}')

    expect(scope.state()?.status).toBe('generating')
    expect(scope.instance.getAbortController()).toBe(replacement)
    expect(transcript.setMessageError).toHaveBeenCalledOnce()
    expect(terminalObserver.observeTerminal).toHaveBeenCalledOnce()
  })

  it('settles a paused interaction immediately when no async owner remains', async () => {
    const message = createMessage(
      'message-paused',
      [createPendingAction('tool-1')],
      1,
      '{"runId":"run-1"}'
    )
    const { coordinator, pendingInputWakeup, terminalObserver, transcript } = createHarness([
      message
    ])
    const scope = coordinator.getOrCreateScope(SESSION_ID)
    scope.instance.setRuntimeState(createState('generating'))

    expect(coordinator.refreshPendingInteractions(SESSION_ID)).toBe(true)
    await coordinator.cancel(SESSION_ID)

    expect(scope.instance.getPendingInteractions()).toEqual([])
    expect(scope.state()?.status).toBe('idle')
    expect(transcript.setMessageError).toHaveBeenCalledOnce()
    expect(terminalObserver.observeTerminal).toHaveBeenCalledOnce()
    expect(pendingInputWakeup.drain).toHaveBeenCalledWith(SESSION_ID, 'completed')
  })

  it('preserves pending interaction order across assistant messages', () => {
    const first = createMessage('message-1', [
      createPendingAction('tool-1'),
      createPendingAction('tool-2')
    ])
    const second = createMessage('message-2', [createPendingAction('tool-3')], 2)
    const { coordinator } = createHarness([first, second])
    const scope = coordinator.getOrCreateScope(SESSION_ID)

    expect(coordinator.refreshPendingInteractions(SESSION_ID)).toBe(true)
    expect(scope.instance.getPendingInteractions()).toEqual([
      expect.objectContaining({ messageId: 'message-1', toolCallId: 'tool-1', order: 0 }),
      expect.objectContaining({ messageId: 'message-1', toolCallId: 'tool-2', order: 1 }),
      expect.objectContaining({ messageId: 'message-2', toolCallId: 'tool-3', order: 2 })
    ])
  })

  it('terminalizes every assistant message represented by pending interactions', async () => {
    const first = createMessage(
      'message-1',
      [createPendingAction('tool-1'), createPendingAction('tool-2')],
      1,
      '{"runId":"run-1"}'
    )
    const second = createMessage(
      'message-2',
      [createPendingAction('tool-3')],
      2,
      '{"runId":"run-2"}'
    )
    const { coordinator, emitMessageRefresh, pendingInputWakeup, terminalObserver, transcript } =
      createHarness([first, second])
    const scope = coordinator.getOrCreateScope(SESSION_ID)
    scope.instance.setRuntimeState(createState('generating'))

    expect(coordinator.refreshPendingInteractions(SESSION_ID)).toBe(true)
    await coordinator.cancel(SESSION_ID)

    expect(scope.instance.getPendingInteractions()).toEqual([])
    expect(vi.mocked(transcript.setMessageError).mock.calls.map(([messageId]) => messageId)).toEqual([
      'message-1',
      'message-2'
    ])
    expect(emitMessageRefresh.mock.calls.map(([, messageId]) => messageId)).toEqual([
      'message-1',
      'message-2'
    ])
    expect(terminalObserver.observeTerminal).toHaveBeenCalledOnce()
    expect(scope.state()?.status).toBe('idle')
    expect(pendingInputWakeup.drain).toHaveBeenCalledWith(SESSION_ID, 'completed')
  })

  it('cancels provider permissions exactly once and ignores already-stale requests', async () => {
    const { coordinator } = createHarness()
    const scope = coordinator.getOrCreateScope(SESSION_ID)
    const resolve = vi
      .fn()
      .mockRejectedValue(new Error('Unknown ACP permission request: permission-1'))
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    scope.instance.registerActiveProviderPermission({
      requestId: 'permission-1',
      messageId: 'message-1',
      toolCallId: 'tool-1',
      providerId: 'acp',
      permissionType: 'write',
      resolve
    })

    await coordinator.cancel(SESSION_ID)
    await coordinator.cancel(SESSION_ID)
    await flushPromises()

    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('reports genuine provider permission cancellation failures', async () => {
    const { coordinator } = createHarness()
    const scope = coordinator.getOrCreateScope(SESSION_ID)
    const failure = new Error('permission bridge failed')
    const resolve = vi.fn().mockRejectedValue(failure)
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    scope.instance.registerActiveProviderPermission({
      requestId: 'permission-1',
      messageId: 'message-1',
      toolCallId: 'tool-1',
      providerId: 'acp',
      permissionType: 'write',
      resolve
    })

    await coordinator.cancel(SESSION_ID)
    await flushPromises()

    expect(warn).toHaveBeenCalledWith(
      '[DeepChatAgent] Failed to cancel ACP permission request permission-1:',
      { name: 'Error' }
    )
  })

  it('isolates scheduled queue wake failures without duplicate lifecycle logging', async () => {
    const { coordinator, pendingInputWakeup } = createHarness()
    const error = new Error('queue unavailable')
    vi.mocked(pendingInputWakeup.drain).mockRejectedValueOnce(error)
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => undefined)

    coordinator.schedulePendingInputDrain(SESSION_ID, 'completed')
    await flushPromises()

    expect(logError).not.toHaveBeenCalled()
  })
})
