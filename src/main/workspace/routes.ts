import type { WorkspaceServicePort } from '@shared/types/workspace'
import {
  workspaceExpandDirectoryRoute,
  workspaceGetGitDiffRoute,
  workspaceGetGitStatusRoute,
  workspaceOpenFileRoute,
  workspaceReadDirectoryRoute,
  workspaceReadFilePreviewRoute,
  workspaceRegisterRoute,
  workspaceResolveMarkdownLinkedFileRoute,
  workspaceRevealFileInFolderRoute,
  workspaceSearchFilesRoute,
  workspaceUnregisterRoute,
  workspaceUnwatchRoute,
  workspaceWatchRoute
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export function createWorkspaceRoutes(service: WorkspaceServicePort): DeepchatRouteMap {
  return createRouteMap([
    [
      workspaceRegisterRoute.name,
      async (rawInput) => {
        const input = workspaceRegisterRoute.input.parse(rawInput)
        await service.registerWorkspace(input.workspacePath)
        return workspaceRegisterRoute.output.parse({ registered: true })
      }
    ],
    [
      workspaceUnregisterRoute.name,
      async (rawInput) => {
        const input = workspaceUnregisterRoute.input.parse(rawInput)
        await service.unregisterWorkspace(input.workspacePath)
        return workspaceUnregisterRoute.output.parse({ unregistered: true })
      }
    ],
    [
      workspaceWatchRoute.name,
      async (rawInput) => {
        const input = workspaceWatchRoute.input.parse(rawInput)
        await service.watchWorkspace(input.workspacePath)
        return workspaceWatchRoute.output.parse({ watching: true })
      }
    ],
    [
      workspaceUnwatchRoute.name,
      async (rawInput) => {
        const input = workspaceUnwatchRoute.input.parse(rawInput)
        await service.unwatchWorkspace(input.workspacePath)
        return workspaceUnwatchRoute.output.parse({ watching: false })
      }
    ],
    [
      workspaceReadDirectoryRoute.name,
      async (rawInput) => {
        const input = workspaceReadDirectoryRoute.input.parse(rawInput)
        return workspaceReadDirectoryRoute.output.parse({
          nodes: await service.readDirectory(input.path)
        })
      }
    ],
    [
      workspaceExpandDirectoryRoute.name,
      async (rawInput) => {
        const input = workspaceExpandDirectoryRoute.input.parse(rawInput)
        return workspaceExpandDirectoryRoute.output.parse({
          nodes: await service.expandDirectory(input.path)
        })
      }
    ],
    [
      workspaceRevealFileInFolderRoute.name,
      async (rawInput) => {
        const input = workspaceRevealFileInFolderRoute.input.parse(rawInput)
        await service.revealFileInFolder(input.path)
        return workspaceRevealFileInFolderRoute.output.parse({ revealed: true })
      }
    ],
    [
      workspaceOpenFileRoute.name,
      async (rawInput) => {
        const input = workspaceOpenFileRoute.input.parse(rawInput)
        await service.openFile(input.path)
        return workspaceOpenFileRoute.output.parse({ opened: true })
      }
    ],
    [
      workspaceReadFilePreviewRoute.name,
      async (rawInput) => {
        const input = workspaceReadFilePreviewRoute.input.parse(rawInput)
        return workspaceReadFilePreviewRoute.output.parse({
          preview: await service.readFilePreview(input.path)
        })
      }
    ],
    [
      workspaceResolveMarkdownLinkedFileRoute.name,
      async (rawInput) => {
        const input = workspaceResolveMarkdownLinkedFileRoute.input.parse(rawInput)
        return workspaceResolveMarkdownLinkedFileRoute.output.parse({
          resolution: await service.resolveMarkdownLinkedFile(input)
        })
      }
    ],
    [
      workspaceGetGitStatusRoute.name,
      async (rawInput) => {
        const input = workspaceGetGitStatusRoute.input.parse(rawInput)
        return workspaceGetGitStatusRoute.output.parse({
          state: await service.getGitStatus(input.workspacePath)
        })
      }
    ],
    [
      workspaceGetGitDiffRoute.name,
      async (rawInput) => {
        const input = workspaceGetGitDiffRoute.input.parse(rawInput)
        return workspaceGetGitDiffRoute.output.parse({
          diff: await service.getGitDiff(input.workspacePath, input.filePath)
        })
      }
    ],
    [
      workspaceSearchFilesRoute.name,
      async (rawInput) => {
        const input = workspaceSearchFilesRoute.input.parse(rawInput)
        return workspaceSearchFilesRoute.output.parse({
          nodes: await service.searchFiles(input.workspacePath, input.query)
        })
      }
    ]
  ])
}
