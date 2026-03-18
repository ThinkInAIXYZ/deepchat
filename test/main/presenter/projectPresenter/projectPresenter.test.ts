import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPathMock, openPathMock, existsSyncMock } = vi.hoisted(() => ({
  getPathMock: vi.fn((name: string) => {
    if (name === 'temp') {
      return '/system/temp'
    }
    if (name === 'userData') {
      return '/mock/userData'
    }
    if (name === 'appData') {
      return '/mock/appData'
    }
    return `/mock/${name}`
  }),
  openPathMock: vi.fn(),
  existsSyncMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock
  },
  shell: {
    openPath: openPathMock
  }
}))

vi.mock('fs', () => ({
  default: {
    existsSync: existsSyncMock
  }
}))

import { ProjectPresenter } from '@/presenter/projectPresenter/index'

function createMockSqlitePresenter() {
  return {
    newProjectsTable: {
      getAll: vi.fn().mockReturnValue([]),
      getRecent: vi.fn().mockReturnValue([]),
      upsert: vi.fn(),
      delete: vi.fn()
    },
    newEnvironmentsTable: {
      list: vi.fn().mockReturnValue([])
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
    vi.clearAllMocks()
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

  describe('getEnvironments', () => {
    it('maps environment rows with temp and exists metadata', async () => {
      sqlitePresenter.newEnvironmentsTable.list.mockReturnValue([
        {
          path: '/work/hello-world',
          session_count: 3,
          last_used_at: 1700000000000
        },
        {
          path: '/system/temp/deepchat-agent/workspaces/tmp-1',
          session_count: 1,
          last_used_at: 1700000001000
        },
        {
          path: '/mock/appData/alma/workspaces/default',
          session_count: 2,
          last_used_at: 1700000002000
        }
      ])
      existsSyncMock.mockImplementation((targetPath: string) => targetPath === '/work/hello-world')

      const environments = await presenter.getEnvironments()

      expect(environments).toEqual([
        {
          path: '/work/hello-world',
          name: 'hello-world',
          sessionCount: 3,
          lastUsedAt: 1700000000000,
          isTemp: false,
          exists: true
        },
        {
          path: '/system/temp/deepchat-agent/workspaces/tmp-1',
          name: 'tmp-1',
          sessionCount: 1,
          lastUsedAt: 1700000001000,
          isTemp: true,
          exists: false
        },
        {
          path: '/mock/appData/alma/workspaces/default',
          name: 'default',
          sessionCount: 2,
          lastUsedAt: 1700000002000,
          isTemp: true,
          exists: false
        }
      ])
    })
  })

  describe('openDirectory', () => {
    it('opens the directory with the system shell', async () => {
      openPathMock.mockResolvedValue('')

      await presenter.openDirectory('/work/hello-world')

      expect(openPathMock).toHaveBeenCalledWith('/work/hello-world')
    })

    it('throws when the shell reports an error', async () => {
      openPathMock.mockResolvedValue('failed to open')

      await expect(presenter.openDirectory('/work/hello-world')).rejects.toThrow('failed to open')
    })
  })

  describe('pathExists', () => {
    it('delegates path existence checks to the filesystem', async () => {
      existsSyncMock.mockReturnValue(true)

      await expect(presenter.pathExists('/work/hello-world')).resolves.toBe(true)
      await expect(presenter.pathExists('')).resolves.toBe(false)

      expect(existsSyncMock).toHaveBeenCalledWith('/work/hello-world')
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
