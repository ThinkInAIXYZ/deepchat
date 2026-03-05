import path from 'path'
import type { IDevicePresenter } from '@shared/presenter'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { Project } from '@shared/types/agent-interface'

export class ProjectPresenter {
  private sqlitePresenter: SQLitePresenter
  private devicePresenter: IDevicePresenter

  constructor(sqlitePresenter: SQLitePresenter, devicePresenter: IDevicePresenter) {
    this.sqlitePresenter = sqlitePresenter
    this.devicePresenter = devicePresenter
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

  async selectDirectory(): Promise<string | null> {
    const result = await this.devicePresenter.selectDirectory()
    if (result.canceled || result.filePaths.length === 0) return null

    const dirPath = result.filePaths[0]
    const dirName = path.basename(dirPath)

    this.sqlitePresenter.newProjectsTable.upsert(dirPath, dirName)
    return dirPath
  }
}
