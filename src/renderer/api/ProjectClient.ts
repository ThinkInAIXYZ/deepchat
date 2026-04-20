import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  projectListEnvironmentsRoute,
  projectListRecentRoute,
  projectOpenDirectoryRoute,
  projectSelectDirectoryRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export class ProjectClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async listRecent(limit: number = 20) {
    const result = await this.bridge.invoke(projectListRecentRoute.name, { limit })
    return result.projects
  }

  async listEnvironments() {
    const result = await this.bridge.invoke(projectListEnvironmentsRoute.name, {})
    return result.environments
  }

  async openDirectory(path: string) {
    return await this.bridge.invoke(projectOpenDirectoryRoute.name, { path })
  }

  async selectDirectory() {
    const result = await this.bridge.invoke(projectSelectDirectoryRoute.name, {})
    return result.path
  }
}
