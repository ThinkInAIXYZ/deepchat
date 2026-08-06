import { ocrClearCacheRoute, ocrGetRuntimeStatusRoute } from '@shared/contracts/routes'
import type { OcrEngine, OcrRuntimeStatus } from '@shared/contracts/routes/ocr.routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import type { LightOcrEngineStatus } from './lightOcrProtocol'
import type { OcrRuntimeService, OcrRuntimeServiceStatus } from './ocrRuntimeService'

export function createOcrRoutes(deps: {
  runtime: Pick<OcrRuntimeService, 'clearCache' | 'getStatus'>
  platform?: string
  arch?: string
}): DeepchatRouteMap {
  const getStatus = async (): Promise<OcrRuntimeStatus> =>
    toPublicOcrStatus(
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

export function toPublicOcrStatus(
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
          engine: status.process.engine ? toPublicOcrEngine(status.process.engine) : null
        }
      : null,
    cache: status.cache
  }
}

export function toPublicOcrEngine(engine: LightOcrEngineStatus): OcrEngine {
  return {
    coreVersion: engine.coreVersion,
    modelBundleId: engine.modelBundleId,
    requestedBackend: engine.requestedProvider,
    strategy: engine.strategy,
    detection: {
      providerChain: [...engine.detection.actualProviderChain],
      precision: engine.detection.precision
    },
    recognition: {
      providerChain: [...engine.recognition.actualProviderChain],
      precision: engine.recognition.precision
    }
  }
}
