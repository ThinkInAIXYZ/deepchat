import { ocrClearCacheRoute, ocrGetRuntimeStatusRoute } from '@shared/contracts/routes'
import type { OcrRuntimeStatus } from '@shared/contracts/routes/ocr.routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import type { OcrRuntimeService, OcrRuntimeServiceStatus } from './ocrRuntimeService'

export function createOcrRoutes(deps: {
  runtime: Pick<OcrRuntimeService, 'clearCache' | 'getStatus'>
  platform?: string
  arch?: string
}): DeepchatRouteMap {
  const getStatus = async (): Promise<OcrRuntimeStatus> =>
    toPublicStatus(
      await deps.runtime.getStatus(),
      deps.platform ?? process.platform,
      deps.arch ?? process.arch
    )

  return createRouteMap([
    [
      ocrGetRuntimeStatusRoute.name,
      async (rawInput) => {
        ocrGetRuntimeStatusRoute.input.parse(rawInput)
        return ocrGetRuntimeStatusRoute.output.parse(await getStatus())
      }
    ],
    [
      ocrClearCacheRoute.name,
      async (rawInput) => {
        ocrClearCacheRoute.input.parse(rawInput)
        await deps.runtime.clearCache()
        const status = await getStatus()
        if (!status.cache) throw new Error('OCR cache status is unavailable after clearing')
        return ocrClearCacheRoute.output.parse({ cache: status.cache })
      }
    ]
  ])
}

function toPublicStatus(
  status: OcrRuntimeServiceStatus,
  platform: string,
  arch: string
): OcrRuntimeStatus {
  const availability =
    status.availability.status === 'available'
      ? {
          status: 'available' as const,
          lightOcrVersion: status.availability.assets.lightOcrVersion,
          bundleId: status.availability.assets.bundleId
        }
      : status.availability

  return {
    platform,
    arch,
    availability,
    process: status.process
      ? {
          state: status.process.state,
          nodeVersion: status.process.nodeVersion,
          queuedRequests: status.process.queuedRequests,
          pendingInputBytes: status.process.pendingInputBytes,
          engine: status.process.engine
            ? {
                coreVersion: status.process.engine.coreVersion,
                modelBundleId: status.process.engine.modelBundleId,
                requestedBackend: status.process.engine.requestedProvider,
                strategy: status.process.engine.strategy,
                detection: {
                  providerChain: status.process.engine.detection.actualProviderChain,
                  precision: status.process.engine.detection.precision
                },
                recognition: {
                  providerChain: status.process.engine.recognition.actualProviderChain,
                  precision: status.process.engine.recognition.precision
                }
              }
            : null
        }
      : null,
    cache: status.cache
  }
}
