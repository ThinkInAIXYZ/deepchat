import { describe, expect, it, vi } from 'vitest'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import { AcpAgentInstance } from '@/agent/acp/instance/acpAgentInstance'
import { AcpCompatibilityPromptBuilder } from '@/agent/acp/runtime/acpCompatibilityPromptBuilder'
import { toAppSessionId, toAcpRemoteSessionId } from '@/agent/shared/agentSessionIds'
import type {
  AcpAgentInstanceDependencies,
  AcpCompatibilityProjectionPort,
  AcpProjectionHandle,
  AcpPromptResourceSnapshot
} from '@/agent/acp/instance'
import type { AcpSessionRecord } from '@/agent/acp/runtime/acpSessionManager'

const projectionHandle: AcpProjectionHandle = {
  requestId: 'assistant-message',
  messageId: 'assistant-message',
  userMessageId: 'user-message',
  requestSeq: 1
}

function createResources(): AcpPromptResourceSnapshot {
  return {
    latestUserMessage: { role: 'user', content: 'hello' },
    userContent: {
      text: 'hello',
      files: [],
      links: [],
      search: false,
      think: false
    },
    sections: {
      configured: 'configured',
      runtime: 'runtime',
      environment: 'environment',
      skills: 'skills',
      activeSkills: 'active skills',
      tooling: 'tooling',
      permission: 'permission',
      verification: 'verification'
    },
    localToolDefinitions: [
      {
        type: 'function',
        function: { name: 'local_read', description: 'local only', parameters: {} },
        server: { name: 'agent', description: 'agent' },
        source: 'agent'
      }
    ],
    traceEnabled: true
  }
}

function createHarness(options?: {
  traceRejects?: boolean
  promptRejects?: boolean
  promptNeverSettles?: boolean
  processExitsDuringPermission?: boolean
  requestTimeoutMs?: number
}) {
  const calls: string[] = []
  let hooks:
    | {
        onSessionUpdate(notification: schema.SessionNotification): void
        onPermission(
          request: schema.RequestPermissionRequest
        ): Promise<schema.RequestPermissionResponse>
        onProcessExit?: (sessionId: string) => void
      }
    | undefined
  const connection = {
    prompt: vi.fn(async (request: schema.PromptRequest) => {
      calls.push('connection.prompt')
      if (options?.promptNeverSettles) return await new Promise<schema.PromptResponse>(() => {})
      if (options?.promptRejects) throw new Error('prompt failed')
      if (options?.processExitsDuringPermission) {
        const permission = hooks!.onPermission({
          sessionId: request.sessionId,
          toolCall: { toolCallId: 'tool-call', title: 'Run', kind: 'execute' },
          options: [{ optionId: 'allow-once', kind: 'allow_once' }]
        })
        hooks!.onProcessExit?.(request.sessionId)
        const decision = await permission
        calls.push(`permission.${decision.outcome.outcome}`)
        return { stopReason: 'end_turn' } as schema.PromptResponse
      }
      hooks?.onSessionUpdate({
        sessionId: request.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'world' }
        }
      })
      return { stopReason: 'end_turn' } as schema.PromptResponse
    }),
    cancel: vi.fn(async () => {
      calls.push('connection.cancel')
    })
  }
  const session = {
    sessionId: toAcpRemoteSessionId('remote-session'),
    connection,
    detachHandlers: [],
    workdir: '/workspace',
    providerId: 'acp',
    agentId: 'agent-id',
    conversationId: 'app-session',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    systemPromptSent: false
  } as AcpSessionRecord
  const projection: AcpCompatibilityProjectionPort = {
    setStatus: (status) => calls.push(`status.${status}`),
    begin: () => {
      calls.push('projection.begin')
      return projectionHandle
    },
    attemptViewManifest: (input) => {
      calls.push(`manifest.${input.localToolDefinitions[0]?.function.name}`)
    },
    applyEvents: (_handle, events) => calls.push(`projection.events.${events[0]?.type}`),
    presentPermission: () => calls.push('projection.permission'),
    settlePermission: () => calls.push('projection.permission.settle'),
    complete: (_handle, stopReason) => {
      calls.push(`projection.complete.${stopReason}`)
      return { status: 'completed', stopReason: 'complete' }
    },
    fail: (_handle, error) => {
      const message = error instanceof Error ? error.message : String(error)
      calls.push(`projection.fail.ACP: ${message}`)
      return { status: 'completed', stopReason: 'complete' }
    },
    cancel: () => {
      calls.push('projection.cancel')
      return {
        status: 'aborted',
        stopReason: 'user_stop',
        errorMessage: 'common.error.userCanceledGeneration'
      }
    }
  }
  const dependencies: AcpAgentInstanceDependencies = {
    sessionManager: {
      getOrCreateSession: vi.fn(async (_conversationId, _agent, nextHooks) => {
        calls.push('session.open')
        hooks = nextHooks
        return session
      }),
      clearSession: vi.fn()
    },
    promptResources: {
      resolve: vi.fn(async () => {
        calls.push('resources.resolve')
        return { ...createResources(), requestTimeoutMs: options?.requestTimeoutMs }
      })
    },
    promptBuilder: new AcpCompatibilityPromptBuilder(),
    projection,
    trace: {
      writePrompt: vi.fn(async () => {
        calls.push('trace.write')
        if (options?.traceRejects) throw new Error('trace failed')
      })
    },
    rateGate: {
      wait: vi.fn(async () => {
        calls.push('rate.wait')
      })
    },
    turns: {
      startTurn: vi.fn(async (input) => {
        expect(input.userMessageId).toBeNull()
        calls.push('turn.start')
      }),
      finishTurn: vi.fn(async (input) => {
        calls.push(`turn.finish.${input.status}`)
      })
    },
    debug: {
      appendDebugEvent: vi.fn((_agentId, event) => calls.push(`debug.${event.kind}`))
    }
  }
  const instance = new AcpAgentInstance(
    {
      sessionId: toAppSessionId('app-session'),
      agent: { id: 'agent-id', name: 'Agent', command: 'agent-command' },
      workdir: '/workspace',
      scope: 'regular'
    },
    dependencies
  )
  return { calls, connection, dependencies, instance, session }
}

describe('AcpAgentInstance', () => {
  it('preserves the direct prompt causal order and keeps local tools out of ACP delivery', async () => {
    const harness = createHarness()

    await expect(harness.instance.send('hello')).resolves.toEqual({
      requestId: 'assistant-message',
      messageId: 'assistant-message'
    })

    expect(harness.calls).toEqual([
      'status.generating',
      'resources.resolve',
      'projection.begin',
      'manifest.local_read',
      'rate.wait',
      'session.open',
      'turn.start',
      'debug.request',
      'trace.write',
      'connection.prompt',
      'projection.events.text',
      'debug.response',
      'turn.finish.completed',
      'projection.complete.end_turn',
      'status.idle',
      'connection.cancel'
    ])
    expect(harness.connection.prompt).toHaveBeenCalledWith({
      sessionId: 'remote-session',
      prompt: [
        {
          type: 'text',
          text: 'System instructions:\nconfigured\n\nruntime\n\nenvironment\n\nskills\n\nactive skills\n\ntooling\n\npermission\n\nverification'
        },
        { type: 'text', text: 'hello' }
      ]
    })
    expect(harness.session.systemPromptSent).toBe(true)
  })

  it('keeps trace persistence fail-open and still cancels the successful provider prompt', async () => {
    const harness = createHarness({ traceRejects: true })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await harness.instance.send('hello')

    expect(harness.connection.prompt).toHaveBeenCalledTimes(1)
    expect(harness.calls.indexOf('trace.write')).toBeLessThan(
      harness.calls.indexOf('connection.prompt')
    )
    expect(harness.calls.at(-1)).toBe('connection.cancel')
    warning.mockRestore()
  })

  it('does not mark the system prompt sent when the ACP prompt fails', async () => {
    const harness = createHarness({ promptRejects: true })

    await expect(harness.instance.send('hello')).resolves.toEqual({
      requestId: 'assistant-message',
      messageId: 'assistant-message'
    })

    expect(harness.session.systemPromptSent).toBe(false)
    expect(harness.calls).toContain('turn.finish.error')
    expect(harness.calls).toContain('projection.fail.ACP: prompt failed')
    expect(harness.calls).toContain('status.error')
    expect(harness.calls.at(-1)).toBe('connection.cancel')
  })

  it('settles permission and cancels the turn when the bound process exits', async () => {
    const harness = createHarness({ processExitsDuringPermission: true })

    await harness.instance.send('hello')

    expect(harness.calls).toContain('projection.permission')
    expect(harness.calls).toContain('projection.permission.settle')
    expect(harness.calls).toContain('permission.cancelled')
    expect(harness.calls).toContain('turn.finish.cancelled')
    expect(harness.calls).toContain('projection.cancel')
    expect(harness.calls).toContain('status.idle')
    expect(harness.calls.at(-1)).toBe('connection.cancel')
  })

  it('treats request timeout as an error while caller and process aborts stay cancelled', async () => {
    vi.useFakeTimers()
    try {
      const harness = createHarness({ promptNeverSettles: true, requestTimeoutMs: 25 })
      const sending = harness.instance.send('hello')

      await vi.advanceTimersByTimeAsync(25)
      await expect(sending).resolves.toEqual({
        requestId: 'assistant-message',
        messageId: 'assistant-message'
      })

      expect(harness.connection.cancel).toHaveBeenCalledTimes(2)
      expect(harness.calls).toContain('turn.finish.error')
      expect(harness.calls).toContain('projection.fail.ACP: Request timed out after 25ms')
      expect(harness.calls).toContain('status.error')
      expect(harness.calls).not.toContain('projection.cancel')
    } finally {
      vi.useRealTimers()
    }
  })
})
