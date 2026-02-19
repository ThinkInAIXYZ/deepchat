import type { Project } from '../agent-interface'

export interface IProjectPresenter {
  getProjects(): Promise<Project[]>
  getRecentProjects(limit?: number): Promise<Project[]>
  selectDirectory(): Promise<string | null>
}
