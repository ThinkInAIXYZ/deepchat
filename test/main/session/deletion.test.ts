import { describe, expect, it, vi } from 'vitest'
import type { SessionRecord } from '@shared/types/agent-interface'
import { SessionDeletion, type SessionDeletionDependencies } from '@/session/deletion'

const createSession = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'parent',
  agentId: 'deepchat',
  title: 'Session',
  projectDir: null,
  isPinned: false,
  isDraft: false,
  sessionKind: 'regular',
  parentSessionId: null,
  subagentMeta: null,
  createdAt: 100,
  updatedAt: 200,
  ...overrides
})

function createHarness() {
  const records = new Map<string, SessionRecord>([
    ['parent', createSession()],
    ['child', createSession({ id: 'child', sessionKind: 'subagent', parentSessionId: 'parent' })]
  ])
  const order: string[] = []
  const dependencies = {
    sessions: {
      get: vi.fn((sessionId: string) => records.get(sessionId) ?? null),
      list: vi.fn((filters?: { parentSessionId?: string }) =>
        [...records.values()].filter(
          (session) => session.parentSessionId === filters?.parentSessionId
        )
      ),
      delete: vi.fn((sessionId: string) => {
        order.push(`delete:${sessionId}`)
        records.delete(sessionId)
      })
    },
    runtime: {
      cleanupSessionBackends: vi.fn(async (sessionId: string) => {
        order.push(`runtime:${sessionId}`)
      })
    },
    state: {
      destroySession: vi.fn(async (sessionId: string) => {
        order.push(`state:${sessionId}`)
      })
    },
    permissions: { clearSessionPermissions: vi.fn() },
    skills: { clearNewAgentSessionSkills: vi.fn().mockResolvedValue(undefined) }
  } as unknown as SessionDeletionDependencies
  return {
    transaction: new SessionDeletion(dependencies),
    dependencies,
    records,
    order
  }
}

describe('SessionDeletion', () => {
  it('deletes children first and clears every narrow owner before each row', async () => {
    const harness = createHarness()

    await expect(harness.transaction.deleteSessionTree('parent')).resolves.toEqual([
      'child',
      'parent'
    ])
    expect(harness.order).toEqual([
      'runtime:child',
      'state:child',
      'delete:child',
      'runtime:parent',
      'state:parent',
      'delete:parent'
    ])
    expect(harness.dependencies.permissions.clearSessionPermissions).toHaveBeenCalledTimes(2)
    expect(harness.dependencies.skills.clearNewAgentSessionSkills).toHaveBeenCalledTimes(2)
  })

  it('still deletes the session row after partial backend/state cleanup failures', async () => {
    const harness = createHarness()
    harness.records.delete('child')
    const backendError = new Error('backend failed')
    harness.dependencies.runtime.cleanupSessionBackends.mockRejectedValue(backendError)
    harness.dependencies.state.destroySession.mockRejectedValue(new Error('state failed'))

    await expect(harness.transaction.deleteSessionTree('parent')).resolves.toEqual(['parent'])
    expect(harness.dependencies.state.destroySession).toHaveBeenCalledWith('parent')
    expect(harness.dependencies.sessions.delete).toHaveBeenCalledWith('parent')
    expect(harness.dependencies.permissions.clearSessionPermissions).toHaveBeenCalledWith('parent')
  })
})
