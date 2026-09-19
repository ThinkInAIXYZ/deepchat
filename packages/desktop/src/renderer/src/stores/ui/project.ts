import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createProjectClient } from '@api/ProjectClient'
import { createConfigClient } from '../../../api/ConfigClient'
import type { EnvironmentSummary, Project } from '@shared/types/agent-interface'
import { normalizeWorkspacePath } from '@shared/utils/filesystem'

export interface UIProject {
  name: string
  path: string
  icon: string | null
  exists: boolean
  isSynthetic?: boolean
}

type ProjectSelectionSource = 'none' | 'manual' | 'default'

type OpenFolderPickerOptions = {
  select?: boolean
}

type ProjectSnapshot = {
  version: number
  projects: Project[]
  environments: EnvironmentSummary[]
  archivedEnvironments: EnvironmentSummary[]
  removedEnvironments: EnvironmentSummary[]
  defaultProjectPath: string | null
  defaultChatWorkspacePath: string | null
}

export const useProjectStore = defineStore('project', () => {
  const projectClient = createProjectClient()
  const configClient = createConfigClient()
  const projects = ref<UIProject[]>([])
  const environments = ref<EnvironmentSummary[]>([])
  const archivedEnvironments = ref<EnvironmentSummary[]>([])
  const removedEnvironments = ref<EnvironmentSummary[]>([])
  const selectedProjectPath = ref<string | null>(null)
  const defaultProjectPath = ref<string | null>(null)
  const defaultChatWorkspacePath = ref<string | null>(null)
  const snapshotReady = ref(false)
  const selectionSource = ref<ProjectSelectionSource>('none')
  const error = ref<string | null>(null)
  let listenersRegistered = false
  let committedSnapshotVersion = -1
  let requestedSnapshotVersion = 0
  let refreshPromise: Promise<void> | null = null

  const selectedProject = computed(() =>
    projects.value.find((project) => project.path === selectedProjectPath.value)
  )

  const normalizePath = (path: string | null | undefined): string | null => path?.trim() || null
  const createSyntheticProject = (projectPath: string): UIProject => ({
    name: projectPath.split(/[/\\]/).pop() || projectPath,
    path: projectPath,
    icon: null,
    exists: true,
    isSynthetic: true
  })

  function reconcileProjects(baseProjects: UIProject[]): UIProject[] {
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

  function applyDefaultSelection(): void {
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

  function applySnapshot(snapshot: ProjectSnapshot): boolean {
    if (snapshot.version < committedSnapshotVersion) return false
    committedSnapshotVersion = snapshot.version
    defaultProjectPath.value = normalizePath(snapshot.defaultProjectPath)
    defaultChatWorkspacePath.value = normalizePath(snapshot.defaultChatWorkspacePath)
    environments.value = snapshot.environments
    archivedEnvironments.value = snapshot.archivedEnvironments
    removedEnvironments.value = snapshot.removedEnvironments
    if (
      selectedProjectPath.value &&
      selectionSource.value === 'manual' &&
      [...archivedEnvironments.value, ...removedEnvironments.value].some(
        (environment) =>
          normalizeWorkspacePath(environment.path) ===
          normalizeWorkspacePath(selectedProjectPath.value)
      )
    ) {
      selectedProjectPath.value = null
      selectionSource.value = 'none'
    }
    projects.value = reconcileProjects(
      snapshot.projects.map((project) => ({
        name: project.name,
        path: project.path,
        icon: project.icon,
        exists: project.exists
      }))
    )
    if (
      selectedProjectPath.value &&
      selectionSource.value !== 'manual' &&
      !projects.value.some((project) => project.path === selectedProjectPath.value)
    ) {
      selectedProjectPath.value = null
      selectionSource.value = 'none'
    }
    applyDefaultSelection()
    snapshotReady.value = true
    error.value = null
    return true
  }

  async function refreshProjectSnapshot(minVersion = 0): Promise<boolean> {
    requestedSnapshotVersion = Math.max(requestedSnapshotVersion, minVersion)
    if (!refreshPromise) {
      refreshPromise = (async () => {
        do {
          const targetVersion = requestedSnapshotVersion
          try {
            const snapshot = (await projectClient.getSnapshot()) as ProjectSnapshot
            if (snapshot.version >= targetVersion && snapshot.version >= committedSnapshotVersion) {
              applySnapshot(snapshot)
            } else {
              if (requestedSnapshotVersion > targetVersion) {
                continue
              }
              // Events can become visible before their corresponding snapshot
              // projection. Do not spin on a successful but incomplete read;
              // leave the last committed state intact until a later refresh.
              return
            }
          } catch (cause) {
            // A versioned notification may arrive while the older read fails. In
            // that case this single refresh owner must consume the newer target
            // instead of publishing a stale failure that strands the store.
            if (requestedSnapshotVersion > targetVersion) {
              continue
            }
            error.value = `Failed to load project snapshot: ${cause}`
            return
          }
        } while (committedSnapshotVersion < requestedSnapshotVersion)
      })().finally(() => {
        refreshPromise = null
      })
    }

    await refreshPromise
    return committedSnapshotVersion >= minVersion && error.value === null
  }

  async function requireProjectSnapshot(minVersion = 0): Promise<void> {
    const committed = await refreshProjectSnapshot(minVersion)
    if (!committed || error.value) {
      const message = error.value ?? `Project snapshot version ${minVersion} was not committed`
      error.value = message
      throw new Error(message)
    }
  }

  function ensureListenersRegistered(): void {
    if (listenersRegistered) return
    projectClient.onEnvironmentsChanged(({ version }) => {
      if (version > committedSnapshotVersion) {
        void refreshProjectSnapshot(version)
      }
    })
    configClient.onDefaultProjectPathChanged(({ version }) => {
      if (version > committedSnapshotVersion) {
        void refreshProjectSnapshot(version)
      }
    })
    listenersRegistered = true
  }

  ensureListenersRegistered()

  function selectProject(
    path: string | null,
    source: ProjectSelectionSource = normalizePath(path) ? 'manual' : 'none'
  ): void {
    selectedProjectPath.value = normalizePath(path)
    selectionSource.value = selectedProjectPath.value || source === 'manual' ? source : 'none'
    projects.value = reconcileProjects(projects.value)
  }

  function applyBootstrapDefaultProjectPath(
    path: string | null | undefined,
    chatWorkspacePath?: string | null
  ): void {
    if (committedSnapshotVersion >= 0) {
      return
    }

    // A delayed bootstrap response must not roll back a committed Project snapshot.
    defaultChatWorkspacePath.value = normalizePath(chatWorkspacePath)
    defaultProjectPath.value = normalizePath(path)
    projects.value = reconcileProjects(projects.value)
    applyDefaultSelection()
  }

  async function setDefaultProject(path: string | null): Promise<void> {
    try {
      await configClient.setDefaultProjectPath(normalizePath(path))
      await requireProjectSnapshot()
    } catch (cause) {
      error.value = `Failed to update default project path: ${cause}`
      throw cause
    }
  }

  async function reorderEnvironments(paths: string[]): Promise<void> {
    const normalizedPaths = Array.from(
      new Set(paths.map(normalizePath).filter(Boolean))
    ) as string[]
    if (normalizedPaths.length === 0) return
    const activePaths = new Set(environments.value.map((environment) => environment.path))
    const orderedPaths = normalizedPaths.filter((path) => activePaths.has(path))
    if (orderedPaths.length === 0) return
    try {
      await projectClient.reorderEnvironments(orderedPaths)
      await requireProjectSnapshot()
    } catch (cause) {
      error.value = `Failed to reorder environments: ${cause}`
      await refreshProjectSnapshot()
      throw cause
    }
  }

  async function archiveEnvironment(path: string): Promise<void> {
    try {
      const result = await projectClient.archiveEnvironment(path)
      await requireProjectSnapshot(result.version)
      const pathIdentity = normalizeWorkspacePath(path)
      if (
        environments.value.some(
          (environment) => normalizeWorkspacePath(environment.path) === pathIdentity
        ) ||
        !archivedEnvironments.value.some(
          (environment) => normalizeWorkspacePath(environment.path) === pathIdentity
        )
      ) {
        throw new Error('Archived environment is missing from the committed project snapshot')
      }
    } catch (cause) {
      error.value = `Failed to archive environment: ${cause}`
      throw cause
    }
  }

  async function restoreEnvironment(path: string): Promise<void> {
    try {
      await projectClient.restoreEnvironment(path)
      await requireProjectSnapshot()
    } catch (cause) {
      error.value = `Failed to restore environment: ${cause}`
      throw cause
    }
  }

  async function removeEnvironment(path: string): Promise<{ clearedSessionIds: string[] }> {
    try {
      const result = await projectClient.removeEnvironment(path)
      await requireProjectSnapshot()
      return result
    } catch (cause) {
      error.value = `Failed to remove environment: ${cause}`
      throw cause
    }
  }

  async function openDirectory(path: string): Promise<void> {
    try {
      await projectClient.openDirectory(path)
    } catch (cause) {
      error.value = `Failed to open directory: ${cause}`
      throw cause
    }
  }

  async function openFolderPicker(options: OpenFolderPickerOptions = {}): Promise<string | null> {
    let selection: Awaited<ReturnType<typeof projectClient.selectDirectoryWithVersion>>
    try {
      selection = await projectClient.selectDirectoryWithVersion()
    } catch (cause) {
      error.value = `Failed to open folder picker: ${cause}`
      throw cause
    }

    const selectedPath = selection.path
    if (!selectedPath) {
      return null
    }

    const shouldSelect = options.select !== false
    const previousSelectedProjectPath = selectedProjectPath.value
    const previousSelectionSource = selectionSource.value
    if (shouldSelect) {
      selectProject(selectedPath, 'manual')
    }

    try {
      await requireProjectSnapshot(selection.version)
      const selectedPathIdentity = normalizeWorkspacePath(selectedPath)
      if (
        !environments.value.some(
          (environment) => normalizeWorkspacePath(environment.path) === selectedPathIdentity
        )
      ) {
        error.value = 'Selected workspace is missing from the project snapshot'
        throw new Error(error.value)
      }
      return selectedPath
    } catch (cause) {
      if (shouldSelect) {
        selectedProjectPath.value = previousSelectedProjectPath
        selectionSource.value = previousSelectionSource
        projects.value = reconcileProjects(projects.value)
      }
      throw cause
    }
  }

  // Compatibility aliases keep callers on the single snapshot owner.
  const fetchProjects = refreshProjectSnapshot
  const fetchEnvironments = refreshProjectSnapshot
  const loadDefaultProjectPath = refreshProjectSnapshot
  const refreshEnvironmentData = refreshProjectSnapshot

  return {
    projects,
    environments,
    archivedEnvironments,
    removedEnvironments,
    selectedProjectPath,
    defaultProjectPath,
    defaultChatWorkspacePath,
    snapshotReady,
    selectionSource,
    error,
    selectedProject,
    fetchProjects,
    fetchEnvironments,
    loadDefaultProjectPath,
    applyBootstrapDefaultProjectPath,
    refreshEnvironmentData,
    refreshProjectSnapshot,
    selectProject,
    setDefaultProject,
    clearDefaultProject: () => setDefaultProject(null),
    reorderEnvironments,
    archiveEnvironment,
    restoreEnvironment,
    removeEnvironment,
    openDirectory,
    openFolderPicker
  }
})
