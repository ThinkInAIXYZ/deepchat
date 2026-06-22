import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { createConfigClient } from '../../../api/ConfigClient'
import { createProjectClient } from '@api/ProjectClient'
import type { EnvironmentSummary, Project } from '@shared/types/agent-interface'

// --- Type Definitions ---

export interface UIProject {
  name: string
  path: string
  icon: string | null
  exists: boolean
  isSynthetic?: boolean
}

type ProjectSelectionSource = 'none' | 'manual' | 'default'

// --- Store ---

export const useProjectStore = defineStore('project', () => {
  const configClient = createConfigClient()
  const projectClient = createProjectClient()

  // --- State ---
  const projects = ref<UIProject[]>([])
  const environments = ref<EnvironmentSummary[]>([])
  const archivedEnvironments = ref<EnvironmentSummary[]>([])
  const removedEnvironments = ref<EnvironmentSummary[]>([])
  const selectedProjectPath = ref<string | null>(null)
  const defaultProjectPath = ref<string | null>(null)
  const defaultChatWorkspacePath = ref<string | null>(null)
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
    exists: true,
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

  const applyBootstrapDefaultProjectPath = (
    path: string | null | undefined,
    chatWorkspacePath?: string | null
  ) => {
    defaultProjectPath.value = normalizePath(path)
    defaultChatWorkspacePath.value = normalizePath(chatWorkspacePath)
    projects.value = reconcileProjects(projects.value)
    applyDefaultSelection()
  }

  const ensureListenersRegistered = () => {
    if (listenersRegistered) return
    configClient.onDefaultProjectPathChanged(({ path }) => {
      handleDefaultProjectPathChanged(undefined, { path })
    })
    projectClient.onEnvironmentsChanged(({ action, path }) => {
      if (action === 'remove' && path) {
        projects.value = projects.value.filter((project) => project.path !== path)
        if (selectedProjectPath.value === path) {
          selectProject(null)
        }
      }

      void refreshProjectData()
    })
    listenersRegistered = true
  }

  ensureListenersRegistered()

  // --- Actions ---

  async function loadDefaultProjectPath(): Promise<void> {
    try {
      applyBootstrapDefaultProjectPath(await configClient.getDefaultProjectPath())
    } catch (e) {
      error.value = `Failed to load default project path: ${e}`
    }
  }

  async function fetchProjects(): Promise<void> {
    try {
      const [result, nextDefaultProjectPath] = await Promise.all([
        projectClient.listRecent(20),
        configClient.getDefaultProjectPath()
      ])

      defaultProjectPath.value = normalizePath(nextDefaultProjectPath)
      projects.value = reconcileProjects(
        (result as Project[]).map((p) => ({
          name: p.name,
          path: p.path,
          icon: p.icon,
          exists: p.exists
        }))
      )
      applyDefaultSelection()
    } catch (e) {
      error.value = `Failed to load projects: ${e}`
    }
  }

  async function fetchEnvironments(): Promise<void> {
    try {
      const [active, archived, removed] = await Promise.all([
        projectClient.listEnvironments('active'),
        projectClient.listEnvironments('archived'),
        projectClient.listEnvironments('removed')
      ])
      environments.value = active
      archivedEnvironments.value = archived
      removedEnvironments.value = removed
    } catch (e) {
      error.value = `Failed to load environments: ${e}`
    }
  }

  async function refreshProjectData(): Promise<void> {
    await Promise.all([fetchProjects(), fetchEnvironments()])
  }

  function selectProject(
    path: string | null,
    source: ProjectSelectionSource = normalizePath(path) ? 'manual' : 'none'
  ): void {
    selectedProjectPath.value = normalizePath(path)
    selectionSource.value = selectedProjectPath.value || source === 'manual' ? source : 'none'
    projects.value = reconcileProjects(projects.value)
  }

  async function setDefaultProject(path: string | null): Promise<void> {
    const normalizedPath = normalizePath(path)
    try {
      await configClient.setDefaultProjectPath(normalizedPath)
      handleDefaultProjectPathChanged(undefined, { path: normalizedPath })
    } catch (e) {
      error.value = `Failed to update default project path: ${e}`
      throw e
    }
  }

  async function clearDefaultProject(): Promise<void> {
    await setDefaultProject(null)
  }

  async function reorderEnvironments(paths: string[]): Promise<void> {
    const normalizedPaths = Array.from(
      new Set(paths.map((environmentPath) => normalizePath(environmentPath)).filter(Boolean))
    ) as string[]

    if (normalizedPaths.length === 0) {
      return
    }

    const previousEnvironments = environments.value
    const byPath = new Map(
      previousEnvironments.map((environment) => [environment.path, environment])
    )
    const orderedPaths = normalizedPaths.filter((environmentPath) => byPath.has(environmentPath))

    if (orderedPaths.length === 0) {
      return
    }

    const orderedPathSet = new Set(orderedPaths)

    environments.value = [
      ...orderedPaths.map((environmentPath, index) => ({
        ...byPath.get(environmentPath)!,
        sortOrder: index
      })),
      ...previousEnvironments.filter((environment) => !orderedPathSet.has(environment.path))
    ]

    try {
      await projectClient.reorderEnvironments(orderedPaths)
      await fetchEnvironments()
    } catch (e) {
      environments.value = previousEnvironments
      error.value = `Failed to reorder environments: ${e}`
      throw e
    }
  }

  async function archiveEnvironment(path: string): Promise<void> {
    try {
      await projectClient.archiveEnvironment(path)
      await fetchEnvironments()
    } catch (e) {
      error.value = `Failed to archive environment: ${e}`
      throw e
    }
  }

  async function restoreEnvironment(path: string): Promise<void> {
    try {
      await projectClient.restoreEnvironment(path)
      await fetchEnvironments()
    } catch (e) {
      error.value = `Failed to restore environment: ${e}`
      throw e
    }
  }

  async function removeEnvironment(path: string): Promise<{ clearedSessionIds: string[] }> {
    try {
      const result = await projectClient.removeEnvironment(path)
      projects.value = projects.value.filter((project) => project.path !== path)
      if (selectedProjectPath.value === path) {
        selectProject(null)
      }
      await Promise.all([loadDefaultProjectPath(), fetchEnvironments()])
      return result
    } catch (e) {
      error.value = `Failed to remove environment: ${e}`
      throw e
    }
  }

  async function openDirectory(path: string): Promise<void> {
    try {
      await projectClient.openDirectory(path)
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
      const selectedPath = await projectClient.selectDirectory()
      if (selectedPath) {
        const name = selectedPath.split(/[/\\]/).pop() ?? selectedPath
        const nextProjects = projects.value.filter((project) => project.path !== selectedPath)
        nextProjects.unshift({
          name,
          path: selectedPath,
          icon: null,
          exists: true
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
    archivedEnvironments,
    removedEnvironments,
    selectedProjectPath,
    defaultProjectPath,
    defaultChatWorkspacePath,
    selectionSource,
    error,
    selectedProject,
    fetchProjects,
    fetchEnvironments,
    loadDefaultProjectPath,
    applyBootstrapDefaultProjectPath,
    refreshEnvironmentData,
    selectProject,
    setDefaultProject,
    clearDefaultProject,
    reorderEnvironments,
    archiveEnvironment,
    restoreEnvironment,
    removeEnvironment,
    openDirectory,
    openFolderPicker
  }
})
