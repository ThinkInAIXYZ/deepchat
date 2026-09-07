import { describe, expect, it, vi } from 'vitest'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  SessionIdentityService,
  type SessionIdentityServiceDependencies
} from '@/agent/deepchat/runtime/sessionIdentityService'

const SESSION_ID = 'session'

function createHarness(row?: { agent_id?: string; session_kind?: string }) {
  const runtime = new DeepChatAgentRuntime()
  const get = vi.fn(() => row)
  const deps = {
    registry: runtime,
    database: { newSessionsTable: { get } }
  } as unknown as SessionIdentityServiceDependencies

  return { get, identity: new SessionIdentityService(deps), runtime }
}

describe('SessionIdentityService', () => {
  it('prefers the cached instance agent id without touching persisted session rows', () => {
    const { get, identity, runtime } = createHarness({ agent_id: 'persisted' })
    runtime.getOrHydrate(toAppSessionId(SESSION_ID)).setAgentId('  cached  ')

    expect(identity.getAgentId(SESSION_ID)).toBe('cached')
    expect(get).not.toHaveBeenCalled()
  })

  it('caches the persisted agent id back onto a hydrated instance', () => {
    const { get, identity, runtime } = createHarness({ agent_id: ' persisted ' })
    const instance = runtime.getOrHydrate(toAppSessionId(SESSION_ID))

    expect(identity.getAgentId(SESSION_ID)).toBe('persisted')
    expect(instance.getAgentId()).toBe('persisted')

    get.mockClear()
    expect(identity.getAgentId(SESSION_ID)).toBe('persisted')
    expect(get).not.toHaveBeenCalled()
  })

  it('returns undefined without hydrating when no identity exists anywhere', () => {
    const { identity, runtime } = createHarness({ agent_id: '   ' })

    expect(identity.getAgentId(SESSION_ID)).toBeUndefined()
    expect(runtime.getHydrated(toAppSessionId(SESSION_ID))).toBeUndefined()
  })

  it('classifies an ACP-backed subagent only for subagent rows', () => {
    const subagent = createHarness({ session_kind: 'subagent' })
    expect(subagent.identity.isAcpBackedSubagentSession(SESSION_ID, 'acp')).toBe(true)
    expect(subagent.identity.isAcpBackedSubagentSession(SESSION_ID, 'openai')).toBe(false)

    const regular = createHarness({ session_kind: 'regular' })
    expect(regular.identity.isAcpBackedSubagentSession(SESSION_ID, 'acp')).toBe(false)

    const missing = createHarness(undefined)
    expect(missing.identity.isAcpBackedSubagentSession(SESSION_ID, 'acp')).toBe(false)
  })

  it('reads the persisted Session kind without hydrating runtime state', () => {
    const subagent = createHarness({ session_kind: 'subagent' })
    expect(subagent.identity.getSessionKind(SESSION_ID)).toBe('subagent')
    expect(subagent.runtime.getHydrated(toAppSessionId(SESSION_ID))).toBeUndefined()

    expect(createHarness(undefined).identity.getSessionKind(SESSION_ID)).toBeNull()
  })

  it('falls back to the hydrated runtime provider when no provider is supplied', () => {
    const { identity, runtime } = createHarness({ session_kind: 'subagent' })
    runtime.getOrHydrate(toAppSessionId(SESSION_ID)).setRuntimeState({
      status: 'idle',
      providerId: ' acp ',
      modelId: 'model',
      permissionMode: 'default'
    })

    expect(identity.isAcpBackedSubagentSession(SESSION_ID)).toBe(true)
  })
})
