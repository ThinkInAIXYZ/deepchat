import type { DeepchatBridge } from '@shared/contracts/bridge'
import { projectEnvironmentsChangedEvent } from '@shared/contracts/events'
import {
  projectArchiveEnvironmentRoute,
  projectGetSnapshotRoute,
  projectListEnvironmentsRoute,
  projectListRecentRoute,
  projectOpenDirectoryRoute,
  projectPathExistsRoute,
  projectRemoveEnvironmentRoute,
  projectReorderEnvironmentsRoute,
  projectRestoreEnvironmentRoute,
  projectSelectDirectoryRoute
} from '@shared/contracts/routes'
import type { EnvironmentStatus } from '@shared/types/agent-interface'
import { getDeepchatBridge } from './core'

export function createProjectClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getSnapshot() {
    return await bridge.invoke(projectGetSnapshotRoute.name, {})
  }

  async function listRecent(limit: number = 20) {
    const result = await bridge.invoke(projectListRecentRoute.name, { limit })
    return result.projects
  }

  async function listEnvironments(status?: EnvironmentStatus) {
    const result = await bridge.invoke(projectListEnvironmentsRoute.name, { status })
    return result.environments
  }

  async function reorderEnvironments(paths: string[]) {
    return await bridge.invoke(projectReorderEnvironmentsRoute.name, { paths })
  }

  async function archiveEnvironment(path: string) {
    return await bridge.invoke(projectArchiveEnvironmentRoute.name, { path })
  }

  async function restoreEnvironment(path: string) {
    return await bridge.invoke(projectRestoreEnvironmentRoute.name, { path })
  }

  async function removeEnvironment(path: string) {
    return await bridge.invoke(projectRemoveEnvironmentRoute.name, { path })
  }

  async function openDirectory(path: string) {
    return await bridge.invoke(projectOpenDirectoryRoute.name, { path })
  }

  async function pathExists(path: string) {
    const result = await bridge.invoke(projectPathExistsRoute.name, { path })
    return result.exists
  }

  async function selectDirectoryWithVersion() {
    return await bridge.invoke(projectSelectDirectoryRoute.name, {})
  }

  async function selectDirectory() {
    const result = await selectDirectoryWithVersion()
    return result.path
  }

  function onEnvironmentsChanged(
    listener: (payload: {
      action: 'reorder' | 'archive' | 'restore' | 'remove' | 'select'
      path: string | null
      version: number
    }) => void
  ) {
    return bridge.on(projectEnvironmentsChangedEvent.name, listener)
  }

  return {
    getSnapshot,
    listRecent,
    listEnvironments,
    reorderEnvironments,
    archiveEnvironment,
    restoreEnvironment,
    removeEnvironment,
    openDirectory,
    pathExists,
    selectDirectoryWithVersion,
    selectDirectory,
    onEnvironmentsChanged
  }
}

export type ProjectClient = ReturnType<typeof createProjectClient>
