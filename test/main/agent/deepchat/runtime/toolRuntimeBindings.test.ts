import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@shared/types/core/chat-message'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  createClosedToolResultPruner,
  createToolPermissionReviewer,
  createToolResultNormalizer,
  type ToolRuntimeBindingDependencies
} from '@/agent/deepchat/runtime/toolRuntimeBindings'
import { JevPruningFeedback, JEV_PRUNING_TIGHTENED_DROP_BELOW } from '@/agent/deepchat/runtime/jevPruningFeedback'

const normalizeToolResultContent = vi.hoisted(() => vi.fn(async () => [{ type: 'text', text: 'ok' }]))
const reviewAutoApproveToolPermission = vi.hoisted(() =>
  vi.fn(async () => ({ decision: 'ask_user' }))
)

vi.mock('@/agent/deepchat/runtime/toolAdapters', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  normalizeToolResultContent
}))
vi.mock('@/agent/deepchat/runtime/toolPermissionReviewer', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reviewAutoApproveToolPermission
}))

const SESSION_ID = 'session'

function createHarness(persisted?: { provider_id?: string; model_id?: string }) {
  const runtime = new DeepChatAgentRuntime()
  const abortSignal = new AbortController().signal
  const deps = {
    providerSettings: {},
    agentSettings: {},
    providerRuntime: {},
    registry: runtime,
    sessionStore: { get: vi.fn(() => persisted) },
    identity: { getAgentId: vi.fn(() => 'agent-a') },
    runLifecycle: { getAbortSignal: vi.fn(() => abortSignal) },
    pruningFeedback: new JevPruningFeedback()
  } as unknown as ToolRuntimeBindingDependencies

  return { abortSignal, deps, runtime }
}

const TOOL_INPUT = {
  sessionId: SESSION_ID,
  toolCallId: 'tc1',
  toolName: 'read',
  toolArgs: '{}',
  content: [{ type: 'text' as const, text: 'raw' }],
  isError: false
}

describe('tool runtime bindings', () => {
  it('observes a re-run of a pruned call on the shared feedback object', async () => {
    // The wiring that makes pruning self-correcting: the tool-result path sees every call, so a
    // re-run of something whose result was pruned is noticed there without a new hook.
    const { deps } = createHarness()
    deps.pruningFeedback.recordPruned(SESSION_ID, [
      { toolCallId: 'tc0', toolName: 'read', toolArgs: '{}' }
    ])

    await createToolResultNormalizer(deps)(TOOL_INPUT)

    expect(deps.pruningFeedback.missCount(SESSION_ID)).toBe(1)
    expect(deps.pruningFeedback.policyFor(SESSION_ID)).toEqual({
      dropBelow: JEV_PRUNING_TIGHTENED_DROP_BELOW
    })
  })

  it('maps the tool result port signal onto the domain abort signal', async () => {
    const { deps } = createHarness()
    normalizeToolResultContent.mockClear()
    const signal = new AbortController().signal

    await createToolResultNormalizer(deps)({ ...TOOL_INPUT, signal })

    expect(normalizeToolResultContent.mock.calls[0][1]).toMatchObject({
      toolCallId: 'tc1',
      abortSignal: signal
    })
  })

  it('prefers hydrated runtime model facts over the persisted session row', async () => {
    const { deps, runtime } = createHarness({ provider_id: 'persisted', model_id: 'persisted' })
    runtime.getOrHydrate(toAppSessionId(SESSION_ID)).setRuntimeState({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access'
    })
    normalizeToolResultContent.mockClear()

    await createToolResultNormalizer(deps)(TOOL_INPUT)

    expect(normalizeToolResultContent.mock.calls[0][0].getSessionModel(SESSION_ID)).toEqual({
      providerId: 'openai',
      modelId: 'gpt-5',
      agentId: 'agent-a'
    })
  })

  it('falls back to persisted model facts when no instance is hydrated', async () => {
    const { deps } = createHarness({ provider_id: 'anthropic', model_id: 'claude' })
    normalizeToolResultContent.mockClear()

    await createToolResultNormalizer(deps)(TOOL_INPUT)

    expect(normalizeToolResultContent.mock.calls[0][0].getSessionModel(SESSION_ID)).toEqual({
      providerId: 'anthropic',
      modelId: 'claude',
      agentId: 'agent-a'
    })
  })

  it('routes the abort signal lookup through the run lifecycle owner', async () => {
    const { abortSignal, deps } = createHarness()
    normalizeToolResultContent.mockClear()

    await createToolResultNormalizer(deps)(TOOL_INPUT)

    expect(normalizeToolResultContent.mock.calls[0][0].getAbortSignal(SESSION_ID)).toBe(abortSignal)
    expect(deps.runLifecycle.getAbortSignal).toHaveBeenCalledWith(SESSION_ID)
  })

  it('binds permission review to the same session identity owner', async () => {
    const { deps } = createHarness()
    reviewAutoApproveToolPermission.mockClear()
    const context = {
      providerId: 'openai',
      modelId: 'gpt-5',
      messages: [],
      signal: new AbortController().signal
    }
    const request = { sessionId: SESSION_ID, messageId: 'm1', toolCallId: 'tc1' }

    await createToolPermissionReviewer(deps)(request as never, context)

    const [dependencies, forwardedRequest, forwardedContext] =
      reviewAutoApproveToolPermission.mock.calls[0]
    expect(forwardedRequest).toBe(request)
    expect(forwardedContext).toBe(context)
    expect(dependencies.getSessionAgentId(SESSION_ID)).toBe('agent-a')
  })
})

describe('createClosedToolResultPruner', () => {
  const SESSION = 'session'
  const messages = () =>
    [
      { role: 'user', content: 'the task' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', function: { name: 'exec', arguments: '{}' } }]
      },
      { role: 'tool', tool_call_id: 'c1', content: 'x'.repeat(3_000) }
    ] as unknown as ChatMessage[]

  const buildDeps = (judgmentModel: unknown, runJudgment = vi.fn()) =>
    ({
      agentSettings: {
        resolveDeepChatAgentConfig: vi.fn(async () => ({ judgmentModel }))
      },
      identity: { getAgentId: vi.fn(() => 'agent-a') },
      providerRuntime: {
        executeWithRateLimit: vi.fn(async () => undefined),
        runJudgment
      },
      pruningFeedback: new JevPruningFeedback()
    }) as unknown as ToolRuntimeBindingDependencies

  it('does nothing when no judgment model is configured', async () => {
    // The off-by-default guarantee: this is the binding that would make the network call, and with no
    // model selected it must return the messages untouched without reaching the provider.
    const runJudgment = vi.fn()
    const deps = buildDeps(undefined, runJudgment)
    const before = messages()

    const result = await createClosedToolResultPruner(deps)({
      sessionId: SESSION,
      messages: before,
      protectedToolCallIds: new Set(),
      signal: new AbortController().signal
    })

    expect(result).toBe(before)
    expect(runJudgment).not.toHaveBeenCalled()
  })

  it('does nothing once the session has stopped pruning', async () => {
    const runJudgment = vi.fn()
    const deps = buildDeps({ providerId: 'typesafe', modelId: 'jev-latest' }, runJudgment)
    // Three misses is the stop.
    for (let i = 0; i < 3; i += 1) {
      deps.pruningFeedback.recordPruned(SESSION, [
        { toolCallId: `p${i}`, toolName: 'exec', toolArgs: `args-${i}` }
      ])
      deps.pruningFeedback.observeToolCall({
        sessionId: SESSION,
        toolCallId: `r${i}`,
        toolName: 'exec',
        toolArgs: `args-${i}`
      })
    }
    const before = messages()

    const result = await createClosedToolResultPruner(deps)({
      sessionId: SESSION,
      messages: before,
      protectedToolCallIds: new Set(),
      signal: new AbortController().signal
    })

    expect(result).toBe(before)
    expect(runJudgment).not.toHaveBeenCalled()
  })

  it('asks the judgment model when configured, and keeps a result it cannot read', async () => {
    const runJudgment = vi.fn(async () => ({ model: 'jev-1.13.0', answers: {} }))
    const deps = buildDeps({ providerId: 'typesafe', modelId: 'jev-latest' }, runJudgment)
    const before = messages()

    const result = await createClosedToolResultPruner(deps)({
      sessionId: SESSION,
      messages: before,
      protectedToolCallIds: new Set(),
      signal: new AbortController().signal
    })

    expect(runJudgment).toHaveBeenCalledTimes(1)
    // No readable answers, so every result is kept: an unreadable answer is not evidence of staleness.
    expect(result).toBe(before)
  })
})
