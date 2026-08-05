import { describe, expect, it } from 'vitest'

import { OcrRuntimeService } from '@/ocr/ocrRuntimeService'

function createUnsupportedService() {
  return new OcrRuntimeService({
    appPath: '/application',
    isPackaged: true,
    nodeRuntimePath: null,
    tempBaseDir: '/tmp',
    userDataDir: '/user-data',
    platform: 'win32',
    arch: 'ia32'
  })
}

describe('OcrRuntimeService', () => {
  it('reports unsupported targets without creating runtime resources', async () => {
    const service = createUnsupportedService()

    await expect(service.getStatus()).resolves.toEqual({
      availability: {
        status: 'unavailable',
        reason: 'unsupported_platform',
        lightOcrVersion: '0.5.7',
        bundleId: 'ppocrv6-small-native-20260719.1'
      },
      process: null,
      cache: null
    })

    await service.close()
  })

  it('reports the pinned identity after shutdown instead of a fabricated version', async () => {
    const service = createUnsupportedService()
    await service.close()

    await expect(service.getAvailability()).resolves.toEqual({
      status: 'unavailable',
      reason: 'service_closed',
      lightOcrVersion: '0.5.7',
      bundleId: 'ppocrv6-small-native-20260719.1'
    })
  })
})
