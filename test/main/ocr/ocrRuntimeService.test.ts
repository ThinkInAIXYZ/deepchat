import { describe, expect, it, vi } from 'vitest'

import { OcrRuntimeAssetResolver } from '@/ocr/ocrRuntimeAssetResolver'
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

  it('retries availability after an unavailable result', async () => {
    const unavailable = {
      status: 'unavailable' as const,
      reason: 'assets_missing' as const,
      lightOcrVersion: '0.5.7',
      bundleId: 'ppocrv6-small-native-20260719.1'
    }
    const resolve = vi.spyOn(OcrRuntimeAssetResolver.prototype, 'resolve')
    resolve.mockResolvedValueOnce(unavailable).mockResolvedValueOnce({
      status: 'available',
      assets: { nodeExecutable: '/managed/node' }
    } as never)

    const service = new OcrRuntimeService({
      appPath: '/application',
      isPackaged: true,
      nodeRuntimePath: null,
      tempBaseDir: '/tmp',
      userDataDir: '/user-data',
      platform: 'darwin',
      arch: 'arm64'
    })

    await expect(service.getAvailability()).resolves.toEqual(unavailable)
    await expect(service.getAvailability()).resolves.toMatchObject({
      status: 'available',
      assets: { nodeExecutable: '/managed/node' }
    })
    expect(resolve).toHaveBeenCalledTimes(2)
    resolve.mockRestore()
    await service.close()
  })

  it('drops cached availability so a later resolve can pick a new Node', async () => {
    const resolve = vi.spyOn(OcrRuntimeAssetResolver.prototype, 'resolve')
    resolve
      .mockResolvedValueOnce({
        status: 'available',
        assets: { nodeExecutable: '/old/node' }
      } as never)
      .mockResolvedValueOnce({
        status: 'available',
        assets: { nodeExecutable: '/new/node' }
      } as never)

    const service = new OcrRuntimeService({
      appPath: '/application',
      isPackaged: true,
      nodeRuntimePath: null,
      tempBaseDir: '/tmp',
      userDataDir: '/user-data',
      platform: 'darwin',
      arch: 'arm64'
    })

    await expect(service.getAvailability()).resolves.toMatchObject({
      assets: { nodeExecutable: '/old/node' }
    })
    service.refreshAvailability()
    await expect(service.getAvailability()).resolves.toMatchObject({
      assets: { nodeExecutable: '/new/node' }
    })
    expect(resolve).toHaveBeenCalledTimes(2)
    resolve.mockRestore()
    await service.close()
  })

  it('still refreshes availability when only uv changes', async () => {
    const resolve = vi.spyOn(OcrRuntimeAssetResolver.prototype, 'resolve')
    resolve
      .mockResolvedValueOnce({
        status: 'available',
        assets: { nodeExecutable: '/old/node' }
      } as never)
      .mockResolvedValueOnce({
        status: 'available',
        assets: { nodeExecutable: '/old/node' }
      } as never)

    const service = new OcrRuntimeService({
      appPath: '/application',
      isPackaged: true,
      nodeRuntimePath: null,
      tempBaseDir: '/tmp',
      userDataDir: '/user-data',
      platform: 'darwin',
      arch: 'arm64'
    })

    await expect(service.getAvailability()).resolves.toMatchObject({
      assets: { nodeExecutable: '/old/node' }
    })
    service.refreshAvailability('uv')
    await expect(service.getAvailability()).resolves.toMatchObject({
      assets: { nodeExecutable: '/old/node' }
    })
    expect(resolve).toHaveBeenCalledTimes(2)
    resolve.mockRestore()
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
