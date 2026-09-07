import {
  configGetDefaultProjectPathRoute,
  configSetDefaultProjectPathRoute,
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
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import type { ProjectService } from './index'

type ProjectRouteService = Pick<
  ProjectService,
  | 'getRecentProjects'
  | 'getSnapshot'
  | 'getSnapshotVersion'
  | 'getEnvironments'
  | 'reorderEnvironments'
  | 'archiveEnvironment'
  | 'restoreEnvironment'
  | 'removeEnvironment'
  | 'openDirectory'
  | 'pathExists'
  | 'selectDirectory'
  | 'getDefaultProjectPath'
  | 'setDefaultProjectPath'
>

export function createProjectRoutes(deps: {
  projectService: ProjectRouteService
  publishEnvironmentsChanged(
    action: 'reorder' | 'archive' | 'restore' | 'remove' | 'select',
    path: string | null,
    version: number
  ): void
}): DeepchatRouteMap {
  const { projectService, publishEnvironmentsChanged } = deps
  return createRouteMap([
    [
      configGetDefaultProjectPathRoute.name,
      async (rawInput) => {
        configGetDefaultProjectPathRoute.input.parse(rawInput)
        return configGetDefaultProjectPathRoute.output.parse({
          path: deps.projectService.getDefaultProjectPath()
        })
      }
    ],
    [
      configSetDefaultProjectPathRoute.name,
      async (rawInput) => {
        const input = configSetDefaultProjectPathRoute.input.parse(rawInput)
        deps.projectService.setDefaultProjectPath(input.path)
        return configSetDefaultProjectPathRoute.output.parse({
          path: deps.projectService.getDefaultProjectPath()
        })
      }
    ],
    [
      projectGetSnapshotRoute.name,
      async (rawInput) => {
        projectGetSnapshotRoute.input.parse(rawInput)
        return projectGetSnapshotRoute.output.parse(await projectService.getSnapshot(20))
      }
    ],
    [
      projectListRecentRoute.name,
      async (rawInput) => {
        const input = projectListRecentRoute.input.parse(rawInput)
        return projectListRecentRoute.output.parse({
          projects: await projectService.getRecentProjects(input.limit ?? 20)
        })
      }
    ],
    [
      projectListEnvironmentsRoute.name,
      async (rawInput) => {
        const input = projectListEnvironmentsRoute.input.parse(rawInput)
        return projectListEnvironmentsRoute.output.parse({
          environments: await projectService.getEnvironments({ status: input.status })
        })
      }
    ],
    [
      projectReorderEnvironmentsRoute.name,
      async (rawInput) => {
        const input = projectReorderEnvironmentsRoute.input.parse(rawInput)
        await projectService.reorderEnvironments(input.paths)
        publishEnvironmentsChanged('reorder', null, projectService.getSnapshotVersion())
        return projectReorderEnvironmentsRoute.output.parse({ updated: true })
      }
    ],
    [
      projectArchiveEnvironmentRoute.name,
      async (rawInput) => {
        const input = projectArchiveEnvironmentRoute.input.parse(rawInput)
        const version = await projectService.archiveEnvironment(input.path)
        publishEnvironmentsChanged('archive', input.path, version)
        return projectArchiveEnvironmentRoute.output.parse({ updated: true, version })
      }
    ],
    [
      projectRestoreEnvironmentRoute.name,
      async (rawInput) => {
        const input = projectRestoreEnvironmentRoute.input.parse(rawInput)
        await projectService.restoreEnvironment(input.path)
        publishEnvironmentsChanged('restore', input.path, projectService.getSnapshotVersion())
        return projectRestoreEnvironmentRoute.output.parse({ updated: true })
      }
    ],
    [
      projectRemoveEnvironmentRoute.name,
      async (rawInput) => {
        const input = projectRemoveEnvironmentRoute.input.parse(rawInput)
        const result = await projectService.removeEnvironment(input.path)
        publishEnvironmentsChanged('remove', input.path, projectService.getSnapshotVersion())
        return projectRemoveEnvironmentRoute.output.parse({
          clearedSessionIds: result.clearedSessionIds
        })
      }
    ],
    [
      projectOpenDirectoryRoute.name,
      async (rawInput) => {
        const input = projectOpenDirectoryRoute.input.parse(rawInput)
        await projectService.openDirectory(input.path)
        return projectOpenDirectoryRoute.output.parse({ opened: true })
      }
    ],
    [
      projectPathExistsRoute.name,
      async (rawInput) => {
        const input = projectPathExistsRoute.input.parse(rawInput)
        return projectPathExistsRoute.output.parse({
          exists: await projectService.pathExists(input.path)
        })
      }
    ],
    [
      projectSelectDirectoryRoute.name,
      async (rawInput) => {
        projectSelectDirectoryRoute.input.parse(rawInput)
        const result = await projectService.selectDirectory()
        if (result.path) {
          publishEnvironmentsChanged('select', result.path, result.version)
        }
        return projectSelectDirectoryRoute.output.parse(result)
      }
    ]
  ])
}
