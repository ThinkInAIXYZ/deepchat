import { describe, expect, it, vi } from 'vitest'
import type { SessionNotification } from '@agentclientprotocol/sdk'
import { LODY_EXTENSION_METHODS as methods } from 'acp-extension-core'
import { AcpSessionController } from '@/agent/acp/runtime/acpSessionController'
import type { AcpSessionRecord } from '@/agent/acp/runtime/acpSessionManager'
import { AcpPromptController } from '@/agent/acp/client/session/AcpPromptController'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { AcpExtensionState } from '@shared/types/acp-extensions'

async function fixture() {
  const hooks = new Map<string, any>()
  const sessions = new Map<string, AcpSessionRecord>()
  const request = vi.fn(async () => ({}))
  const manager = {
    getOrCreateSession: async (id: string, agent: { id: string }, callbacks: unknown) => {
      hooks.set(id, callbacks)
      const session = {
        sessionId: 'same-remote-id',
        connectionId: id,
        conversationId: id,
        agentId: agent.id,
        agentInfo: { name: 'dimcode', version: '0.5.12' },
        workdir: '/workspace',
        metadata: {},
        extensions: {
          usage: { version: 1 },
          sessionHistory: { version: 1 },
          steering: {
            version: 1,
            transport: 'request',
            upstreamTurn: 'same',
            configPolicy: 'active'
          },
          subagentEvents: { version: 1 },
          subagents: { version: 1, lifecycle: true, list: true, output: true, cancel: true }
        },
        connection: { request, close: vi.fn() }
      } as unknown as AcpSessionRecord
      sessions.set(id, session)
      return session
    },
    getSession: (id: string) => sessions.get(id),
    clearSession: async (id: string) => sessions.delete(id)
  }
  const persistence = { mergeMetadata: vi.fn(async () => {}) }
  const process = {
    beginReplay: vi.fn(() => vi.fn()),
    elicitation: { redact: (_: string, value: unknown) => value }
  }
  const controller = new AcpSessionController(
    manager as never,
    process as never,
    persistence as never
  )
  const parentEvents = vi.fn()
  for (const id of ['first', 'second'])
    await controller.open(
      toAppSessionId(id),
      { id: 'agent', name: 'Agent', command: 'fixture' },
      { onEvents: parentEvents, onPermission: async () => ({ outcome: { outcome: 'cancelled' } }) }
    )
  const notify = (id: string, update: SessionNotification['update']) =>
    hooks.get(id).onSessionUpdate({ sessionId: 'same-remote-id', update })
  const extension = (id: string, method: string, params: Record<string, unknown>) =>
    hooks.get(id).onExtension({ method, params: { sessionId: 'same-remote-id', ...params } })
  const state = (id: string) => sessions.get(id)!.metadata!.acpExtensions as AcpExtensionState
  return {
    controller,
    request,
    notify,
    extension,
    state,
    parentEvents,
    process,
    hooks,
    sessions,
    persistence
  }
}

const support = {
  stream: ['text', 'tool', 'plan'],
  progress: true,
  outputRead: 'live_tail',
  cancel: true
}

describe('ACP extension ownership', () => {
  it('isolates identical remote, run and tool IDs and keeps a child tool alive after the parent turn', async () => {
    const f = await fixture()
    for (const id of ['first', 'second']) {
      f.extension(id, methods.subagentEvent, {
        version: 1,
        runId: 'child',
        type: 'snapshot',
        snapshot: { state: 'running', support }
      })
      f.extension(id, methods.subagentEvent, {
        version: 1,
        runId: 'child',
        type: 'output',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'same-tool',
          title: id,
          kind: 'read',
          status: 'in_progress',
          rawInput: { path: id }
        }
      })
    }
    f.controller.clearMappedSession(toAppSessionId('first'))
    f.extension('first', methods.subagentEvent, {
      version: 1,
      runId: 'child',
      type: 'output',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'same-tool',
        status: 'completed',
        rawOutput: 'first result'
      }
    })
    expect(f.state('first').runs.child.blocks).toHaveLength(1)
    expect(f.state('first').runs.child.blocks[0].tool_call?.response).toContain('first result')
    expect(f.state('second').runs.child.blocks[0].tool_call?.response).not.toContain('first result')
    expect(f.parentEvents).not.toHaveBeenCalled()
    await f.controller.clear(toAppSessionId('first'))
    await f.controller.clear(toAppSessionId('second'))
  })

  it('buffers early output, respects declared streams and nullable progress, and never uses a run ID to control a task', async () => {
    const f = await fixture()
    f.extension('first', methods.subagentEvent, {
      version: 1,
      runId: 'run',
      type: 'output',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'early' } }
    })
    expect(f.state('first').runs.run).toBeUndefined()
    f.extension('first', methods.subagentEvent, {
      version: 1,
      runId: 'run',
      type: 'snapshot',
      snapshot: { state: 'running', parentToolCallId: 'parent', support }
    })
    f.extension('first', methods.subagentEvent, {
      version: 1,
      runId: 'run',
      type: 'progress',
      progress: { summary: 'busy', turnCount: 2 }
    })
    f.extension('first', methods.subagentEvent, {
      version: 1,
      runId: 'run',
      type: 'progress',
      progress: { summary: null }
    })
    expect(f.state('first').runs.run.blocks[0].content).toBe('early')
    expect(f.state('first').runs.run.progress).toEqual({ summary: null, turnCount: 2 })
    await expect(
      f.controller.controlRemoteTask(toAppSessionId('first'), 'run', 'cancel')
    ).rejects.toThrow('unavailable')
    f.notify('first', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hidden task echo' },
      _meta: {
        lody: {
          task: {
            version: 1,
            kind: 'subagent',
            taskId: 'real-task',
            parentToolCallId: 'parent',
            status: 'in_progress',
            skipTranscript: true
          }
        }
      }
    })
    expect(f.parentEvents).not.toHaveBeenCalled()
    await f.controller.controlRemoteTask(toAppSessionId('first'), 'real-task', 'cancel')
    expect(f.request).toHaveBeenCalledWith(methods.subagentsCancel, {
      sessionId: 'same-remote-id',
      taskId: 'real-task'
    })
    f.hooks.get('first').onProcessExit('same-remote-id')
    expect(f.state('first').runs.run.snapshot?.state).toBe('unknown')
    await expect(
      f.controller.controlRemoteTask(toAppSessionId('first'), 'real-task', 'output')
    ).rejects.toThrow('unavailable')
  })

  it('stages complete repeated-text history without parent output, plan mutation or duplicate accounting', async () => {
    const f = await fixture()
    f.request.mockImplementation(async () => {
      for (const turnId of ['one', 'two'])
        for (const role of ['user', 'agent'])
          f.notify('first', {
            sessionUpdate: `${role}_message_chunk`,
            content: { type: 'text', text: 'same text' },
            _meta: { lody: { turnId } }
          } as SessionNotification['update'])
      f.notify('first', {
        sessionUpdate: 'plan',
        entries: [{ content: 'historical', priority: 'medium', status: 'completed' }]
      })
      f.extension('first', methods.sessionUsageUpdate, {
        usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0 },
        modelUsage: { model: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0 } }
      })
      return {}
    })
    const first = await f.controller.readHistory(toAppSessionId('first'))
    const second = await f.controller.readHistory(toAppSessionId('first'))
    expect(first.verifiedComplete).toBe(true)
    expect(first.entries).toHaveLength(4)
    expect(first.digest).toBe(second.digest)
    expect(first.entries.map((entry) => entry.turnId)).toEqual(['one', 'one', 'two', 'two'])
    expect(f.state('first').usage).toBeUndefined()
    expect(f.state('first').plans).toEqual({})
    expect(f.parentEvents).not.toHaveBeenCalled()
  })

  it('settles steering once when applied arrives before the request response, and marks missing receipts unknown', async () => {
    const f = await fixture()
    const settled = vi.fn()
    f.request.mockImplementation(async () => {
      f.extension('first', methods.sessionSteerApplied, { steerId: 'instruction' })
      return { outcome: 'injected' }
    })
    await f.controller.steer(
      toAppSessionId('first'),
      'instruction',
      [{ type: 'text', text: 'change direction' }],
      settled
    )
    f.extension('first', methods.sessionSteerApplied, { steerId: 'instruction' })
    expect(settled).toHaveBeenCalledExactlyOnceWith('applied')
    expect(f.state('second').steers).toEqual({})
    f.request.mockResolvedValue({ outcome: 'injected' })
    await f.controller.steer(toAppSessionId('first'), 'unconfirmed', [], settled)
    f.controller.finishSteers(toAppSessionId('first'))
    expect(f.state('first').steers).toEqual({ instruction: 'applied', unconfirmed: 'unknown' })
  })

  it('reuses a remotely created fork after local persistence failure and imports target anchors', async () => {
    const f = await fixture()
    const source = f.sessions.get('first')!
    source.supportsSessionFork = true
    source.extensions.forkAtTurn = { version: 1 }
    const fork = vi.fn(async () => ({ sessionId: 'target' }))
    Object.assign(source.connection, { unstable_forkSession: fork })
    let targetUpdate: (update: SessionNotification) => void = () => {}
    let targetUsage: (notification: unknown) => void = () => {}
    Object.assign(f.process, {
      registerSessionListener: (_agent: string, _id: string, handler: typeof targetUpdate) => {
        targetUpdate = handler
        return () => {}
      },
      registerExtensionListener: (
        _id: string,
        _connection: string,
        handler: typeof targetUsage
      ) => {
        targetUsage = handler
        return () => {}
      }
    })
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk failure'))
      .mockResolvedValue(undefined)
    Object.assign(f.persistence, { getProjectMetadata: () => ({}), saveSessionData: save })
    f.request.mockImplementation(async (_method, params) => {
      if (params.sessionId === 'target') {
        targetUpdate({
          sessionId: 'target',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'forked answer' },
            _meta: { lody: { turnId: 'target-turn' } }
          }
        })
        const row = { inputTokens: 50, outputTokens: 10, cacheReadInputTokens: 0 }
        targetUsage({
          method: methods.sessionUsageUpdate,
          params: { sessionId: 'target', usage: row, modelUsage: { model: row } }
        })
      } else
        f.notify('first', {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'source answer' },
          _meta: { lody: { turnId: 'source-turn' } }
        })
      return {}
    })
    await expect(
      f.controller.forkSession(
        toAppSessionId('first'),
        toAppSessionId('local-target'),
        'source-turn',
        'operation'
      )
    ).rejects.toThrow('disk failure')
    const result = await f.controller.forkSession(
      toAppSessionId('first'),
      toAppSessionId('local-target'),
      'source-turn',
      'operation'
    )
    expect(fork).toHaveBeenCalledOnce()
    expect(result.history.entries[0].turnId).toBe('target-turn')
    expect(save.mock.calls[1][5].acpExtensions.usage.sinceFork.inputTokens).toBe(0)
    expect(f.parentEvents).not.toHaveBeenCalled()
    await expect(
      f.controller.forkSession(
        toAppSessionId('first'),
        toAppSessionId('invalid'),
        'foreign-turn',
        'other'
      )
    ).rejects.toThrow('anchor')
  })

  it('does not cancel an ambiguous remote ID across two local sessions', () => {
    const prompts = new AcpPromptController()
    prompts.begin({ sessionId: 'same', conversationId: 'first' })
    prompts.begin({ sessionId: 'same', conversationId: 'second' })
    expect(prompts.cancel('same')).toBeNull()
    expect(prompts.cancel('same', 'first')?.conversationId).toBe('first')
    expect(prompts.getActiveTurn('same', 'second')).not.toBeNull()
  })
})
