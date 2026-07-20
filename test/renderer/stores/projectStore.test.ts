import { beforeEach, describe, expect, it, vi } from 'vitest'

const setupStore = async (overrides?: {
  recentProjects?: Array<{ path: string; name: string; icon: string | null; exists: boolean }>
  defaultProjectPath?: string | null
}) => {
  vi.resetModules()

  const defaultProjectPathListeners: Array<
    (payload: { path: string | null; version: number }) => void
  > = []
  const environmentListeners: Array<
    (payload: {
      action: 'reorder' | 'archive' | 'restore' | 'remove'
      path: string | null
      version: number
    }) => void
  > = []
  const projectPresenter = {
    getRecentProjects: vi
      .fn()
      .mockResolvedValue(
        overrides?.recentProjects ?? [
          { path: '/work/recent', name: 'recent', icon: null, exists: true }
        ]
      ),
    getEnvironments: vi.fn().mockResolvedValue([]),
    reorderEnvironments: vi.fn().mockResolvedValue({ updated: true }),
    archiveEnvironment: vi.fn().mockResolvedValue({ updated: true }),
    restoreEnvironment: vi.fn().mockResolvedValue({ updated: true }),
    removeEnvironment: vi.fn().mockResolvedValue({ clearedSessionIds: ['s1'] }),
    openDirectory: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(true),
    selectDirectory: vi.fn().mockResolvedValue(null)
  }
  const configClient = {
    getDefaultProjectPath: vi.fn().mockResolvedValue(overrides?.defaultProjectPath ?? null),
    setDefaultProjectPath: vi.fn().mockResolvedValue(undefined),
    onDefaultProjectPathChanged: vi.fn(
      (listener: (payload: { path: string | null; version: number }) => void) => {
        defaultProjectPathListeners.push(listener)
        return () => undefined
      }
    )
  }

  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      defineStore: (_id: string, setup: () => unknown) => setup
    }
  })
  vi.doMock('../../../src/renderer/api/ProjectClient', () => ({
    createProjectClient: vi.fn(() => ({
      listRecent: projectPresenter.getRecentProjects,
      listEnvironments: projectPresenter.getEnvironments,
      reorderEnvironments: projectPresenter.reorderEnvironments,
      archiveEnvironment: projectPresenter.archiveEnvironment,
      restoreEnvironment: projectPresenter.restoreEnvironment,
      removeEnvironment: projectPresenter.removeEnvironment,
      openDirectory: projectPresenter.openDirectory,
      pathExists: projectPresenter.pathExists,
      selectDirectory: projectPresenter.selectDirectory,
      onEnvironmentsChanged: vi.fn(
        (
          listener: (payload: {
            action: 'reorder' | 'archive' | 'restore' | 'remove'
            path: string | null
            version: number
          }) => void
        ) => {
          environmentListeners.push(listener)
          return () => undefined
        }
      )
    }))
  }))
  vi.doMock('../../../src/renderer/api/ConfigClient', () => ({
    createConfigClient: vi.fn(() => configClient)
  }))

  const { useProjectStore } = await import('@/stores/ui/project')
  const store = useProjectStore()
  const emitDefaultProjectPathChanged = (path: string | null) => {
    for (const listener of defaultProjectPathListeners) {
      listener({
        path,
        version: 1
      })
    }
  }
  const emitProjectEnvironmentsChanged = (
    payload: Parameters<(typeof environmentListeners)[number]>[0]
  ) => {
    for (const listener of environmentListeners) {
      listener(payload)
    }
  }

  return {
    store,
    projectPresenter,
    configClient,
    emitDefaultProjectPathChanged,
    emitProjectEnvironmentsChanged
  }
}

const createEnvironment = (path: string, sortOrder: number) => ({
  path,
  name: path.split('/').pop() ?? path,
  sessionCount: 1,
  lastUsedAt: 100,
  isTemp: false,
  exists: true,
  status: 'active' as const,
  sortOrder,
  archivedAt: null,
  removedAt: null
})

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('projectStore default project handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies the default directory and injects a synthetic project when it is not recent', async () => {
    const { store } = await setupStore({
      recentProjects: [{ path: '/work/recent', name: 'recent', icon: null, exists: true }],
      defaultProjectPath: '/work/default'
    })

    await store.fetchProjects()

    expect(store.defaultProjectPath.value).toBe('/work/default')
    expect(store.selectedProject.value?.path).toBe('/work/default')
    expect(store.projects.value[0]).toMatchObject({
      path: '/work/default',
      name: 'default',
      isSynthetic: true
    })
  })

  it('keeps bootstrap chat workspace metadata when the default changes', async () => {
    const { store, emitDefaultProjectPathChanged } = await setupStore({
      recentProjects: [],
      defaultProjectPath: '/work/default'
    })

    store.applyBootstrapDefaultProjectPath('/work/default', '/work/default')

    expect(store.defaultChatWorkspacePath.value).toBe('/work/default')

    emitDefaultProjectPathChanged('/work/custom')

    expect(store.defaultProjectPath.value).toBe('/work/custom')
    expect(store.defaultChatWorkspacePath.value).toBe('/work/default')
  })

  it('keeps a manual project selection when the default project changes later', async () => {
    const { store, emitDefaultProjectPathChanged } = await setupStore({
      recentProjects: [{ path: '/work/recent', name: 'recent', icon: null, exists: true }],
      defaultProjectPath: '/work/default'
    })

    await store.fetchProjects()
    store.selectProject('/work/manual')

    emitDefaultProjectPathChanged('/work/changed-default')

    expect(store.defaultProjectPath.value).toBe('/work/changed-default')
    expect(store.selectedProject.value?.path).toBe('/work/manual')
    expect(store.projects.value.map((project) => project.path)).toEqual([
      '/work/changed-default',
      '/work/manual',
      '/work/recent'
    ])
  })

  it('updates the selected project when the default selection source is still active', async () => {
    const { store, emitDefaultProjectPathChanged } = await setupStore({
      recentProjects: [{ path: '/work/recent', name: 'recent', icon: null, exists: true }],
      defaultProjectPath: '/work/default'
    })

    await store.fetchProjects()

    emitDefaultProjectPathChanged('/work/changed-default')

    expect(store.selectedProject.value?.path).toBe('/work/changed-default')
  })

  it('keeps an explicit clear selection instead of reapplying the default directory', async () => {
    const { store, emitDefaultProjectPathChanged } = await setupStore({
      recentProjects: [{ path: '/work/recent', name: 'recent', icon: null, exists: true }],
      defaultProjectPath: '/work/default'
    })

    await store.fetchProjects()
    store.selectProject(null, 'manual')

    expect(store.selectedProjectPath.value).toBeNull()
    expect(store.selectedProject.value).toBeUndefined()

    emitDefaultProjectPathChanged('/work/changed-default')

    expect(store.defaultProjectPath.value).toBe('/work/changed-default')
    expect(store.selectedProjectPath.value).toBeNull()
    expect(store.selectedProject.value).toBeUndefined()
  })

  it('reorders active environments and removes deleted recent projects locally', async () => {
    const { store, projectPresenter } = await setupStore({
      recentProjects: [
        { path: '/work/a', name: 'a', icon: null, exists: true },
        { path: '/work/b', name: 'b', icon: null, exists: true }
      ]
    })
    store.environments.value = [
      {
        path: '/work/a',
        name: 'a',
        sessionCount: 1,
        lastUsedAt: 100,
        isTemp: false,
        exists: true,
        status: 'active',
        sortOrder: 0,
        archivedAt: null,
        removedAt: null
      },
      {
        path: '/work/b',
        name: 'b',
        sessionCount: 1,
        lastUsedAt: 200,
        isTemp: false,
        exists: true,
        status: 'active',
        sortOrder: 1,
        archivedAt: null,
        removedAt: null
      }
    ]
    projectPresenter.getEnvironments.mockResolvedValueOnce(store.environments.value)

    await store.reorderEnvironments(['/work/b', '/work/missing', '/work/a'])

    expect(projectPresenter.reorderEnvironments).toHaveBeenCalledWith(['/work/b', '/work/a'])

    projectPresenter.reorderEnvironments.mockClear()
    await store.reorderEnvironments(['/work/missing'])
    expect(projectPresenter.reorderEnvironments).not.toHaveBeenCalled()

    await store.fetchProjects()
    store.selectProject('/work/a')

    await expect(store.removeEnvironment('/work/a')).resolves.toEqual({
      clearedSessionIds: ['s1']
    })
    expect(projectPresenter.removeEnvironment).toHaveBeenCalledWith('/work/a')
    expect(store.projects.value.some((project) => project.path === '/work/a')).toBe(false)
    expect(store.selectedProjectPath.value).toBeNull()
  })

  it('keeps the latest optimistic reorder when an earlier request fails', async () => {
    const { store, projectPresenter } = await setupStore()
    store.environments.value = [
      createEnvironment('/work/a', 0),
      createEnvironment('/work/b', 1),
      createEnvironment('/work/c', 2)
    ]

    const firstReorder = deferred<{ updated: boolean }>()
    const secondReorder = deferred<{ updated: boolean }>()
    const latest = [
      createEnvironment('/work/c', 0),
      createEnvironment('/work/b', 1),
      createEnvironment('/work/a', 2)
    ]
    projectPresenter.reorderEnvironments
      .mockImplementationOnce(() => firstReorder.promise)
      .mockImplementationOnce(() => secondReorder.promise)
    projectPresenter.getEnvironments.mockResolvedValue(latest)

    const firstRequest = store.reorderEnvironments(['/work/b', '/work/a', '/work/c'])
    const secondRequest = store.reorderEnvironments(['/work/c', '/work/b', '/work/a'])

    secondReorder.resolve({ updated: true })
    await secondRequest
    firstReorder.reject(new Error('first reorder failed'))

    await expect(firstRequest).rejects.toThrow('first reorder failed')
    expect(store.environments.value.map((environment) => environment.path)).toEqual([
      '/work/c',
      '/work/b',
      '/work/a'
    ])
  })

  it('does not roll back an archive that succeeds while a reorder is pending', async () => {
    const { store, projectPresenter } = await setupStore()
    const original = [
      createEnvironment('/work/a', 0),
      createEnvironment('/work/b', 1),
      createEnvironment('/work/c', 2)
    ]
    const activeAfterArchive = [createEnvironment('/work/b', 0), createEnvironment('/work/c', 1)]
    const archived = [{ ...createEnvironment('/work/a', 0), status: 'archived' as const }]
    store.environments.value = original

    const pendingReorder = deferred<{ updated: boolean }>()
    projectPresenter.reorderEnvironments.mockImplementationOnce(() => pendingReorder.promise)
    projectPresenter.getEnvironments.mockImplementation(async (status: string) => {
      if (status === 'active') return activeAfterArchive
      if (status === 'archived') return archived
      return []
    })

    const reorderRequest = store.reorderEnvironments(['/work/b', '/work/a', '/work/c'])
    await store.archiveEnvironment('/work/a')

    pendingReorder.reject(new Error('reorder failed'))
    await expect(reorderRequest).rejects.toThrow('reorder failed')

    expect(store.environments.value).toEqual(activeAfterArchive)
    expect(store.archivedEnvironments.value).toEqual(archived)
    expect(store.error.value).toBeNull()
  })

  it('lets a later archive own the refresh after an earlier reorder succeeds', async () => {
    const { store, projectPresenter } = await setupStore()
    const activeAfterArchive = [createEnvironment('/work/b', 0), createEnvironment('/work/c', 1)]
    store.environments.value = [
      createEnvironment('/work/a', 0),
      createEnvironment('/work/b', 1),
      createEnvironment('/work/c', 2)
    ]

    const pendingReorder = deferred<{ updated: boolean }>()
    const pendingArchive = deferred<{ updated: boolean }>()
    projectPresenter.reorderEnvironments.mockImplementationOnce(() => pendingReorder.promise)
    projectPresenter.archiveEnvironment.mockImplementationOnce(() => pendingArchive.promise)
    projectPresenter.getEnvironments.mockImplementation(async (status: string) =>
      status === 'active' ? activeAfterArchive : []
    )

    const reorderRequest = store.reorderEnvironments(['/work/b', '/work/a', '/work/c'])
    const archiveRequest = store.archiveEnvironment('/work/a')

    pendingReorder.resolve({ updated: true })
    await reorderRequest
    expect(projectPresenter.getEnvironments).not.toHaveBeenCalled()

    pendingArchive.resolve({ updated: true })
    await archiveRequest

    expect(store.environments.value).toEqual(activeAfterArchive)
    expect(projectPresenter.getEnvironments).toHaveBeenCalledTimes(3)
  })

  it('does not apply a stale reorder refresh after a newer reorder succeeds', async () => {
    const { store, projectPresenter } = await setupStore()
    store.environments.value = [
      createEnvironment('/work/a', 0),
      createEnvironment('/work/b', 1),
      createEnvironment('/work/c', 2)
    ]

    const firstReorder = deferred<{ updated: boolean }>()
    const firstRefreshes = [deferred<unknown[]>(), deferred<unknown[]>(), deferred<unknown[]>()]
    const latest = [
      createEnvironment('/work/c', 0),
      createEnvironment('/work/b', 1),
      createEnvironment('/work/a', 2)
    ]
    let environmentFetchCallCount = 0
    projectPresenter.reorderEnvironments
      .mockImplementationOnce(() => firstReorder.promise)
      .mockResolvedValueOnce({ updated: true })
    projectPresenter.getEnvironments.mockImplementation(() => {
      const refresh = firstRefreshes[environmentFetchCallCount++]
      return refresh ? refresh.promise : Promise.resolve(latest)
    })

    const firstRequest = store.reorderEnvironments(['/work/b', '/work/a', '/work/c'])
    firstReorder.resolve({ updated: true })
    await vi.waitFor(() => expect(environmentFetchCallCount).toBe(3))

    const secondRequest = store.reorderEnvironments(['/work/c', '/work/b', '/work/a'])
    await secondRequest

    const stale = [
      createEnvironment('/work/b', 0),
      createEnvironment('/work/a', 1),
      createEnvironment('/work/c', 2)
    ]
    for (const refresh of firstRefreshes) {
      refresh.resolve(stale)
    }
    await firstRequest

    expect(store.environments.value).toEqual(latest)
  })

  it('does not let an older environment snapshot overwrite an external refresh', async () => {
    const { store, projectPresenter, emitProjectEnvironmentsChanged } = await setupStore()
    const staleRefreshes = [deferred<unknown[]>(), deferred<unknown[]>(), deferred<unknown[]>()]
    const fresh = [createEnvironment('/work/fresh', 0)]
    let calls = 0
    projectPresenter.getEnvironments.mockImplementation(() => {
      const staleRefresh = staleRefreshes[calls++]
      return staleRefresh ? staleRefresh.promise : Promise.resolve(fresh)
    })

    const staleRequest = store.fetchEnvironments()
    emitProjectEnvironmentsChanged({
      action: 'archive',
      path: '/work/stale',
      version: 1
    })

    await vi.waitFor(() => expect(calls).toBe(6))
    for (const staleRefresh of staleRefreshes) {
      staleRefresh.resolve([createEnvironment('/work/stale', 0)])
    }
    await staleRequest

    expect(store.environments.value).toEqual(fresh)
  })

  it('does not let a stale projects and default snapshot overwrite a local default update', async () => {
    const { store, projectPresenter, configClient } = await setupStore()
    const staleProjects =
      deferred<Array<{ path: string; name: string; icon: null; exists: boolean }>>()
    const staleDefault = deferred<string | null>()
    projectPresenter.getRecentProjects.mockReturnValueOnce(staleProjects.promise)
    configClient.getDefaultProjectPath.mockReturnValueOnce(staleDefault.promise)

    const staleRequest = store.fetchProjects()
    await store.setDefaultProject('/work/current')

    staleProjects.resolve([{ path: '/work/stale', name: 'stale', icon: null, exists: true }])
    staleDefault.resolve('/work/stale')
    await staleRequest

    expect(store.defaultProjectPath.value).toBe('/work/current')
    expect(store.selectedProject.value?.path).toBe('/work/current')
  })

  it('refreshes project data when environments change in another window', async () => {
    const { store, projectPresenter, emitProjectEnvironmentsChanged } = await setupStore({
      recentProjects: [
        { path: '/work/a', name: 'a', icon: null, exists: true },
        { path: '/work/b', name: 'b', icon: null, exists: true }
      ]
    })

    await store.fetchProjects()
    store.selectProject('/work/a')
    projectPresenter.getRecentProjects.mockResolvedValueOnce([
      { path: '/work/b', name: 'b', icon: null, exists: true }
    ])

    emitProjectEnvironmentsChanged({
      action: 'remove',
      path: '/work/a',
      version: 1
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(projectPresenter.getRecentProjects).toHaveBeenCalled()
    expect(projectPresenter.getEnvironments).toHaveBeenCalled()
    expect(store.projects.value.map((project) => project.path)).toEqual(['/work/b'])
    expect(store.selectedProjectPath.value).toBeNull()
  })
})
