import { app, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import type { DeviceServicePort } from '@shared/types/device'
import type { SessionDatabase } from '@/session/data/database'
import type { ProjectDatabase } from './data/database'
import type { EnvironmentStatus, EnvironmentSummary, Project } from '@shared/types/agent-interface'
import {
  DEFAULT_ENVIRONMENT_SORT_ORDER,
  type NewEnvironmentPreferenceRow
} from '@/project/data/tables/newEnvironmentPreferences'
import type { NewEnvironmentRow } from '@/project/data/tables/newEnvironments'
import type { SettingsStore } from '@/config/settingsStore'

const PROJECT_SNAPSHOT_VERSION_SETTINGS_KEY = 'projectSnapshotVersion'

export class ProjectService {
  private sqlitePresenter: ProjectDatabase
  private sessionDatabase: SessionDatabase
  private deviceService: DeviceServicePort
  private settings: SettingsStore
  private readonly tempRoot: string
  private readonly userDataWorkspacesRoot: string
  private readonly appDataRoot: string
  private snapshotVersion: number

  constructor(
    sqlitePresenter: ProjectDatabase,
    sessionDatabase: SessionDatabase,
    deviceService: DeviceServicePort,
    settings: SettingsStore,
    private readonly publishDefaultProjectPathChanged: (
      path: string | null,
      version: number
    ) => void,
    private readonly publishEnvironmentsChanged: (
      action: 'reorder' | 'archive' | 'restore' | 'remove' | 'select',
      path: string | null,
      version: number
    ) => void = () => undefined
  ) {
    this.sqlitePresenter = sqlitePresenter
    this.sessionDatabase = sessionDatabase
    this.deviceService = deviceService
    this.settings = settings
    this.tempRoot = path.resolve(app.getPath('temp'))
    this.userDataWorkspacesRoot = path.resolve(path.join(app.getPath('userData'), 'workspaces'))
    this.appDataRoot = path.resolve(app.getPath('appData'))
    this.snapshotVersion = this.readSnapshotVersion()
  }

  async getProjects(): Promise<Project[]> {
    const rows = this.sqlitePresenter.newProjectsTable.getAll()
    return rows
      .filter((row) => !this.isRemovedEnvironment(row.path))
      .map((row) => ({
        path: row.path,
        name: row.name,
        icon: row.icon,
        lastAccessedAt: row.last_accessed_at,
        exists: fs.existsSync(row.path)
      }))
  }

  async getRecentProjects(limit: number = 10): Promise<Project[]> {
    const rows = this.sqlitePresenter.newProjectsTable.getAll()
    return rows
      .filter((row) => !this.isRemovedEnvironment(row.path))
      .slice(0, limit)
      .map((row) => ({
        path: row.path,
        name: row.name,
        icon: row.icon,
        lastAccessedAt: row.last_accessed_at,
        exists: fs.existsSync(row.path)
      }))
  }

  async getEnvironments(options?: { status?: EnvironmentStatus }): Promise<EnvironmentSummary[]> {
    const status = options?.status ?? 'active'
    const rows = this.sqlitePresenter.newEnvironmentsTable.list()
    const preferences = this.sqlitePresenter.newEnvironmentPreferencesTable.list()
    const usageByPath = new Map(rows.map((row) => [row.path, row]))
    const preferenceByPath = new Map(preferences.map((row) => [row.path, row]))
    const paths = new Set<string>(rows.map((row) => row.path))

    for (const preference of preferences) {
      if (preference.status === status || preference.status !== 'removed') {
        paths.add(preference.path)
      }
    }

    return Array.from(paths)
      .map((environmentPath) =>
        this.createEnvironmentSummary(
          environmentPath,
          usageByPath.get(environmentPath),
          preferenceByPath.get(environmentPath)
        )
      )
      .filter((environment) => environment.status === status)
      .sort((left, right) => this.compareEnvironmentSummaries(left, right, status))
  }

  async getSnapshot(limit: number = 20): Promise<{
    version: number
    projects: Project[]
    environments: EnvironmentSummary[]
    archivedEnvironments: EnvironmentSummary[]
    removedEnvironments: EnvironmentSummary[]
    defaultProjectPath: string | null
    defaultChatWorkspacePath: string | null
  }> {
    // All reads are synchronous SQLite/settings reads in this process. Keep them in
    // one uninterrupted turn and stamp the resulting projection with its version.
    const version = this.snapshotVersion
    const rows = this.sqlitePresenter.newProjectsTable
      .getAll()
      .filter((row) => !this.isRemovedEnvironment(row.path))
      .slice(0, limit)
    const projects = rows.map((row) => ({
      path: row.path,
      name: row.name,
      icon: row.icon,
      lastAccessedAt: row.last_accessed_at,
      exists: fs.existsSync(row.path)
    }))
    const environmentRows = this.sqlitePresenter.newEnvironmentsTable.list()
    const preferences = this.sqlitePresenter.newEnvironmentPreferencesTable.list()
    const usageByPath = new Map(environmentRows.map((row) => [row.path, row]))
    const preferenceByPath = new Map(preferences.map((row) => [row.path, row]))
    const paths = new Set<string>(environmentRows.map((row) => row.path))
    for (const preference of preferences) {
      paths.add(preference.path)
    }
    const allEnvironments = Array.from(paths).map((environmentPath) =>
      this.createEnvironmentSummary(
        environmentPath,
        usageByPath.get(environmentPath),
        preferenceByPath.get(environmentPath)
      )
    )
    const byStatus = (status: EnvironmentStatus) =>
      allEnvironments
        .filter((environment) => environment.status === status)
        .sort((left, right) => this.compareEnvironmentSummaries(left, right, status))

    return {
      version,
      projects,
      environments: byStatus('active'),
      archivedEnvironments: byStatus('archived'),
      removedEnvironments: byStatus('removed'),
      defaultProjectPath: this.getDefaultProjectPath(),
      defaultChatWorkspacePath: this.getDefaultChatWorkspacePath()
    }
  }

  async reorderEnvironments(paths: string[]): Promise<void> {
    const activePathSet = new Set(
      (await this.getEnvironments({ status: 'active' })).map((environment) => environment.path)
    )
    const activePaths = this.normalizeUniqueEnvironmentPaths(paths).filter((environmentPath) =>
      activePathSet.has(environmentPath)
    )

    this.sqlitePresenter.newEnvironmentPreferencesTable.reorderActive(activePaths)
    this.bumpSnapshotVersion()
  }

  async archiveEnvironment(environmentPath: string): Promise<number> {
    const normalizedPath = this.normalizeEnvironmentPath(environmentPath)
    if (!normalizedPath) {
      return this.snapshotVersion
    }

    this.sqlitePresenter.newEnvironmentPreferencesTable.markArchived(normalizedPath)
    if (this.getDefaultProjectPath() === normalizedPath) {
      return this.setDefaultProjectPath(null)
    }
    return this.bumpSnapshotVersion()
  }

  async restoreEnvironment(environmentPath: string): Promise<void> {
    const normalizedPath = this.normalizeEnvironmentPath(environmentPath)
    if (!normalizedPath) {
      return
    }

    this.sqlitePresenter.newEnvironmentPreferencesTable.markActive(normalizedPath)
    this.bumpSnapshotVersion()
  }

  async removeEnvironment(environmentPath: string): Promise<{ clearedSessionIds: string[] }> {
    const normalizedPath = this.normalizeEnvironmentPath(environmentPath)
    if (!normalizedPath) {
      return { clearedSessionIds: [] }
    }

    const clearedSessionIds = this.sqlitePresenter.getDatabase().transaction(() => {
      const sessionIds = this.sessionDatabase.newSessionsTable.clearProjectDir(normalizedPath)
      this.sqlitePresenter.newProjectsTable.delete(normalizedPath)
      this.sqlitePresenter.newEnvironmentPreferencesTable.markRemoved(normalizedPath)
      this.sqlitePresenter.newEnvironmentsTable.syncPath(normalizedPath)
      return sessionIds
    })()

    if (this.getDefaultProjectPath() === normalizedPath) {
      this.setDefaultProjectPath(null)
      return { clearedSessionIds }
    }

    this.bumpSnapshotVersion()
    return { clearedSessionIds }
  }

  async pathExists(targetPath: string): Promise<boolean> {
    const normalizedPath = targetPath?.trim()
    if (!normalizedPath) {
      return false
    }

    return fs.existsSync(normalizedPath)
  }

  async openDirectory(dirPath: string): Promise<void> {
    const normalizedPath = dirPath?.trim()
    if (!normalizedPath) {
      return
    }

    const errorMessage = await shell.openPath(normalizedPath)
    if (errorMessage) {
      throw new Error(errorMessage)
    }
  }

  getSnapshotVersion(): number {
    return this.snapshotVersion
  }

  notifyEnvironmentProjectionChanged(): number {
    const version = this.bumpSnapshotVersion()
    this.publishEnvironmentsChanged('select', null, version)
    return version
  }

  async selectDirectory(): Promise<{ path: string | null; version: number }> {
    const result = await this.deviceService.selectDirectory()
    if (result.canceled || result.filePaths.length === 0) {
      return { path: null, version: this.snapshotVersion }
    }

    const dirPath = this.normalizeEnvironmentPath(result.filePaths[0])
    if (!dirPath) {
      return { path: null, version: this.snapshotVersion }
    }

    const dirName = path.basename(dirPath) || dirPath
    this.sqlitePresenter.getDatabase().transaction(() => {
      this.sqlitePresenter.newProjectsTable.upsert(dirPath, dirName)
      this.sqlitePresenter.newEnvironmentPreferencesTable.activateAtTop(dirPath)
    })()
    const version = this.bumpSnapshotVersion()
    return { path: dirPath, version }
  }

  async ensureDefaultWorkspace(): Promise<string | null> {
    const candidates = this.getDefaultWorkspaceCandidates()
    const currentDefault = this.getDefaultProjectPath()
    const currentDefaultIsBuiltin = Boolean(
      currentDefault && this.isDefaultWorkspaceCandidate(currentDefault, candidates)
    )

    if (currentDefault && !currentDefaultIsBuiltin) {
      return null
    }

    if (!currentDefault && this.hasExistingWorkspaceHistory()) {
      return null
    }

    const defaultPath = this.createFirstAvailableDefaultWorkspace(
      currentDefaultIsBuiltin && currentDefault ? [currentDefault, ...candidates] : candidates
    )
    if (!defaultPath) {
      return null
    }

    this.sqlitePresenter.newProjectsTable.upsert(defaultPath, 'DeepChat')
    this.sqlitePresenter.newEnvironmentPreferencesTable.markActive(defaultPath)

    if (currentDefault !== defaultPath) {
      this.setDefaultProjectPath(defaultPath)
    } else {
      this.bumpSnapshotVersion()
    }

    return defaultPath
  }

  getDefaultProjectPath(): string | null {
    const projectPath = this.settings.get<string | null>('defaultProjectPath')
    return projectPath?.trim() || null
  }

  getDefaultChatWorkspacePath(): string | null {
    const projectPath = this.getDefaultProjectPath()
    if (!projectPath) {
      return null
    }

    return this.isDefaultWorkspaceCandidate(projectPath, this.getDefaultWorkspaceCandidates())
      ? projectPath
      : null
  }

  setDefaultProjectPath(projectPath: string | null): number {
    const normalized = projectPath?.trim() || null
    this.settings.set('defaultProjectPath', normalized)
    const version = this.bumpSnapshotVersion()
    this.publishDefaultProjectPathChanged(normalized, version)
    return version
  }

  private bumpSnapshotVersion(): number {
    this.snapshotVersion += 1
    this.settings.set(PROJECT_SNAPSHOT_VERSION_SETTINGS_KEY, this.snapshotVersion)
    return this.snapshotVersion
  }

  private readSnapshotVersion(): number {
    const value = this.settings.get<unknown>(PROJECT_SNAPSHOT_VERSION_SETTINGS_KEY)
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
  }

  private createEnvironmentSummary(
    environmentPath: string,
    usage: NewEnvironmentRow | undefined,
    preference: NewEnvironmentPreferenceRow | undefined
  ): EnvironmentSummary {
    return {
      path: environmentPath,
      name: path.basename(environmentPath) || environmentPath,
      sessionCount: usage?.session_count ?? 0,
      lastUsedAt: usage?.last_used_at ?? preference?.updated_at ?? 0,
      isTemp: this.isTempPath(environmentPath),
      exists: fs.existsSync(environmentPath),
      status: preference?.status ?? 'active',
      sortOrder: preference?.sort_order ?? DEFAULT_ENVIRONMENT_SORT_ORDER,
      archivedAt: preference?.archived_at ?? null,
      removedAt: preference?.removed_at ?? null
    }
  }

  private compareEnvironmentSummaries(
    left: EnvironmentSummary,
    right: EnvironmentSummary,
    status: EnvironmentStatus
  ): number {
    if (status === 'active') {
      const leftHasExplicitOrder = left.sortOrder < DEFAULT_ENVIRONMENT_SORT_ORDER
      const rightHasExplicitOrder = right.sortOrder < DEFAULT_ENVIRONMENT_SORT_ORDER

      if (leftHasExplicitOrder !== rightHasExplicitOrder) {
        return leftHasExplicitOrder ? -1 : 1
      }

      if (leftHasExplicitOrder && left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder
      }

      if (left.lastUsedAt !== right.lastUsedAt) {
        return right.lastUsedAt - left.lastUsedAt
      }

      return left.path.localeCompare(right.path)
    }

    if (status === 'archived') {
      const leftArchivedAt = left.archivedAt ?? left.lastUsedAt
      const rightArchivedAt = right.archivedAt ?? right.lastUsedAt
      if (leftArchivedAt !== rightArchivedAt) {
        return rightArchivedAt - leftArchivedAt
      }
    }

    if (status === 'removed') {
      const leftRemovedAt = left.removedAt ?? left.lastUsedAt
      const rightRemovedAt = right.removedAt ?? right.lastUsedAt
      if (leftRemovedAt !== rightRemovedAt) {
        return rightRemovedAt - leftRemovedAt
      }
    }

    return left.path.localeCompare(right.path)
  }

  private isRemovedEnvironment(environmentPath: string): boolean {
    return (
      this.sqlitePresenter.newEnvironmentPreferencesTable.get(environmentPath)?.status === 'removed'
    )
  }

  private normalizeEnvironmentPath(environmentPath: string | null | undefined): string | null {
    const normalizedPath = environmentPath?.trim()
    return normalizedPath || null
  }

  private normalizeUniqueEnvironmentPaths(environmentPaths: string[]): string[] {
    const seen = new Set<string>()
    const normalizedPaths: string[] = []

    for (const environmentPath of environmentPaths) {
      const normalizedPath = this.normalizeEnvironmentPath(environmentPath)
      if (!normalizedPath || seen.has(normalizedPath)) {
        continue
      }

      seen.add(normalizedPath)
      normalizedPaths.push(normalizedPath)
    }

    return normalizedPaths
  }

  private getDefaultWorkspaceCandidates(): string[] {
    const candidates: string[] = []
    const addCandidate = (basePath: string) => {
      candidates.push(path.resolve(path.join(basePath, 'DeepChat')))
    }

    try {
      addCandidate(app.getPath('documents'))
    } catch (error) {
      console.warn('[ProjectService] Failed to resolve Documents path:', error)
    }

    try {
      addCandidate(app.getPath('home'))
    } catch (error) {
      console.warn('[ProjectService] Failed to resolve Home path:', error)
    }

    candidates.push(path.resolve(path.join(this.userDataWorkspacesRoot, 'DeepChat')))
    return this.normalizeUniqueEnvironmentPaths(candidates)
  }

  private isDefaultWorkspaceCandidate(workspacePath: string, candidates: string[]): boolean {
    const normalizedPath = path.resolve(workspacePath)
    return candidates.some((candidate) => path.resolve(candidate) === normalizedPath)
  }

  private hasExistingWorkspaceHistory(): boolean {
    const hasProject = this.sqlitePresenter.newProjectsTable
      .getAll()
      .some((project) => !this.isRemovedEnvironment(project.path))
    if (hasProject) {
      return true
    }

    const hasEnvironment = this.sqlitePresenter.newEnvironmentsTable
      .list()
      .some((environment) => !this.isRemovedEnvironment(environment.path))
    if (hasEnvironment) {
      return true
    }

    return this.sqlitePresenter.newEnvironmentPreferencesTable.list().length > 0
  }

  private createFirstAvailableDefaultWorkspace(candidates: string[]): string | null {
    for (const candidate of this.normalizeUniqueEnvironmentPaths(candidates)) {
      try {
        fs.mkdirSync(candidate, { recursive: true })
        return candidate
      } catch (error) {
        console.warn(`[ProjectService] Failed to create default workspace at ${candidate}:`, error)
      }
    }

    return null
  }

  private isTempPath(projectPath: string): boolean {
    const normalized = projectPath?.trim()
    if (!normalized) {
      return false
    }

    const resolvedPath = path.resolve(normalized)
    return (
      this.isWithinRoot(resolvedPath, this.tempRoot) ||
      this.isWithinRoot(resolvedPath, this.userDataWorkspacesRoot) ||
      this.isAppManagedWorkspacePath(resolvedPath)
    )
  }

  private isWithinRoot(targetPath: string, rootPath: string): boolean {
    const relative = path.relative(rootPath, targetPath)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  private isAppManagedWorkspacePath(targetPath: string): boolean {
    const workspaceMarker = `${path.sep}workspaces`
    const markerIndex = targetPath.indexOf(workspaceMarker)
    if (markerIndex < 0) {
      return false
    }

    const appContainerPath = targetPath.slice(0, markerIndex)
    if (!appContainerPath) {
      return false
    }

    return this.isWithinRoot(appContainerPath, this.appDataRoot)
  }
}
