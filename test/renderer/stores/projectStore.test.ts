import { beforeEach, describe, expect, it, vi } from 'vitest'

const setupStore = async (overrides?: {
  recentProjects?: Array<{ path: string; name: string; icon: string | null }>
  defaultProjectPath?: string | null
}) => {
  vi.resetModules()

  const listeners = new Map<string, Array<(...args: any[]) => void>>()
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
  const configPresenter = {
    getDefaultProjectPath: vi.fn().mockResolvedValue(overrides?.defaultProjectPath ?? null),
    setDefaultProjectPath: vi.fn().mockResolvedValue(undefined)
  }

  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      defineStore: (_id: string, setup: () => unknown) => setup
    }
  })
  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) =>
      name === 'projectPresenter' ? projectPresenter : configPresenter
  }))
  ;(window as any).electron = {
    ipcRenderer: {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        const handlers = listeners.get(event) ?? []
        handlers.push(handler)
        listeners.set(event, handlers)
      })
    }
  }

  const { useProjectStore } = await import('@/stores/ui/project')
  const { CONFIG_EVENTS } = await import('@/events')
  const store = useProjectStore()
  const emitIpc = (event: string, payload?: unknown) => {
    for (const handler of listeners.get(event) ?? []) {
      handler(undefined, payload)
    }
  }

  return {
    store,
    projectPresenter,
    configPresenter,
    CONFIG_EVENTS,
    emitIpc
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
    const { store, emitIpc, CONFIG_EVENTS } = await setupStore({
      recentProjects: [{ path: '/work/recent', name: 'recent', icon: null }],
      defaultProjectPath: '/work/default'
    })

    await store.fetchProjects()
    store.selectProject('/work/manual')

    emitIpc(CONFIG_EVENTS.DEFAULT_PROJECT_PATH_CHANGED, {
      path: '/work/changed-default'
    })

    expect(store.defaultProjectPath.value).toBe('/work/changed-default')
    expect(store.selectedProject.value?.path).toBe('/work/manual')
    expect(store.projects.value.map((project) => project.path)).toEqual([
      '/work/changed-default',
      '/work/manual',
      '/work/recent'
    ])
  })

  it('updates the selected project when the default selection source is still active', async () => {
    const { store, emitIpc, CONFIG_EVENTS } = await setupStore({
      recentProjects: [{ path: '/work/recent', name: 'recent', icon: null }],
      defaultProjectPath: '/work/default'
    })

    await store.fetchProjects()

    emitIpc(CONFIG_EVENTS.DEFAULT_PROJECT_PATH_CHANGED, {
      path: '/work/changed-default'
    })

    expect(store.selectedProject.value?.path).toBe('/work/changed-default')
  })
})
