import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewSessionManager } from '@/presenter/newAgentPresenter/sessionManager'

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'mock-id-123') }))

function createMockSqlitePresenter() {
  return {
    newSessionsTable: {
      create: vi.fn(),
      get: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      getDisabledAgentTools: vi.fn().mockReturnValue([]),
      updateDisabledAgentTools: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    newEnvironmentsTable: {
      listPathsForSession: vi.fn().mockReturnValue([]),
      syncPath: vi.fn(),
      syncForSession: vi.fn()
    }
  } as any
}

describe('NewSessionManager', () => {
  let sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>
  let manager: NewSessionManager

  beforeEach(() => {
    sqlitePresenter = createMockSqlitePresenter()
    manager = new NewSessionManager(sqlitePresenter)
  })

  describe('create', () => {
    it('creates a session, syncs environments, and returns the generated id', () => {
      const id = manager.create('deepchat', 'Hello world', '/tmp/workspace')

      expect(id).toBe('mock-id-123')
      expect(sqlitePresenter.newSessionsTable.create).toHaveBeenCalledWith(
        'mock-id-123',
        'deepchat',
        'Hello world',
        '/tmp/workspace',
        {
          isDraft: undefined,
          disabledAgentTools: undefined,
          subagentEnabled: undefined,
          sessionKind: undefined,
          parentSessionId: undefined,
          subagentMetaJson: null
        }
      )
      expect(sqlitePresenter.newEnvironmentsTable.syncPath).toHaveBeenCalledWith('/tmp/workspace')
    })
  })

  describe('get', () => {
    it('returns mapped SessionRecord when found', () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        id: 's1',
        agent_id: 'deepchat',
        title: 'Test',
        project_dir: '/tmp/proj',
        is_pinned: 1,
        is_draft: 0,
        created_at: 1000,
        updated_at: 2000
      })

      const record = manager.get('s1')

      expect(record).toEqual({
        id: 's1',
        agentId: 'deepchat',
        title: 'Test',
        projectDir: '/tmp/proj',
        isPinned: true,
        isDraft: false,
        sessionKind: 'regular',
        parentSessionId: null,
        subagentEnabled: false,
        subagentMeta: null,
        createdAt: 1000,
        updatedAt: 2000
      })
    })

    it('returns null when not found', () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)
      expect(manager.get('missing')).toBeNull()
    })
  })

  describe('list', () => {
    it('returns mapped records', () => {
      sqlitePresenter.newSessionsTable.list.mockReturnValue([
        {
          id: 's1',
          agent_id: 'deepchat',
          title: 'Chat 1',
          project_dir: null,
          is_pinned: 0,
          is_draft: 1,
          created_at: 1000,
          updated_at: 2000
        }
      ])

      const records = manager.list()

      expect(records).toHaveLength(1)
      expect(records[0].isPinned).toBe(false)
      expect(records[0].isDraft).toBe(true)
      expect(records[0].projectDir).toBeNull()
    })

    it('passes filters through', () => {
      manager.list({ agentId: 'deepchat' })
      expect(sqlitePresenter.newSessionsTable.list).toHaveBeenCalledWith({ agentId: 'deepchat' })
    })
  })

  describe('update', () => {
    it('maps camelCase fields to snake_case and syncs affected environment paths', () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        project_dir: '/tmp/current'
      })
      sqlitePresenter.newEnvironmentsTable.listPathsForSession
        .mockReturnValueOnce(['/tmp/current'])
        .mockReturnValueOnce(['/tmp/current'])

      manager.update('s1', { title: 'New Title', isPinned: true, isDraft: false })

      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('s1', {
        title: 'New Title',
        is_pinned: 1,
        is_draft: 0
      })
      expect(sqlitePresenter.newEnvironmentsTable.syncPath).toHaveBeenCalledWith('/tmp/current')
    })

    it('syncs both old and new environment paths when projectDir changes', () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue({
        project_dir: '/old/dir'
      })
      sqlitePresenter.newEnvironmentsTable.listPathsForSession
        .mockReturnValueOnce(['/old/dir'])
        .mockReturnValueOnce(['/new/dir'])

      manager.update('s1', { projectDir: '/new/dir' })

      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('s1', {
        project_dir: '/new/dir'
      })
      expect(sqlitePresenter.newEnvironmentsTable.syncPath).toHaveBeenNthCalledWith(1, '/old/dir')
      expect(sqlitePresenter.newEnvironmentsTable.syncPath).toHaveBeenNthCalledWith(2, '/new/dir')
    })

    it('returns without updating when the session does not exist', () => {
      sqlitePresenter.newSessionsTable.get.mockReturnValue(undefined)

      manager.update('missing', { title: 'noop' })

      expect(sqlitePresenter.newSessionsTable.update).not.toHaveBeenCalled()
      expect(sqlitePresenter.newEnvironmentsTable.listPathsForSession).not.toHaveBeenCalled()
      expect(sqlitePresenter.newEnvironmentsTable.syncPath).not.toHaveBeenCalled()
    })
  })

  describe('delete', () => {
    it('deletes the session and syncs the removed path', () => {
      sqlitePresenter.newEnvironmentsTable.listPathsForSession.mockReturnValue(['/tmp/to-delete'])

      manager.delete('s1')

      expect(sqlitePresenter.newSessionsTable.delete).toHaveBeenCalledWith('s1')
      expect(sqlitePresenter.newEnvironmentsTable.syncPath).toHaveBeenCalledWith('/tmp/to-delete')
    })
  })

  describe('disabled tools', () => {
    it('syncs the related environment after updating disabled tools', () => {
      manager.updateDisabledAgentTools('s1', ['exec'])

      expect(sqlitePresenter.newSessionsTable.updateDisabledAgentTools).toHaveBeenCalledWith('s1', [
        'exec'
      ])
      expect(sqlitePresenter.newEnvironmentsTable.syncForSession).toHaveBeenCalledWith('s1')
    })
  })

  describe('window bindings', () => {
    it('bindWindow and getActiveSessionId', () => {
      expect(manager.getActiveSessionId(1)).toBeNull()
      manager.bindWindow(1, 's1')
      expect(manager.getActiveSessionId(1)).toBe('s1')
    })

    it('unbindWindow sets null', () => {
      manager.bindWindow(1, 's1')
      manager.unbindWindow(1)
      expect(manager.getActiveSessionId(1)).toBeNull()
    })

    it('multiple windows track independently', () => {
      manager.bindWindow(1, 's1')
      manager.bindWindow(2, 's2')
      expect(manager.getActiveSessionId(1)).toBe('s1')
      expect(manager.getActiveSessionId(2)).toBe('s2')
    })
  })
})
