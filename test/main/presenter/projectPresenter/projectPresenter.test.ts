import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPathMock, openPathMock, existsSyncMock, mkdirSyncMock } = vi.hoisted(() => ({
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
  existsSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn()
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
    existsSync: existsSyncMock,
    mkdirSync: mkdirSyncMock
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
      list: vi.fn().mockReturnValue([]),
      syncPath: vi.fn()
    },
    newEnvironmentPreferencesTable: {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      reorderActive: vi.fn(),
      markActive: vi.fn(),
      markArchived: vi.fn(),
      markRemoved: vi.fn()
    },
    newSessionsTable: {
      clearProjectDir: vi.fn().mockReturnValue([])
    },
    getDatabase: vi.fn(() => ({
      transaction: (fn: () => unknown) => fn
    }))
  } as any
}

function createMockDevicePresenter() {
  return {
    selectDirectory: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
  } as any
}

function createMockConfigPresenter(defaultProjectPath: string | null = null) {
  let currentDefaultProjectPath = defaultProjectPath
  return {
    getDefaultProjectPath: vi.fn(() => currentDefaultProjectPath),
    setDefaultProjectPath: vi.fn((projectPath: string | null) => {
      currentDefaultProjectPath = projectPath
    })
  } as any
}

describe('ProjectPresenter', () => {
  let sqlitePresenter: ReturnType<typeof createMockSqlitePresenter>
  let devicePresenter: ReturnType<typeof createMockDevicePresenter>
  let presenter: ProjectPresenter

  beforeEach(() => {
    vi.clearAllMocks()
    existsSyncMock.mockReturnValue(true)
    mkdirSyncMock.mockReturnValue(undefined)
    sqlitePresenter = createMockSqlitePresenter()
    devicePresenter = createMockDevicePresenter()
    presenter = new ProjectPresenter(sqlitePresenter, devicePresenter)
  })

  describe('ensureDefaultWorkspace', () => {
    it('creates and registers the Documents default workspace for first-run users', async () => {
      const configPresenter = createMockConfigPresenter()
      presenter = new ProjectPresenter(sqlitePresenter, devicePresenter, configPresenter)

      await expect(presenter.ensureDefaultWorkspace()).resolves.toBe('/mock/documents/DeepChat')

      expect(mkdirSyncMock).toHaveBeenCalledWith('/mock/documents/DeepChat', { recursive: true })
      expect(sqlitePresenter.newProjectsTable.upsert).toHaveBeenCalledWith(
        '/mock/documents/DeepChat',
        'DeepChat'
      )
      expect(sqlitePresenter.newEnvironmentPreferencesTable.markActive).toHaveBeenCalledWith(
        '/mock/documents/DeepChat'
      )
      expect(configPresenter.setDefaultProjectPath).toHaveBeenCalledWith('/mock/documents/DeepChat')
    })

    it('recreates and registers the built-in workspace when it is already the default', async () => {
      const configPresenter = createMockConfigPresenter('/mock/documents/DeepChat')
      presenter = new ProjectPresenter(sqlitePresenter, devicePresenter, configPresenter)

      await expect(presenter.ensureDefaultWorkspace()).resolves.toBe('/mock/documents/DeepChat')

      expect(mkdirSyncMock).toHaveBeenCalledWith('/mock/documents/DeepChat', { recursive: true })
      expect(sqlitePresenter.newProjectsTable.upsert).toHaveBeenCalledWith(
        '/mock/documents/DeepChat',
        'DeepChat'
      )
      expect(configPresenter.setDefaultProjectPath).not.toHaveBeenCalled()
    })

    it('does not migrate users with a custom default project path', async () => {
      const configPresenter = createMockConfigPresenter('/work/custom')
      presenter = new ProjectPresenter(sqlitePresenter, devicePresenter, configPresenter)

      await expect(presenter.ensureDefaultWorkspace()).resolves.toBeNull()

      expect(mkdirSyncMock).not.toHaveBeenCalled()
      expect(sqlitePresenter.newProjectsTable.upsert).not.toHaveBeenCalled()
    })

    it('does not migrate users with existing workspace history', async () => {
      const configPresenter = createMockConfigPresenter()
      sqlitePresenter.newProjectsTable.getAll.mockReturnValue([
        { path: '/work/app', name: 'app', icon: null, last_accessed_at: 1000 }
      ])
      presenter = new ProjectPresenter(sqlitePresenter, devicePresenter, configPresenter)

      await expect(presenter.ensureDefaultWorkspace()).resolves.toBeNull()

      expect(mkdirSyncMock).not.toHaveBeenCalled()
      expect(configPresenter.setDefaultProjectPath).not.toHaveBeenCalled()
    })

    it('does not reactivate an archived built-in workspace after the user clears it', async () => {
      const configPresenter = createMockConfigPresenter()
      sqlitePresenter.newEnvironmentPreferencesTable.list.mockReturnValue([
        {
          path: '/mock/documents/DeepChat',
          status: 'archived',
          sort_order: 2147483647,
          archived_at: 1000,
          removed_at: null,
          updated_at: 1000
        }
      ])
      presenter = new ProjectPresenter(sqlitePresenter, devicePresenter, configPresenter)

      await expect(presenter.ensureDefaultWorkspace()).resolves.toBeNull()

      expect(mkdirSyncMock).not.toHaveBeenCalled()
      expect(configPresenter.setDefaultProjectPath).not.toHaveBeenCalled()
    })

    it('falls back to home when Documents cannot be created', async () => {
      const configPresenter = createMockConfigPresenter()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      mkdirSyncMock.mockImplementation((targetPath: string) => {
        if (targetPath === '/mock/documents/DeepChat') {
          throw new Error('documents denied')
        }
      })
      presenter = new ProjectPresenter(sqlitePresenter, devicePresenter, configPresenter)

      try {
        await expect(presenter.ensureDefaultWorkspace()).resolves.toBe('/mock/home/DeepChat')

        expect(mkdirSyncMock).toHaveBeenCalledWith('/mock/documents/DeepChat', { recursive: true })
        expect(mkdirSyncMock).toHaveBeenCalledWith('/mock/home/DeepChat', { recursive: true })
        expect(configPresenter.setDefaultProjectPath).toHaveBeenCalledWith('/mock/home/DeepChat')
        expect(warnSpy).toHaveBeenCalledWith(
          '[ProjectPresenter] Failed to create default workspace at /mock/documents/DeepChat:',
          expect.any(Error)
        )
      } finally {
        warnSpy.mockRestore()
      }
    })
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
        lastAccessedAt: 1000,
        exists: true
      })
      expect(projects[1].icon).toBeNull()
    })

    it('returns empty array when no projects', async () => {
      const projects = await presenter.getProjects()
      expect(projects).toEqual([])
    })
  })

  describe('getRecentProjects', () => {
    it('returns correct order and limit', async () => {
      sqlitePresenter.newProjectsTable.getAll.mockReturnValue([
        { path: '/recent1', name: 'recent1', icon: null, last_accessed_at: 3000 },
        { path: '/recent2', name: 'recent2', icon: null, last_accessed_at: 2000 },
        { path: '/recent3', name: 'recent3', icon: null, last_accessed_at: 1000 }
      ])

      const projects = await presenter.getRecentProjects(2)

      expect(projects).toHaveLength(2)
      expect(projects[0].path).toBe('/recent1')
      expect(projects[0].lastAccessedAt).toBe(3000)
      expect(projects[0].exists).toBe(true)
    })

    it('filters removed projects from recent rows', async () => {
      sqlitePresenter.newProjectsTable.getAll.mockReturnValue([
        { path: '/recent1', name: 'recent1', icon: null, last_accessed_at: 3000 },
        { path: '/removed', name: 'removed', icon: null, last_accessed_at: 2000 }
      ])
      sqlitePresenter.newEnvironmentPreferencesTable.get.mockImplementation((projectPath: string) =>
        projectPath === '/removed' ? { status: 'removed' } : undefined
      )

      const projects = await presenter.getRecentProjects(2)

      expect(projects.map((project) => project.path)).toEqual(['/recent1'])
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
          path: '/mock/appData/alma/workspaces/default',
          name: 'default',
          sessionCount: 2,
          lastUsedAt: 1700000002000,
          isTemp: true,
          exists: false,
          status: 'active',
          sortOrder: 2147483647,
          archivedAt: null,
          removedAt: null
        },
        {
          path: '/system/temp/deepchat-agent/workspaces/tmp-1',
          name: 'tmp-1',
          sessionCount: 1,
          lastUsedAt: 1700000001000,
          isTemp: true,
          exists: false,
          status: 'active',
          sortOrder: 2147483647,
          archivedAt: null,
          removedAt: null
        },
        {
          path: '/work/hello-world',
          name: 'hello-world',
          sessionCount: 3,
          lastUsedAt: 1700000000000,
          isTemp: false,
          exists: true,
          status: 'active',
          sortOrder: 2147483647,
          archivedAt: null,
          removedAt: null
        }
      ])
    })

    it('applies custom active order before last-used order', async () => {
      sqlitePresenter.newEnvironmentsTable.list.mockReturnValue([
        {
          path: '/work/a',
          session_count: 1,
          last_used_at: 300
        },
        {
          path: '/work/b',
          session_count: 1,
          last_used_at: 400
        }
      ])
      sqlitePresenter.newEnvironmentPreferencesTable.list.mockReturnValue([
        {
          path: '/work/a',
          status: 'active',
          sort_order: 1,
          archived_at: null,
          removed_at: null,
          updated_at: 1000
        },
        {
          path: '/work/b',
          status: 'active',
          sort_order: 0,
          archived_at: null,
          removed_at: null,
          updated_at: 1000
        }
      ])

      const environments = await presenter.getEnvironments()

      expect(environments.map((environment) => environment.path)).toEqual(['/work/b', '/work/a'])
    })

    it('returns archived preference rows separately from active rows', async () => {
      sqlitePresenter.newEnvironmentsTable.list.mockReturnValue([
        {
          path: '/work/legacy',
          session_count: 2,
          last_used_at: 500
        }
      ])
      sqlitePresenter.newEnvironmentPreferencesTable.list.mockReturnValue([
        {
          path: '/work/legacy',
          status: 'archived',
          sort_order: 2147483647,
          archived_at: 1000,
          removed_at: null,
          updated_at: 1000
        }
      ])

      await expect(presenter.getEnvironments()).resolves.toEqual([])
      const archived = await presenter.getEnvironments({ status: 'archived' })

      expect(archived[0]).toMatchObject({
        path: '/work/legacy',
        status: 'archived',
        archivedAt: 1000
      })
    })
  })

  describe('environment lifecycle', () => {
    it('persists reorder requests through environment preferences', async () => {
      sqlitePresenter.newEnvironmentsTable.list.mockReturnValue([
        { path: '/work/a', session_count: 1, last_used_at: 100 },
        { path: '/work/b', session_count: 1, last_used_at: 200 }
      ])

      await presenter.reorderEnvironments(['/work/b', '/work/a'])

      expect(sqlitePresenter.newEnvironmentPreferencesTable.reorderActive).toHaveBeenCalledWith([
        '/work/b',
        '/work/a'
      ])
    })

    it('archives an environment through environment preferences', async () => {
      await presenter.archiveEnvironment('/work/app')

      expect(sqlitePresenter.newEnvironmentPreferencesTable.markArchived).toHaveBeenCalledWith(
        '/work/app'
      )
    })

    it('clears regular project sessions and tombstones on remove', async () => {
      sqlitePresenter.newSessionsTable.clearProjectDir.mockReturnValue(['s1', 's2'])

      const result = await presenter.removeEnvironment('/work/app')

      expect(result).toEqual({ clearedSessionIds: ['s1', 's2'] })
      expect(sqlitePresenter.newSessionsTable.clearProjectDir).toHaveBeenCalledWith('/work/app')
      expect(sqlitePresenter.newEnvironmentPreferencesTable.markRemoved).toHaveBeenCalledWith(
        '/work/app'
      )
      expect(sqlitePresenter.newProjectsTable.delete).toHaveBeenCalledWith('/work/app')
      expect(sqlitePresenter.newEnvironmentsTable.syncPath).toHaveBeenCalledWith('/work/app')
    })

    it('does not reorder archived or removed environments', async () => {
      sqlitePresenter.newEnvironmentsTable.list.mockReturnValue([
        { path: '/work/active', session_count: 1, last_used_at: 100 },
        { path: '/work/archived', session_count: 1, last_used_at: 200 },
        { path: '/work/removed', session_count: 1, last_used_at: 300 }
      ])
      sqlitePresenter.newEnvironmentPreferencesTable.list.mockReturnValue([
        {
          path: '/work/archived',
          status: 'archived',
          sort_order: 2147483647,
          archived_at: 1000,
          removed_at: null,
          updated_at: 1000
        },
        {
          path: '/work/removed',
          status: 'removed',
          sort_order: 2147483647,
          archived_at: null,
          removed_at: 2000,
          updated_at: 2000
        }
      ])

      await presenter.reorderEnvironments(['/work/removed', '/work/archived', '/work/active'])

      expect(sqlitePresenter.newEnvironmentPreferencesTable.reorderActive).toHaveBeenCalledWith([
        '/work/active'
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
      expect(sqlitePresenter.newEnvironmentPreferencesTable.markActive).toHaveBeenCalledWith(
        '/Users/test/my-project'
      )
    })
  })
})
