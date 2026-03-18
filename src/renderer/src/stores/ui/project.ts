import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS } from '@/events'
import type { EnvironmentSummary, Project } from '@shared/types/agent-interface'

// --- Type Definitions ---

export interface UIProject {
  name: string
  path: string
  icon: string | null
  isSynthetic?: boolean
}

type ProjectSelectionSource = 'none' | 'manual' | 'default'

// --- Store ---

export const useProjectStore = defineStore('project', () => {
  const projectPresenter = usePresenter('projectPresenter', { safeCall: false })
  const configPresenter = usePresenter('configPresenter', { safeCall: false })

  // --- State ---
  const projects = ref<UIProject[]>([])
  const environments = ref<EnvironmentSummary[]>([])
  const selectedProjectPath = ref<string | null>(null)
  const defaultProjectPath = ref<string | null>(null)
  const selectionSource = ref<ProjectSelectionSource>('none')
  const error = ref<string | null>(null)
  let listenersRegistered = false

  // --- Getters ---
  const selectedProject = computed(() =>
    projects.value.find((p) => p.path === selectedProjectPath.value)
  )

  const normalizePath = (path: string | null | undefined): string | null => {
    const normalized = path?.trim()
    return normalized ? normalized : null
  }

  const createSyntheticProject = (projectPath: string): UIProject => ({
    name: projectPath.split(/[/\\]/).pop() ?? projectPath,
    path: projectPath,
    icon: null,
    isSynthetic: true
  })

  const reconcileProjects = (baseProjects: UIProject[]): UIProject[] => {
    const nextProjects = baseProjects.filter((project) => !project.isSynthetic)
    const syntheticPaths: string[] = []

    if (
      selectionSource.value === 'manual' &&
      selectedProjectPath.value &&
      !nextProjects.some((project) => project.path === selectedProjectPath.value)
    ) {
      syntheticPaths.push(selectedProjectPath.value)
    }

    if (
      defaultProjectPath.value &&
      !nextProjects.some((project) => project.path === defaultProjectPath.value) &&
      !syntheticPaths.includes(defaultProjectPath.value)
    ) {
      syntheticPaths.unshift(defaultProjectPath.value)
    }

    return [...syntheticPaths.map(createSyntheticProject), ...nextProjects]
  }

  const applyDefaultSelection = () => {
    if (!defaultProjectPath.value) {
      if (selectionSource.value === 'default') {
        selectedProjectPath.value = null
        selectionSource.value = 'none'
      }
      return
    }

    if (selectionSource.value === 'none' || selectionSource.value === 'default') {
      selectedProjectPath.value = defaultProjectPath.value
      selectionSource.value = 'default'
    }
  }

  const handleDefaultProjectPathChanged = (
    _event?: unknown,
    payload?: string | { path?: string | null }
  ) => {
    defaultProjectPath.value = normalizePath(
      typeof payload === 'string' ? payload : (payload?.path ?? null)
    )
    projects.value = reconcileProjects(projects.value)
    applyDefaultSelection()
  }

  const ensureListenersRegistered = () => {
    if (listenersRegistered || !window?.electron?.ipcRenderer) return
    window.electron.ipcRenderer.on(
      CONFIG_EVENTS.DEFAULT_PROJECT_PATH_CHANGED,
      handleDefaultProjectPathChanged
    )
    listenersRegistered = true
  }

  ensureListenersRegistered()

  // --- Actions ---

  async function loadDefaultProjectPath(): Promise<void> {
    try {
      defaultProjectPath.value = normalizePath(await configPresenter.getDefaultProjectPath())
      projects.value = reconcileProjects(projects.value)
      applyDefaultSelection()
    } catch (e) {
      error.value = `Failed to load default project path: ${e}`
    }
  }

  async function fetchProjects(): Promise<void> {
    try {
      const [result, nextDefaultProjectPath] = await Promise.all([
        projectPresenter.getRecentProjects(20),
        configPresenter.getDefaultProjectPath()
      ])

      defaultProjectPath.value = normalizePath(nextDefaultProjectPath)
      projects.value = reconcileProjects(
        (result as Project[]).map((p) => ({
          name: p.name,
          path: p.path,
          icon: p.icon
        }))
      )
      applyDefaultSelection()
    } catch (e) {
      error.value = `Failed to load projects: ${e}`
    }
  }

  async function fetchEnvironments(): Promise<void> {
    try {
      environments.value = await projectPresenter.getEnvironments()
    } catch (e) {
      error.value = `Failed to load environments: ${e}`
    }
  }

  function selectProject(
    path: string | null,
    source: ProjectSelectionSource = normalizePath(path) ? 'manual' : 'none'
  ): void {
    selectedProjectPath.value = normalizePath(path)
    selectionSource.value = selectedProjectPath.value ? source : 'none'
    projects.value = reconcileProjects(projects.value)
  }

  async function setDefaultProject(path: string | null): Promise<void> {
    const normalizedPath = normalizePath(path)
    try {
      await configPresenter.setDefaultProjectPath(normalizedPath)
      handleDefaultProjectPathChanged(undefined, { path: normalizedPath })
    } catch (e) {
      error.value = `Failed to update default project path: ${e}`
      throw e
    }
  }

  async function clearDefaultProject(): Promise<void> {
    await setDefaultProject(null)
  }

  async function openDirectory(path: string): Promise<void> {
    try {
      await projectPresenter.openDirectory(path)
    } catch (e) {
      error.value = `Failed to open directory: ${e}`
      throw e
    }
  }

  async function refreshEnvironmentData(): Promise<void> {
    await Promise.all([loadDefaultProjectPath(), fetchEnvironments()])
  }

  async function openFolderPicker(): Promise<void> {
    try {
      const selectedPath = await projectPresenter.selectDirectory()
      if (selectedPath) {
        const name = selectedPath.split(/[/\\]/).pop() ?? selectedPath
        const nextProjects = projects.value.filter((project) => project.path !== selectedPath)
        nextProjects.unshift({
          name,
          path: selectedPath,
          icon: null
        })
        projects.value = reconcileProjects(nextProjects)
        selectProject(selectedPath, 'manual')
      }
    } catch (e) {
      error.value = `Failed to open folder picker: ${e}`
    }
  }

  return {
    projects,
    environments,
    selectedProjectPath,
    defaultProjectPath,
    error,
    selectedProject,
    fetchProjects,
    fetchEnvironments,
    loadDefaultProjectPath,
    refreshEnvironmentData,
    selectProject,
    setDefaultProject,
    clearDefaultProject,
    openDirectory,
    openFolderPicker
  }
})
