import { beforeEach, describe, expect, it, vi } from 'vitest'

const environment = (path: string, status: 'active' | 'archived' | 'removed' = 'active') => ({
  path,
  name: path.split('/').pop() ?? path,
  sessionCount: 1,
  lastUsedAt: 100,
  isTemp: false,
  exists: true,
  status,
  sortOrder: 0,
  archivedAt: status === 'archived' ? 100 : null,
  removedAt: status === 'removed' ? 100 : null
})

const snapshot = (version: number, paths: string[] = ['/work/recent']) => ({
  version,
  projects: paths.map((path) => ({ path, name: path.split('/').pop()!, icon: null, exists: true })),
  environments: paths.map((path) => environment(path)),
  archivedEnvironments: [],
  removedEnvironments: [],
  defaultProjectPath: null
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function setupStore() {
  vi.resetModules()
  const defaultListeners: Array<(payload: { path: string | null; version: number }) => void> = []
  const environmentListeners: Array<
    (payload: {
      action: 'reorder' | 'archive' | 'restore' | 'remove' | 'select'
      path: string | null
      version: number
    }) => void
  > = []
  const projectClient = {
    getSnapshot: vi.fn().mockResolvedValue(snapshot(1)),
    reorderEnvironments: vi.fn().mockResolvedValue({ updated: true }),
    archiveEnvironment: vi.fn().mockResolvedValue({ updated: true }),
    restoreEnvironment: vi.fn().mockResolvedValue({ updated: true }),
    removeEnvironment: vi.fn().mockResolvedValue({ clearedSessionIds: ['s1'] }),
    openDirectory: vi.fn().mockResolvedValue(undefined),
    selectDirectory: vi.fn().mockResolvedValue(null),
    onEnvironmentsChanged: vi.fn((listener) => {
      environmentListeners.push(listener)
      return () => undefined
    })
  }
  const configClient = {
    setDefaultProjectPath: vi.fn().mockResolvedValue({ path: null }),
    onDefaultProjectPathChanged: vi.fn((listener) => {
      defaultListeners.push(listener)
      return () => undefined
    })
  }

  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return { ...actual, defineStore: (_id: string, setup: () => unknown) => setup }
  })
  vi.doMock('../../../src/renderer/api/ProjectClient', () => ({
    createProjectClient: vi.fn(() => projectClient)
  }))
  vi.doMock('../../../src/renderer/api/ConfigClient', () => ({
    createConfigClient: vi.fn(() => configClient)
  }))

  const { useProjectStore } = await import('@/stores/ui/project')
  return {
    store: useProjectStore(),
    projectClient,
    configClient,
    emitEnvironment: (version: number) =>
      environmentListeners.forEach((listener) =>
        listener({ action: 'archive', path: '/work/a', version })
      ),
    emitDefault: (version: number) =>
      defaultListeners.forEach((listener) => listener({ path: '/work/a', version }))
  }
}

describe('projectStore snapshot ownership', () => {
  beforeEach(() => vi.clearAllMocks())

  it('commits projects, environments, and default path from one snapshot', async () => {
    const { store, projectClient } = await setupStore()
    projectClient.getSnapshot.mockResolvedValue({
      ...snapshot(2, ['/work/recent']),
      environments: [environment('/work/active')],
      archivedEnvironments: [environment('/work/archived', 'archived')],
      removedEnvironments: [environment('/work/removed', 'removed')],
      defaultProjectPath: '/work/default'
    })

    await store.refreshProjectSnapshot()

    expect(store.defaultProjectPath.value).toBe('/work/default')
    expect(store.projects.value.map((project) => project.path)).toEqual([
      '/work/default',
      '/work/recent'
    ])
    expect(store.environments.value.map((item) => item.path)).toEqual(['/work/active'])
    expect(store.archivedEnvironments.value.map((item) => item.path)).toEqual(['/work/archived'])
    expect(store.removedEnvironments.value.map((item) => item.path)).toEqual(['/work/removed'])
  })

  it('coalesces concurrent refresh requests into one snapshot read', async () => {
    const { store, projectClient } = await setupStore()
    const pending = deferred<ReturnType<typeof snapshot>>()
    projectClient.getSnapshot.mockReturnValueOnce(pending.promise)

    const first = store.refreshProjectSnapshot()
    const second = store.fetchProjects()
    expect(projectClient.getSnapshot).toHaveBeenCalledTimes(1)

    pending.resolve(snapshot(1))
    await Promise.all([first, second])
    expect(projectClient.getSnapshot).toHaveBeenCalledTimes(1)
  })

  it('queues a newer event version received while a snapshot is in flight', async () => {
    const { store, projectClient, emitEnvironment } = await setupStore()
    const first = deferred<ReturnType<typeof snapshot>>()
    projectClient.getSnapshot
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(snapshot(2))

    const request = store.refreshProjectSnapshot()
    emitEnvironment(2)
    first.resolve(snapshot(1))
    await request

    expect(projectClient.getSnapshot).toHaveBeenCalledTimes(2)
    expect(store.projects.value.map((project) => project.path)).toEqual(['/work/recent'])
  })

  it('retries a newer requested snapshot when the older in-flight read fails', async () => {
    const { store, projectClient, emitEnvironment } = await setupStore()
    const first = deferred<ReturnType<typeof snapshot>>()
    projectClient.getSnapshot
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(snapshot(2, ['/work/after-retry']))

    const request = store.refreshProjectSnapshot()
    emitEnvironment(2)
    first.reject(new Error('stale snapshot read failed'))
    await request

    expect(projectClient.getSnapshot).toHaveBeenCalledTimes(2)
    expect(store.projects.value.map((project) => project.path)).toEqual(['/work/after-retry'])
    expect(store.error.value).toBeNull()
  })

  it('ignores stale versioned events after a newer snapshot has committed', async () => {
    const { store, projectClient, emitDefault } = await setupStore()
    projectClient.getSnapshot.mockResolvedValue(snapshot(5))
    await store.refreshProjectSnapshot()
    emitDefault(4)
    await Promise.resolve()

    expect(projectClient.getSnapshot).toHaveBeenCalledTimes(1)
  })

  it('does not spin when an event arrives before its snapshot projection', async () => {
    const { store, projectClient, emitEnvironment } = await setupStore()
    await store.refreshProjectSnapshot()
    projectClient.getSnapshot.mockResolvedValue(snapshot(2, ['/work/not-yet-projected']))

    emitEnvironment(3)
    await store.refreshProjectSnapshot()

    expect(projectClient.getSnapshot).toHaveBeenCalledTimes(2)
    expect(store.projects.value.map((project) => project.path)).toEqual(['/work/recent'])
  })

  it('does not let a delayed bootstrap default project path overwrite a committed snapshot', async () => {
    const { store, projectClient } = await setupStore()
    projectClient.getSnapshot.mockResolvedValue({
      ...snapshot(2, ['/work/current']),
      defaultProjectPath: '/work/current'
    })

    await store.refreshProjectSnapshot()
    store.applyBootstrapDefaultProjectPath('/work/stale-bootstrap', '/work/bootstrap-workspace')

    expect(store.defaultProjectPath.value).toBe('/work/current')
    expect(store.defaultChatWorkspacePath.value).toBe('/work/bootstrap-workspace')
    expect(store.projects.value.map((project) => project.path)).toEqual(['/work/current'])
  })

  it('refreshes from the snapshot after a project mutation', async () => {
    const { store, projectClient } = await setupStore()
    projectClient.getSnapshot.mockResolvedValue(snapshot(1, ['/work/a', '/work/b']))
    await store.refreshProjectSnapshot()
    projectClient.removeEnvironment.mockResolvedValue({ clearedSessionIds: ['s1'] })
    projectClient.getSnapshot.mockResolvedValue(snapshot(2, ['/work/b']))

    await expect(store.removeEnvironment('/work/a')).resolves.toEqual({ clearedSessionIds: ['s1'] })
    expect(store.projects.value.map((project) => project.path)).toEqual(['/work/b'])
  })

  it('does not commit a mutation refresh ahead of a newer environment event', async () => {
    const { store, projectClient, emitEnvironment } = await setupStore()
    await store.refreshProjectSnapshot()

    const mutationSnapshot = deferred<ReturnType<typeof snapshot>>()
    projectClient.removeEnvironment.mockResolvedValue({ clearedSessionIds: ['s1'] })
    projectClient.getSnapshot
      .mockImplementationOnce(() => mutationSnapshot.promise)
      .mockResolvedValueOnce(snapshot(3, ['/work/after-event']))

    const mutation = store.removeEnvironment('/work/a')
    await Promise.resolve()
    emitEnvironment(3)
    mutationSnapshot.resolve(snapshot(2, ['/work/after-mutation']))

    await expect(mutation).resolves.toEqual({ clearedSessionIds: ['s1'] })
    expect(projectClient.getSnapshot).toHaveBeenCalledTimes(3)
    expect(store.projects.value.map((project) => project.path)).toEqual(['/work/after-event'])
  })
})
