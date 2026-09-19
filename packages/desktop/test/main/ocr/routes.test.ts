import { describe, expect, it, vi } from 'vitest'
import { createRendererRouteContext } from '@/routes/routeRegistry'

import { createOcrRoutes } from '@/ocr/routes'
import type { OcrRuntimeServiceStatus } from '@/ocr/ocrRuntimeService'

const INTERNAL_STATUS: OcrRuntimeServiceStatus = {
  availability: {
    status: 'available',
    assets: {
      nodeExecutable: '/private/runtime/node',
      helperEntryPath: '/private/runtime/helper.js',
      facadeDir: '/private/runtime/facade',
      runtimeDir: '/private/runtime/runtime',
      bundlePath: '/private/runtime/model',
      nativePackageDir: '/private/runtime/native',
      nativePayloadEncoding: 'gzip-base64-v1',
      nativePackage: '@arcships/light-ocr-darwin-arm64',
      lightOcrVersion: '0.3.4',
      bundleId: 'ppocrv6-small-native-20260719.1'
    }
  },
  process: {
    state: 'ready',
    pid: 4242,
    nodeVersion: 'v24.18.0',
    queuedRequests: 0,
    pendingInputBytes: 0,
    stderrBytesCaptured: 17,
    engine: {
      coreVersion: '0.3.4',
      modelBundleId: 'ppocrv6-small-native-20260719.1',
      requestedProvider: 'auto',
      strategy: 'bounded-960',
      detection: {
        actualProviderChain: ['coreml', 'cpu'],
        precision: 'fp16',
        qualificationId: 'private-detection-id'
      },
      recognition: {
        actualProviderChain: ['cpu'],
        precision: 'fp32',
        qualificationId: 'private-recognition-id'
      }
    }
  },
  cache: {
    mode: 'persistent',
    entryCount: 3,
    logicalBytes: 2048,
    maxBytes: 256 * 1024 * 1024
  }
}

describe('OCR routes', () => {
  it('returns operational status without exposing process or asset internals', async () => {
    const runtime = {
      getStatus: vi.fn().mockResolvedValue(INTERNAL_STATUS),
      clearCache: vi.fn()
    }
    const routes = createOcrRoutes({ runtime, platform: 'darwin', arch: 'arm64' })
    const handler = routes.get('ocr.getRuntimeStatus')

    const result = await handler?.({}, createRendererRouteContext(1, 1))

    expect(result).toEqual({
      platform: 'darwin',
      arch: 'arm64',
      availability: {
        status: 'available',
        lightOcrVersion: '0.3.4',
        bundleId: 'ppocrv6-small-native-20260719.1'
      },
      process: {
        state: 'ready',
        nodeVersion: 'v24.18.0',
        queuedRequests: 0,
        pendingInputBytes: 0,
        engine: {
          coreVersion: '0.3.4',
          modelBundleId: 'ppocrv6-small-native-20260719.1',
          requestedBackend: 'auto',
          strategy: 'bounded-960',
          detection: { providerChain: ['coreml', 'cpu'], precision: 'fp16' },
          recognition: { providerChain: ['cpu'], precision: 'fp32' }
        }
      },
      cache: INTERNAL_STATUS.cache
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('/private/')
    expect(serialized).not.toContain('4242')
    expect(serialized).not.toContain('qualification')
    expect(serialized).not.toContain('stderr')
  })

  it('clears the cache and returns refreshed cache statistics', async () => {
    const clearedStatus: OcrRuntimeServiceStatus = {
      ...INTERNAL_STATUS,
      cache: { ...INTERNAL_STATUS.cache!, entryCount: 0, logicalBytes: 0 }
    }
    const runtime = {
      getStatus: vi.fn().mockResolvedValue(clearedStatus),
      clearCache: vi.fn().mockResolvedValue(undefined)
    }
    const routes = createOcrRoutes({ runtime })

    const result = await routes.get('ocr.clearCache')?.({}, createRendererRouteContext(1, null))

    expect(runtime.clearCache).toHaveBeenCalledOnce()
    expect(result).toEqual({ cache: clearedStatus.cache })
  })

  it('keeps unavailable targets visible with their runtime reason', async () => {
    const runtime = {
      getStatus: vi.fn().mockResolvedValue({
        availability: {
          status: 'unavailable',
          reason: 'unsupported_platform',
          lightOcrVersion: '0.3.4',
          bundleId: 'ppocrv6-small-native-20260719.1'
        },
        process: null,
        cache: null
      } satisfies OcrRuntimeServiceStatus),
      clearCache: vi.fn()
    }
    const routes = createOcrRoutes({ runtime, platform: 'win32', arch: 'ia32' })

    await expect(
      routes.get('ocr.getRuntimeStatus')?.({}, createRendererRouteContext(1, null))
    ).resolves.toMatchObject({
      platform: 'win32',
      arch: 'ia32',
      availability: { status: 'unavailable', reason: 'unsupported_platform' },
      process: null,
      cache: null
    })
  })
})
