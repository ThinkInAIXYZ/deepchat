import type { EnvironmentSummary, Project } from '../agent-interface'

export interface IProjectPresenter {
  getProjects(): Promise<Project[]>
  getRecentProjects(limit?: number): Promise<Project[]>
  getEnvironments(): Promise<EnvironmentSummary[]>
  openDirectory(path: string): Promise<void>
  selectDirectory(): Promise<string | null>
}
