import {
  toolchainsCancelInstallRoute,
  toolchainsGetStatusRoute,
  toolchainsInstallRoute,
  toolchainsPickCustomRoute,
  toolchainsRepairRoute,
  toolchainsRevertRoute,
  toolchainsSetSourceRoute
} from '@shared/contracts/routes'
import type { ToolchainKind } from '@shared/types/toolchains'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import { isToolchainDownloadError, isToolchainResolutionError } from './errors'
import type { ToolchainService } from './service'

export function createToolchainRoutes(deps: {
  service: Pick<
    ToolchainService,
    'getStatus' | 'setSource' | 'install' | 'cancelInstall' | 'repair' | 'revert' | 'getState'
  >
  pickPath: () => Promise<{ canceled: boolean; filePaths: string[] }>
}): DeepchatRouteMap {
  return createRouteMap([
    [
      toolchainsGetStatusRoute.name,
      async (rawInput) => {
        toolchainsGetStatusRoute.input.parse(rawInput)
        return toolchainsGetStatusRoute.output.parse(deps.service.getStatus())
      }
    ],
    [
      toolchainsSetSourceRoute.name,
      async (rawInput) => {
        const input = toolchainsSetSourceRoute.input.parse(rawInput)
        return toolchainsSetSourceRoute.output.parse(
          deps.service.setSource(input.kind, input.selection)
        )
      }
    ],
    [
      toolchainsInstallRoute.name,
      async (rawInput) => {
        const input = toolchainsInstallRoute.input.parse(rawInput)
        try {
          return toolchainsInstallRoute.output.parse({
            status: 'ok',
            state: await deps.service.install(input.kind)
          })
        } catch (error) {
          return toolchainsInstallRoute.output.parse(
            cancelledOrThrow(error, deps.service.getState())
          )
        }
      }
    ],
    [
      toolchainsCancelInstallRoute.name,
      async (rawInput) => {
        const input = toolchainsCancelInstallRoute.input.parse(rawInput)
        return toolchainsCancelInstallRoute.output.parse({
          cancelled: deps.service.cancelInstall(input.kind)
        })
      }
    ],
    [
      toolchainsRepairRoute.name,
      async (rawInput) => {
        const input = toolchainsRepairRoute.input.parse(rawInput)
        try {
          return toolchainsRepairRoute.output.parse({
            status: 'ok',
            state: await deps.service.repair(input.kind)
          })
        } catch (error) {
          return toolchainsRepairRoute.output.parse(
            cancelledOrThrow(error, deps.service.getState())
          )
        }
      }
    ],
    [
      toolchainsRevertRoute.name,
      async (rawInput) => {
        const input = toolchainsRevertRoute.input.parse(rawInput)
        return toolchainsRevertRoute.output.parse(deps.service.revert(input.kind))
      }
    ],
    [
      toolchainsPickCustomRoute.name,
      async (rawInput) => {
        const input = toolchainsPickCustomRoute.input.parse(rawInput)
        const picked = await deps.pickPath()
        if (picked.canceled || !picked.filePaths[0]) {
          return toolchainsPickCustomRoute.output.parse({
            canceled: true,
            state: deps.service.getState()
          })
        }
        return toolchainsPickCustomRoute.output.parse({
          canceled: false,
          state: deps.service.setSource(input.kind as ToolchainKind, {
            source: 'custom',
            customPath: picked.filePaths[0]
          })
        })
      }
    ]
  ])
}

function cancelledOrThrow(
  error: unknown,
  state: ReturnType<ToolchainService['getState']>
): { status: 'cancelled'; reason: 'cancelled'; state: ReturnType<ToolchainService['getState']> } {
  if (isToolchainDownloadError(error) && error.reason === 'cancelled') {
    return { status: 'cancelled', reason: 'cancelled', state }
  }
  throw toRouteError(error)
}

function toRouteError(error: unknown): Error {
  if (isToolchainDownloadError(error) || isToolchainResolutionError(error)) {
    return error
  }
  return error instanceof Error ? error : new Error(String(error))
}
