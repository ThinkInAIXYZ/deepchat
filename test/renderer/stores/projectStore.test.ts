import { beforeEach, describe, expect, it, vi } from 'vitest'

const setupStore = async (overrides?: {
  recentProjects?: Array<{ path: string; name: string; icon: string | null }>
  defaultProjectPath?: string | null
}) => {
  vi.resetModules()

  const defaultProjectPathListeners: Array<
    (payload: { path: string | null; version: number }) => void
  > = []
  const projectPresenter = {
    getRecentProjects: vi
      .fn()
      .mockResolvedValue(
        overrides?.recentProjects ?? [{ path: '/work/recent', name: 'recent', icon: null }]
      ),
    getEnvironments: vi.fn().mockResolvedValue([]),
    openDirectory: vi.fn().mockResolvedValue(undefined),
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
    ProjectClient: vi.fn(() => ({
      listRecent: projectPresenter.getRecentProjects,
      listEnvironments: projectPresenter.getEnvironments,
      openDirectory: projectPresenter.openDirectory,
      selectDirectory: projectPresenter.selectDirectory
    }))
  }))
  vi.doMock('../../../src/renderer/api/ConfigClient', () => ({
    ConfigClient: vi.fn(() => configClient)
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

  return {
    store,
    projectPresenter,
    configClient,
    emitDefaultProjectPathChanged
  }
}

describe('projectStore default project handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies the default directory and injects a synthetic project when it is not recent', async () => {
    const { store } = await setupStore({
      recentProjects: [{ path: '/work/recent', name: 'recent', icon: null }],
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

  it('keeps a manual project selection when the default project changes later', async () => {
    const { store, emitDefaultProjectPathChanged } = await setupStore({
      recentProjects: [{ path: '/work/recent', name: 'recent', icon: null }],
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
      recentProjects: [{ path: '/work/recent', name: 'recent', icon: null }],
      defaultProjectPath: '/work/default'
    })

    await store.fetchProjects()

    emitDefaultProjectPathChanged('/work/changed-default')

    expect(store.selectedProject.value?.path).toBe('/work/changed-default')
  })

  it('keeps an explicit clear selection instead of reapplying the default directory', async () => {
    const { store, emitIpc, CONFIG_EVENTS } = await setupStore({
      recentProjects: [{ path: '/work/recent', name: 'recent', icon: null }],
      defaultProjectPath: '/work/default'
    })

    await store.fetchProjects()
    store.selectProject(null, 'manual')

    expect(store.selectedProjectPath.value).toBeNull()
    expect(store.selectedProject.value).toBeUndefined()

    emitIpc(CONFIG_EVENTS.DEFAULT_PROJECT_PATH_CHANGED, {
      path: '/work/changed-default'
    })

    expect(store.defaultProjectPath.value).toBe('/work/changed-default')
    expect(store.selectedProjectPath.value).toBeNull()
    expect(store.selectedProject.value).toBeUndefined()
  })
})
