import { app, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import type { IDevicePresenter } from '@shared/presenter'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { EnvironmentSummary, Project } from '@shared/types/agent-interface'

export class ProjectPresenter {
  private sqlitePresenter: SQLitePresenter
  private devicePresenter: IDevicePresenter
  private readonly tempRoot: string
  private readonly userDataWorkspacesRoot: string
  private readonly appDataRoot: string

  constructor(sqlitePresenter: SQLitePresenter, devicePresenter: IDevicePresenter) {
    this.sqlitePresenter = sqlitePresenter
    this.devicePresenter = devicePresenter
    this.tempRoot = path.resolve(app.getPath('temp'))
    this.userDataWorkspacesRoot = path.resolve(path.join(app.getPath('userData'), 'workspaces'))
    this.appDataRoot = path.resolve(app.getPath('appData'))
  }

  async getProjects(): Promise<Project[]> {
    const rows = this.sqlitePresenter.newProjectsTable.getAll()
    return rows.map((row) => ({
      path: row.path,
      name: row.name,
      icon: row.icon,
      lastAccessedAt: row.last_accessed_at
    }))
  }

  async getRecentProjects(limit: number = 10): Promise<Project[]> {
    const rows = this.sqlitePresenter.newProjectsTable.getRecent(limit)
    return rows.map((row) => ({
      path: row.path,
      name: row.name,
      icon: row.icon,
      lastAccessedAt: row.last_accessed_at
    }))
  }

  async getEnvironments(): Promise<EnvironmentSummary[]> {
    const rows = this.sqlitePresenter.newEnvironmentsTable.list()
    return rows.map((row) => ({
      path: row.path,
      name: path.basename(row.path) || row.path,
      sessionCount: row.session_count,
      lastUsedAt: row.last_used_at,
      isTemp: this.isTempPath(row.path),
      exists: fs.existsSync(row.path)
    }))
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
    return dirPath
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
