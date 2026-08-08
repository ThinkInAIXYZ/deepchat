import { describe, expect, it, vi } from 'vitest'
import type { SessionRecord } from '@shared/types/agent-interface'
import { SessionDeletion, type SessionDeletionDependencies } from '@/session/deletion'
import { SessionDeletionGate } from '@/session/deletionGate'

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
  const gate = new SessionDeletionGate()
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
    gate,
    orchestration: {
      prepareSessionDeletion: vi.fn(async (sessionId: string) => {
        order.push(`orchestration:${sessionId}`)
      })
    },
    runtime: {
      cleanupSessionBackends: vi.fn(async (sessionId: string) => {
        order.push(`runtime:${sessionId}`)
      }),
      destroySessionBrowser: vi.fn(async (sessionId: string) => {
        order.push(`browser:${sessionId}`)
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
    order,
    gate
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
      'runtime:parent',
      'browser:parent',
      'orchestration:parent',
      'runtime:child',
      'browser:child',
      'orchestration:child',
      'state:child',
      'delete:child',
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
    harness.dependencies.orchestration.prepareSessionDeletion.mockRejectedValue(
      new Error('orchestration failed')
    )
    harness.dependencies.runtime.cleanupSessionBackends.mockRejectedValue(backendError)
    harness.dependencies.runtime.destroySessionBrowser.mockRejectedValue(
      new Error('browser cleanup failed')
    )
    harness.dependencies.state.destroySession.mockRejectedValue(new Error('state failed'))

    await expect(harness.transaction.deleteSessionTree('parent')).resolves.toEqual(['parent'])
    expect(harness.dependencies.state.destroySession).toHaveBeenCalledWith('parent')
    expect(harness.dependencies.sessions.delete).toHaveBeenCalledWith('parent')
    expect(harness.dependencies.orchestration.prepareSessionDeletion).toHaveBeenCalledWith('parent')
    expect(harness.dependencies.runtime.destroySessionBrowser).toHaveBeenCalledWith('parent')
    expect(harness.dependencies.permissions.clearSessionPermissions).toHaveBeenCalledWith('parent')
  })

  it('waits for in-flight child creation and includes the settled child in the delete tree', async () => {
    const harness = createHarness()
    let releaseCreation!: () => void
    const creation = harness.gate.runWithSessionOperation(
      'parent',
      async () =>
        await new Promise<void>((resolve) => {
          releaseCreation = () => {
            harness.records.set(
              'late-child',
              createSession({
                id: 'late-child',
                sessionKind: 'subagent',
                parentSessionId: 'parent'
              })
            )
            resolve()
          }
        })
    )

    const deletion = harness.transaction.deleteSessionTree('parent')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(harness.dependencies.runtime.cleanupSessionBackends).not.toHaveBeenCalled()
    await expect(
      harness.gate.runWithSessionOperation('parent', async () => undefined)
    ).rejects.toThrow('Session is being deleted: parent')

    releaseCreation()
    await creation
    await expect(deletion).resolves.toEqual(['child', 'late-child', 'parent'])
    expect(harness.records.size).toBe(0)
  })
})
