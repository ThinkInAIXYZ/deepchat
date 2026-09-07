import { describe, expect, it, vi } from 'vitest'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  createToolPermissionReviewer,
  createToolResultNormalizer,
  type ToolRuntimeBindingDependencies
} from '@/agent/deepchat/runtime/toolRuntimeBindings'

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
    runLifecycle: { getAbortSignal: vi.fn(() => abortSignal) }
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
