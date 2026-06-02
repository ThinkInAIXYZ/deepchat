import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AcpSessionPersistence } from '../../../../src/main/presenter/llmProviderPresenter/acp'
import type { AcpSessionEntity, ISQLitePresenter } from '../../../../src/shared/types/presenters'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/home/tester')
  }
}))

describe('AcpSessionPersistence remote session sync', () => {
  beforeEach(() => {
    const usableDirectories = new Set([process.cwd(), path.dirname(process.cwd()), '/home/tester'])
    vi.mocked(fs.existsSync).mockImplementation((target) => usableDirectories.has(String(target)))
    vi.mocked(fs.statSync).mockImplementation(
      (target) =>
        ({
          isDirectory: () => usableDirectories.has(String(target))
        }) as fs.Stats
    )
  })

  it('falls back from missing persisted workdirs to the default workdir', () => {
    const homeDir = process.cwd()
    const missingDir = path.join(homeDir, 'missing-workdir-for-acp-test')
    vi.mocked(app.getPath).mockReturnValue(homeDir)

    const persistence = new AcpSessionPersistence({} as ISQLitePresenter)

    expect(persistence.isWorkdirUsable(missingDir)).toBe(false)
    expect(persistence.resolveWorkdir(missingDir)).toBe(homeDir)

    vi.mocked(app.getPath).mockReturnValue('/home/tester')
  })

  it('imports remote sessions once and updates the existing link on later syncs', async () => {
    const workspaceDir = process.cwd()
    const localWorkdir = path.dirname(workspaceDir)
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
      workdir: workspaceDir,
      sessions: [
        {
          sessionId: 'remote-1',
          cwd: workspaceDir,
          title: 'Remote title',
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      ]
    }

    const first = await persistence.syncRemoteSessions(input)
    await persistence.clearSession('conv-imported', 'agent-1')
    storedSession = storedSession ? { ...storedSession, workdir: localWorkdir } : storedSession
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
        agentWorkspacePath: workspaceDir,
        acpWorkdirMap: { 'agent-1': workspaceDir }
      })
    )
    expect(sqlitePresenter.upsertAcpSession).toHaveBeenLastCalledWith(
      'conv-imported',
      'agent-1',
      expect.objectContaining({
        sessionId: 'remote-1',
        workdir: localWorkdir,
        status: 'idle',
        metadata: expect.objectContaining({
          agentName: 'Agent One',
          remoteSession: expect.objectContaining({
            protocol: 'acp',
            sessionId: 'remote-1',
            cwd: workspaceDir
          }),
          acpSync: expect.objectContaining({
            source: 'session/list'
          })
        })
      })
    )
  })

  it('serializes concurrent imports of the same remote session', async () => {
    const workspaceDir = process.cwd()
    let storedSession: AcpSessionEntity | null = null
    let releaseCreate!: () => void
    let markCreateStarted!: () => void
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve
    })
    const createStarted = new Promise<void>((resolve) => {
      markCreateStarted = resolve
    })
    const sqlitePresenter = {
      getAcpSessionByAgentAndSessionId: vi.fn(async () => storedSession),
      createConversation: vi.fn(async () => {
        markCreateStarted()
        await createGate
        return 'conv-imported'
      }),
      deleteConversation: vi.fn().mockResolvedValue(undefined),
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
      workdir: workspaceDir,
      sessions: [
        {
          sessionId: 'remote-1',
          cwd: workspaceDir,
          title: 'Remote title'
        }
      ]
    }

    const firstPromise = persistence.syncRemoteSessions(input)
    await createStarted
    const secondPromise = persistence.syncRemoteSessions(input)
    releaseCreate()
    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(sqlitePresenter.createConversation).toHaveBeenCalledTimes(1)
    expect(sqlitePresenter.deleteConversation).not.toHaveBeenCalled()
    expect(first).toMatchObject({
      imported: 1,
      updated: 0,
      sessions: [{ conversationId: 'conv-imported', status: 'imported' }]
    })
    expect(second).toMatchObject({
      imported: 0,
      updated: 1,
      sessions: [{ conversationId: 'conv-imported', status: 'updated' }]
    })
  })

  it('recovers when a remote session link is created concurrently before save', async () => {
    const workspaceDir = process.cwd()
    const existingSession: AcpSessionEntity = {
      id: 1,
      conversationId: 'conv-existing',
      agentId: 'agent-1',
      sessionId: 'remote-1',
      workdir: workspaceDir,
      status: 'idle',
      createdAt: 1,
      updatedAt: 2,
      metadata: {
        acpSync: {
          importedAt: '2026-06-01T00:00:00.000Z'
        }
      }
    }
    let lookupCount = 0
    const sqlitePresenter = {
      getAcpSessionByAgentAndSessionId: vi.fn(async () => {
        lookupCount += 1
        return lookupCount === 1 ? null : existingSession
      }),
      createConversation: vi.fn(async () => 'conv-duplicate'),
      deleteConversation: vi.fn().mockResolvedValue(undefined),
      upsertAcpSession: vi
        .fn()
        .mockRejectedValueOnce(new Error('UNIQUE constraint failed: acp_sessions.agent_id'))
        .mockResolvedValue(undefined)
    } as unknown as ISQLitePresenter
    const persistence = new AcpSessionPersistence(sqlitePresenter)

    const result = await persistence.syncRemoteSessions({
      agentId: 'agent-1',
      agentName: 'Agent One',
      providerId: 'acp',
      workdir: workspaceDir,
      sessions: [
        {
          sessionId: 'remote-1',
          cwd: workspaceDir,
          title: 'Remote title'
        }
      ]
    })

    expect(result).toMatchObject({
      imported: 0,
      updated: 1,
      sessions: [{ conversationId: 'conv-existing', status: 'updated' }]
    })
    expect(sqlitePresenter.deleteConversation).toHaveBeenCalledWith('conv-duplicate')
    expect(sqlitePresenter.upsertAcpSession).toHaveBeenLastCalledWith(
      'conv-existing',
      'agent-1',
      expect.objectContaining({
        sessionId: 'remote-1',
        workdir: workspaceDir,
        metadata: expect.objectContaining({
          acpSync: expect.objectContaining({
            importedAt: '2026-06-01T00:00:00.000Z',
            source: 'session/list'
          })
        })
      })
    )
  })

  it('cleans up the new conversation when remote session save cannot be recovered', async () => {
    const workspaceDir = process.cwd()
    const saveError = new Error('database unavailable')
    const sqlitePresenter = {
      getAcpSessionByAgentAndSessionId: vi.fn().mockResolvedValue(null),
      createConversation: vi.fn(async () => 'conv-failed'),
      deleteConversation: vi.fn().mockResolvedValue(undefined),
      upsertAcpSession: vi.fn().mockRejectedValue(saveError)
    } as unknown as ISQLitePresenter
    const persistence = new AcpSessionPersistence(sqlitePresenter)

    await expect(
      persistence.syncRemoteSessions({
        agentId: 'agent-1',
        agentName: 'Agent One',
        providerId: 'acp',
        workdir: workspaceDir,
        sessions: [
          {
            sessionId: 'remote-1',
            cwd: workspaceDir,
            title: 'Remote title'
          }
        ]
      })
    ).rejects.toThrow(saveError)

    expect(sqlitePresenter.createConversation).toHaveBeenCalledWith(
      'Remote title',
      expect.any(Object)
    )
    expect(sqlitePresenter.deleteConversation).toHaveBeenCalledWith('conv-failed')
  })

  it('serializes concurrent metadata merges for the same local session', async () => {
    let storedSession: AcpSessionEntity = {
      id: 1,
      conversationId: 'conv-1',
      agentId: 'agent-1',
      sessionId: 'session-1',
      workdir: process.cwd(),
      status: 'idle',
      createdAt: 1,
      updatedAt: 2,
      metadata: {
        base: true
      }
    }
    let releaseFirstSave!: () => void
    let markFirstSaveStarted!: () => void
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    const firstSaveStarted = new Promise<void>((resolve) => {
      markFirstSaveStarted = resolve
    })
    let saveCount = 0
    const sqlitePresenter = {
      getAcpSession: vi.fn(async () => ({
        ...storedSession,
        metadata: {
          ...storedSession.metadata
        }
      })),
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
          saveCount += 1
          if (saveCount === 1) {
            markFirstSaveStarted()
            await firstSaveGate
          }
          storedSession = {
            ...storedSession,
            conversationId,
            agentId,
            sessionId: data.sessionId ?? null,
            workdir: data.workdir ?? null,
            status: data.status ?? 'idle',
            metadata: data.metadata ?? null
          }
        }
      )
    } as unknown as ISQLitePresenter
    const persistence = new AcpSessionPersistence(sqlitePresenter)

    const firstMerge = persistence.mergeMetadata('conv-1', 'agent-1', { first: true })
    await firstSaveStarted
    const secondMerge = persistence.mergeMetadata('conv-1', 'agent-1', { second: true })
    releaseFirstSave()
    await Promise.all([firstMerge, secondMerge])

    expect(sqlitePresenter.getAcpSession).toHaveBeenCalledTimes(2)
    expect(storedSession.metadata).toEqual({
      base: true,
      first: true,
      second: true
    })
  })

  it('keeps remote cwd metadata while using a local fallback for missing imported workdirs', async () => {
    const fallbackDir = process.cwd()
    const remoteMissingDir = path.join(fallbackDir, 'remote-missing')
    vi.mocked(app.getPath).mockReturnValue(fallbackDir)

    const sqlitePresenter = {
      getAcpSessionByAgentAndSessionId: vi.fn(async () => null),
      createConversation: vi.fn(async () => 'conv-imported'),
      upsertAcpSession: vi.fn().mockResolvedValue(undefined)
    } as unknown as ISQLitePresenter
    const persistence = new AcpSessionPersistence(sqlitePresenter)

    try {
      await persistence.syncRemoteSessions({
        agentId: 'agent-1',
        agentName: 'Agent One',
        providerId: 'acp',
        workdir: remoteMissingDir,
        sessions: [
          {
            sessionId: 'remote-1',
            cwd: remoteMissingDir,
            title: 'Remote title'
          }
        ]
      })

      expect(sqlitePresenter.createConversation).toHaveBeenCalledWith(
        'Remote title',
        expect.objectContaining({
          agentWorkspacePath: fallbackDir,
          acpWorkdirMap: { 'agent-1': fallbackDir }
        })
      )
      expect(sqlitePresenter.upsertAcpSession).toHaveBeenCalledWith(
        'conv-imported',
        'agent-1',
        expect.objectContaining({
          workdir: fallbackDir,
          metadata: expect.objectContaining({
            remoteSession: expect.objectContaining({
              cwd: remoteMissingDir
            })
          })
        })
      )
    } finally {
      vi.mocked(app.getPath).mockReturnValue('/home/tester')
    }
  })
})
