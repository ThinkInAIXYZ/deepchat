import { describe, expect, it, vi } from 'vitest'
import { AcpSessionPersistence } from '../../../../src/main/presenter/llmProviderPresenter/acp'
import type { AcpSessionEntity, ISQLitePresenter } from '../../../../src/shared/types/presenters'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/home/tester')
  }
}))

describe('AcpSessionPersistence remote session sync', () => {
  it('imports remote sessions once and updates the existing link on later syncs', async () => {
    let storedSession: AcpSessionEntity | null = null
    const sqlitePresenter = {
      getAcpSessionByAgentAndSessionId: vi.fn(async () => storedSession),
      createConversation: vi.fn(async () => 'conv-imported'),
      updateAcpSessionStatus: vi.fn(async (_conversationId, _agentId, status) => {
        if (storedSession) {
          storedSession = {
            ...storedSession,
            status
          }
        }
      }),
      upsertAcpSession: vi.fn(
        async (
          conversationId: string,
          agentId: string,
          data: {
            sessionId?: string | null
            workdir?: string | null
            status?: AcpSessionEntity['status']
            metadata?: Record<string, unknown> | null
          }
        ) => {
          storedSession = {
            id: 1,
            conversationId,
            agentId,
            sessionId: data.sessionId ?? null,
            workdir: data.workdir ?? null,
            status: data.status ?? 'idle',
            createdAt: 1,
            updatedAt: 2,
            metadata: data.metadata ?? null
          }
        }
      )
    } as unknown as ISQLitePresenter
    const persistence = new AcpSessionPersistence(sqlitePresenter)
    const input = {
      agentId: 'agent-1',
      agentName: 'Agent One',
      providerId: 'acp',
      workdir: '/workspace',
      sessions: [
        {
          sessionId: 'remote-1',
          cwd: '/workspace',
          title: 'Remote title',
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      ]
    }

    const first = await persistence.syncRemoteSessions(input)
    await persistence.clearSession('conv-imported', 'agent-1')
    const second = await persistence.syncRemoteSessions(input)

    expect(first).toMatchObject({
      imported: 1,
      updated: 0,
      skipped: 0,
      sessions: [{ sessionId: 'remote-1', conversationId: 'conv-imported', status: 'imported' }]
    })
    expect(second).toMatchObject({
      imported: 0,
      updated: 1,
      skipped: 0,
      sessions: [{ sessionId: 'remote-1', conversationId: 'conv-imported', status: 'updated' }]
    })
    expect(sqlitePresenter.createConversation).toHaveBeenCalledTimes(1)
    expect(sqlitePresenter.createConversation).toHaveBeenCalledWith(
      'Remote title',
      expect.objectContaining({
        providerId: 'acp',
        modelId: 'agent-1',
        chatMode: 'acp agent',
        agentWorkspacePath: '/workspace',
        acpWorkdirMap: { 'agent-1': '/workspace' }
      })
    )
    expect(sqlitePresenter.upsertAcpSession).toHaveBeenLastCalledWith(
      'conv-imported',
      'agent-1',
      expect.objectContaining({
        sessionId: 'remote-1',
        workdir: '/workspace',
        status: 'idle',
        metadata: expect.objectContaining({
          agentName: 'Agent One',
          remoteSession: expect.objectContaining({
            protocol: 'acp',
            sessionId: 'remote-1',
            cwd: '/workspace'
          }),
          acpSync: expect.objectContaining({
            source: 'session/list'
          })
        })
      })
    )
  })
})
