import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  projectListEnvironmentsRoute,
  projectListRecentRoute,
  projectOpenDirectoryRoute,
  projectSelectDirectoryRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createProjectClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function listRecent(limit: number = 20) {
    const result = await bridge.invoke(projectListRecentRoute.name, { limit })
    return result.projects
  }

  async function listEnvironments() {
    const result = await bridge.invoke(projectListEnvironmentsRoute.name, {})
    return result.environments
  }

  async function openDirectory(path: string) {
    return await bridge.invoke(projectOpenDirectoryRoute.name, { path })
  }

  async function selectDirectory() {
    const result = await bridge.invoke(projectSelectDirectoryRoute.name, {})
    return result.path
  }

  return {
    listRecent,
    listEnvironments,
    openDirectory,
    selectDirectory
  }
}

export type ProjectClient = ReturnType<typeof createProjectClient>
