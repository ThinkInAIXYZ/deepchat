import { app, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import type { IConfigPresenter, IDevicePresenter } from '@shared/presenter'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { EnvironmentStatus, EnvironmentSummary, Project } from '@shared/types/agent-interface'
import {
  DEFAULT_ENVIRONMENT_SORT_ORDER,
  type NewEnvironmentPreferenceRow
} from '../sqlitePresenter/tables/newEnvironmentPreferences'
import type { NewEnvironmentRow } from '../sqlitePresenter/tables/newEnvironments'

export class ProjectPresenter {
  private sqlitePresenter: SQLitePresenter
  private devicePresenter: IDevicePresenter
  private configPresenter?: IConfigPresenter
  private readonly tempRoot: string
  private readonly userDataWorkspacesRoot: string
  private readonly appDataRoot: string

  constructor(
    sqlitePresenter: SQLitePresenter,
    devicePresenter: IDevicePresenter,
    configPresenter?: IConfigPresenter
  ) {
    this.sqlitePresenter = sqlitePresenter
    this.devicePresenter = devicePresenter
    this.configPresenter = configPresenter
    this.tempRoot = path.resolve(app.getPath('temp'))
    this.userDataWorkspacesRoot = path.resolve(path.join(app.getPath('userData'), 'workspaces'))
    this.appDataRoot = path.resolve(app.getPath('appData'))
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

  async reorderEnvironments(paths: string[]): Promise<void> {
    const activePathSet = new Set(
      (await this.getEnvironments({ status: 'active' })).map((environment) => environment.path)
    )
    const activePaths = this.normalizeUniqueEnvironmentPaths(paths).filter((environmentPath) =>
      activePathSet.has(environmentPath)
    )

    this.sqlitePresenter.newEnvironmentPreferencesTable.reorderActive(activePaths)
  }

  async archiveEnvironment(environmentPath: string): Promise<void> {
    const normalizedPath = this.normalizeEnvironmentPath(environmentPath)
    if (!normalizedPath) {
      return
    }

    this.sqlitePresenter.newEnvironmentPreferencesTable.markArchived(normalizedPath)
    if (this.configPresenter?.getDefaultProjectPath()?.trim() === normalizedPath) {
      this.configPresenter.setDefaultProjectPath(null)
    }
  }

  async restoreEnvironment(environmentPath: string): Promise<void> {
    const normalizedPath = this.normalizeEnvironmentPath(environmentPath)
    if (!normalizedPath) {
      return
    }

    this.sqlitePresenter.newEnvironmentPreferencesTable.markActive(normalizedPath)
  }

  async removeEnvironment(environmentPath: string): Promise<{ clearedSessionIds: string[] }> {
    const normalizedPath = this.normalizeEnvironmentPath(environmentPath)
    if (!normalizedPath) {
      return { clearedSessionIds: [] }
    }

    const clearedSessionIds = this.sqlitePresenter.getDatabase().transaction(() => {
      const sessionIds = this.sqlitePresenter.newSessionsTable.clearProjectDir(normalizedPath)
      this.sqlitePresenter.newProjectsTable.delete(normalizedPath)
      this.sqlitePresenter.newEnvironmentPreferencesTable.markRemoved(normalizedPath)
      this.sqlitePresenter.newEnvironmentsTable.syncPath(normalizedPath)
      return sessionIds
    })()

    if (this.configPresenter?.getDefaultProjectPath()?.trim() === normalizedPath) {
      this.configPresenter.setDefaultProjectPath(null)
    }

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

  async selectDirectory(): Promise<string | null> {
    const result = await this.devicePresenter.selectDirectory()
    if (result.canceled || result.filePaths.length === 0) return null

    const dirPath = result.filePaths[0]
    const dirName = path.basename(dirPath)

    this.sqlitePresenter.newProjectsTable.upsert(dirPath, dirName)
    this.sqlitePresenter.newEnvironmentPreferencesTable.markActive(dirPath)
    return dirPath
  }

  async ensureDefaultWorkspace(): Promise<string | null> {
    if (!this.configPresenter) {
      return null
    }

    const candidates = this.getDefaultWorkspaceCandidates()
    const currentDefault = this.configPresenter.getDefaultProjectPath()
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
      this.configPresenter.setDefaultProjectPath(defaultPath)
    }

    return defaultPath
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
      console.warn('[ProjectPresenter] Failed to resolve Documents path:', error)
    }

    try {
      addCandidate(app.getPath('home'))
    } catch (error) {
      console.warn('[ProjectPresenter] Failed to resolve Home path:', error)
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
        console.warn(
          `[ProjectPresenter] Failed to create default workspace at ${candidate}:`,
          error
        )
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
