import type { EnvironmentStatus, EnvironmentSummary, Project } from '../agent-interface'

export interface IProjectPresenter {
  ensureDefaultWorkspace(): Promise<string | null>
  getProjects(): Promise<Project[]>
  getRecentProjects(limit?: number): Promise<Project[]>
  getEnvironments(options?: { status?: EnvironmentStatus }): Promise<EnvironmentSummary[]>
  reorderEnvironments(paths: string[]): Promise<void>
  archiveEnvironment(path: string): Promise<void>
  restoreEnvironment(path: string): Promise<void>
  removeEnvironment(path: string): Promise<{ clearedSessionIds: string[] }>
  pathExists(path: string): Promise<boolean>
  openDirectory(path: string): Promise<void>
  selectDirectory(): Promise<string | null>
}
