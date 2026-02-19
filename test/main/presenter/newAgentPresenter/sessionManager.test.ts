import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NewSessionManager } from '@/presenter/newAgentPresenter/sessionManager'

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'mock-id-123') }))

function createMockSqlitePresenter() {
  return {
    newSessionsTable: {
      create: vi.fn(),
      get: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      update: vi.fn(),
      delete: vi.fn()
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
    it('creates a session and returns the generated id', () => {
      const id = manager.create('deepchat', 'Hello world', null)

      expect(id).toBe('mock-id-123')
      expect(sqlitePresenter.newSessionsTable.create).toHaveBeenCalledWith(
        'mock-id-123',
        'deepchat',
        'Hello world',
        null
      )
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
          created_at: 1000,
          updated_at: 2000
        }
      ])

      const records = manager.list()
      expect(records).toHaveLength(1)
      expect(records[0].isPinned).toBe(false)
      expect(records[0].projectDir).toBeNull()
    })

    it('passes filters through', () => {
      manager.list({ agentId: 'deepchat' })
      expect(sqlitePresenter.newSessionsTable.list).toHaveBeenCalledWith({ agentId: 'deepchat' })
    })
  })

  describe('update', () => {
    it('maps camelCase fields to snake_case', () => {
      manager.update('s1', { title: 'New Title', isPinned: true })
      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('s1', {
        title: 'New Title',
        is_pinned: 1
      })
    })

    it('handles projectDir mapping', () => {
      manager.update('s1', { projectDir: '/new/dir' })
      expect(sqlitePresenter.newSessionsTable.update).toHaveBeenCalledWith('s1', {
        project_dir: '/new/dir'
      })
    })
  })

  describe('delete', () => {
    it('delegates to table', () => {
      manager.delete('s1')
      expect(sqlitePresenter.newSessionsTable.delete).toHaveBeenCalledWith('s1')
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
