import type { FileServicePort } from '@shared/types/file'
import {
  fileCopyImageRoute,
  fileGetMimeTypeRoute,
  fileIsDirectoryRoute,
  filePrepareDirectoryRoute,
  filePrepareFileRoute,
  fileReadFileRoute,
  fileSaveImageRoute,
  fileWriteImageBase64Route
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export function createFileRoutes(fileService: FileServicePort): DeepchatRouteMap {
  return createRouteMap([
    [
      fileGetMimeTypeRoute.name,
      async (rawInput) => {
        const input = fileGetMimeTypeRoute.input.parse(rawInput)
        return fileGetMimeTypeRoute.output.parse({
          mimeType: await fileService.getMimeType(input.path)
        })
      }
    ],
    [
      filePrepareFileRoute.name,
      async (rawInput) => {
        const input = filePrepareFileRoute.input.parse(rawInput)
        return filePrepareFileRoute.output.parse({
          file: await fileService.prepareFile(input.path, input.mimeType)
        })
      }
    ],
    [
      filePrepareDirectoryRoute.name,
      async (rawInput) => {
        const input = filePrepareDirectoryRoute.input.parse(rawInput)
        return filePrepareDirectoryRoute.output.parse({
          file: await fileService.prepareDirectory(input.path)
        })
      }
    ],
    [
      fileReadFileRoute.name,
      async (rawInput) => {
        const input = fileReadFileRoute.input.parse(rawInput)
        return fileReadFileRoute.output.parse({ content: await fileService.readFile(input.path) })
      }
    ],
    [
      fileIsDirectoryRoute.name,
      async (rawInput) => {
        const input = fileIsDirectoryRoute.input.parse(rawInput)
        return fileIsDirectoryRoute.output.parse({
          isDirectory: await fileService.isDirectory(input.path)
        })
      }
    ],
    [
      fileWriteImageBase64Route.name,
      async (rawInput) => {
        const input = fileWriteImageBase64Route.input.parse(rawInput)
        return fileWriteImageBase64Route.output.parse({
          path: await fileService.writeImageBase64(input)
        })
      }
    ],
    [
      fileSaveImageRoute.name,
      async (rawInput) => {
        const input = fileSaveImageRoute.input.parse(rawInput)
        return fileSaveImageRoute.output.parse(await fileService.saveImage(input))
      }
    ],
    [
      fileCopyImageRoute.name,
      async (rawInput) => {
        const input = fileCopyImageRoute.input.parse(rawInput)
        return fileCopyImageRoute.output.parse(await fileService.copyImage(input))
      }
    ]
  ])
}
