import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProjectPresenter } from '@/presenter/projectPresenter/index'

function createMockSqlitePresenter() {
  return {
    newProjectsTable: {
      getAll: vi.fn().mockReturnValue([]),
      getRecent: vi.fn().mockReturnValue([]),
      upsert: vi.fn(),
      delete: vi.fn()
    }
  } as any
}

function createMockDevicePresenter() {
  return {
    selectDirectory: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
  } as any
}

describe('ProjectPresenter', () => {
  let sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>
  let devicePresenter: ReturnType<typeof createMockDevicePresenter>
  let presenter: ProjectPresenter

  beforeEach(() => {
    sqlitePresenter = createMockSqlitePresenter()
    devicePresenter = createMockDevicePresenter()
    presenter = new ProjectPresenter(sqlitePresenter, devicePresenter)
  })

  describe('getProjects', () => {
    it('maps DB rows to Project objects', async () => {
      sqlitePresenter.newProjectsTable.getAll.mockReturnValue([
        { path: '/tmp/proj', name: 'proj', icon: 'folder', last_accessed_at: 1000 },
        { path: '/tmp/proj2', name: 'proj2', icon: null, last_accessed_at: 2000 }
      ])

      const projects = await presenter.getProjects()
      expect(projects).toHaveLength(2)
      expect(projects[0]).toEqual({
        path: '/tmp/proj',
        name: 'proj',
        icon: 'folder',
        lastAccessedAt: 1000
      })
      expect(projects[1].icon).toBeNull()
    })

    it('returns empty array when no projects', async () => {
      const projects = await presenter.getProjects()
      expect(projects).toEqual([])
    })
  })

  describe('getRecentProjects', () => {
    it('passes limit to DB query', async () => {
      await presenter.getRecentProjects(5)
      expect(sqlitePresenter.newProjectsTable.getRecent).toHaveBeenCalledWith(5)
    })

    it('defaults to limit 10', async () => {
      await presenter.getRecentProjects()
      expect(sqlitePresenter.newProjectsTable.getRecent).toHaveBeenCalledWith(10)
    })

    it('returns correct order and limit', async () => {
      sqlitePresenter.newProjectsTable.getRecent.mockReturnValue([
        { path: '/recent1', name: 'recent1', icon: null, last_accessed_at: 3000 },
        { path: '/recent2', name: 'recent2', icon: null, last_accessed_at: 2000 }
      ])

      const projects = await presenter.getRecentProjects(2)
      expect(projects).toHaveLength(2)
      expect(projects[0].path).toBe('/recent1')
      expect(projects[0].lastAccessedAt).toBe(3000)
    })
  })

  describe('selectDirectory', () => {
    it('returns null when user cancels', async () => {
      devicePresenter.selectDirectory.mockResolvedValue({ canceled: true, filePaths: [] })
      const result = await presenter.selectDirectory()
      expect(result).toBeNull()
    })

    it('returns null when no path selected', async () => {
      devicePresenter.selectDirectory.mockResolvedValue({ canceled: false, filePaths: [] })
      const result = await presenter.selectDirectory()
      expect(result).toBeNull()
    })

    it('upserts project and returns path on selection', async () => {
      devicePresenter.selectDirectory.mockResolvedValue({
        canceled: false,
        filePaths: ['/Users/test/my-project']
      })

      const result = await presenter.selectDirectory()
      expect(result).toBe('/Users/test/my-project')
      expect(sqlitePresenter.newProjectsTable.upsert).toHaveBeenCalledWith(
        '/Users/test/my-project',
        'my-project'
      )
    })
  })
})
