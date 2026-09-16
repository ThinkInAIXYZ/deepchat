import { describe, expect, it, vi } from 'vitest'
import { OcrRuntimeInstallCoordinator } from '@/ocr/runtimeInstallCoordinator'
import type { RuntimeAssetResolution } from '@/plugin/catalog'
import type {
  OcrRuntimeAssetInstallResult,
  OcrRuntimeAssetInstaller
} from '@/ocr/runtimeAssetInstaller'
import type {
  PluginCatalogTarget,
  RuntimeAssetInstallState,
  RuntimeCatalogAsset
} from '@shared/types/pluginCatalog'

type InstallerHarness = {
  installer: Pick<OcrRuntimeAssetInstaller, 'install' | 'isRunning' | 'getInstallState'>
  install: ReturnType<typeof vi.fn>
  setState: (state: RuntimeAssetInstallState | null) => void
}

function createHarness(options: {
  installResult?: OcrRuntimeAssetInstallResult
  running?: boolean
  state?: RuntimeAssetInstallState | null
}): InstallerHarness {
  let currentState: RuntimeAssetInstallState | null = options.state ?? null
  const install = vi.fn(async (): Promise<OcrRuntimeAssetInstallResult> => {
    const result = options.installResult ?? {
      ok: true,
      assetId: 'light-ocr',
      version: 'ppocrv6-small-native-20260719.1',
      reason: null,
      error: null
    }
    // Mirror the real installer's terminal state transition.
    currentState = {
      assetId: result.assetId,
      version: result.version,
      phase: result.ok ? 'installed' : 'error',
      receivedBytes: 1,
      totalBytes: 1,
      error: result.error,
      updatedAt: 1
    }
    return result
  })
  const installer: Pick<OcrRuntimeAssetInstaller, 'install' | 'isRunning' | 'getInstallState'> = {
    install,
    isRunning: () => options.running ?? false,
    getInstallState: () => currentState
  }
  return { installer, install, setState: (state) => (currentState = state) }
}

function createResolution(): RuntimeAssetResolution {
  const target: PluginCatalogTarget = {
    platform: 'darwin',
    arch: 'arm64',
    url: 'https://example.com/ocr-runtime.zip',
    sha256: 'a'.repeat(64),
    size: 100,
    mirrors: []
  }
  const asset: RuntimeCatalogAsset = {
    id: 'light-ocr',
    version: 'ppocrv6-small-native-20260719.1',
    channel: 'stable',
    targets: [target]
  }
  return { asset, target }
}

describe('OcrRuntimeInstallCoordinator', () => {
  it('starts an automatic install when enabled and resolvable', async () => {
    const harness = createHarness({})
    const onInstalled = vi.fn()
    const coordinator = new OcrRuntimeInstallCoordinator({
      resolveAsset: () => createResolution(),
      isAutoDownloadEnabled: () => true,
      installer: harness.installer,
      onInstalled
    })

    coordinator.maybeStartInstall()
    await vi.waitFor(() => expect(harness.install).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(onInstalled).toHaveBeenCalledOnce())
  })

  it('does not auto-install when the setting is disabled', () => {
    const harness = createHarness({})
    const coordinator = new OcrRuntimeInstallCoordinator({
      resolveAsset: () => createResolution(),
      isAutoDownloadEnabled: () => false,
      installer: harness.installer,
      onInstalled: vi.fn()
    })

    coordinator.maybeStartInstall()

    expect(harness.install).not.toHaveBeenCalled()
  })

  it('does not auto-install without a catalog resolution', () => {
    const harness = createHarness({})
    const coordinator = new OcrRuntimeInstallCoordinator({
      resolveAsset: () => null,
      isAutoDownloadEnabled: () => true,
      installer: harness.installer,
      onInstalled: vi.fn()
    })

    coordinator.maybeStartInstall()

    expect(harness.install).not.toHaveBeenCalled()
  })

  it('skips automatic install while one is running or already installed', () => {
    const running = createHarness({ running: true })
    const coordinator = new OcrRuntimeInstallCoordinator({
      resolveAsset: () => createResolution(),
      isAutoDownloadEnabled: () => true,
      installer: running.installer,
      onInstalled: vi.fn()
    })
    coordinator.maybeStartInstall()
    expect(running.install).not.toHaveBeenCalled()

    const installed = createHarness({
      state: {
        assetId: 'light-ocr',
        version: 'v',
        phase: 'installed',
        receivedBytes: 1,
        totalBytes: 1,
        error: null,
        updatedAt: 1
      }
    })
    const coordinatorInstalled = new OcrRuntimeInstallCoordinator({
      resolveAsset: () => createResolution(),
      isAutoDownloadEnabled: () => true,
      installer: installed.installer,
      onInstalled: vi.fn()
    })
    coordinatorInstalled.maybeStartInstall()
    expect(installed.install).not.toHaveBeenCalled()
  })

  it('enters a cooldown after a failed automatic install', async () => {
    let clock = 1_000
    const harness = createHarness({
      installResult: {
        ok: false,
        assetId: 'light-ocr',
        version: 'ppocrv6-small-native-20260719.1',
        reason: 'http',
        error: 'HTTP 500'
      }
    })
    const coordinator = new OcrRuntimeInstallCoordinator({
      resolveAsset: () => createResolution(),
      isAutoDownloadEnabled: () => true,
      installer: harness.installer,
      onInstalled: vi.fn(),
      retryCooldownMs: 60_000,
      now: () => clock
    })

    coordinator.maybeStartInstall()
    await vi.waitFor(() => expect(harness.install).toHaveBeenCalledOnce())

    // Within the cooldown: no automatic retry.
    clock += 10_000
    coordinator.maybeStartInstall()
    expect(harness.install).toHaveBeenCalledOnce()

    // After the cooldown: retries automatically.
    clock += 60_000
    coordinator.maybeStartInstall()
    await vi.waitFor(() => expect(harness.install).toHaveBeenCalledTimes(2))
  })

  it('explicit install bypasses and resets the cooldown', async () => {
    let clock = 1_000
    const harness = createHarness({
      installResult: {
        ok: false,
        assetId: 'light-ocr',
        version: 'ppocrv6-small-native-20260719.1',
        reason: 'http',
        error: 'HTTP 500'
      }
    })
    const coordinator = new OcrRuntimeInstallCoordinator({
      resolveAsset: () => createResolution(),
      isAutoDownloadEnabled: () => true,
      installer: harness.installer,
      onInstalled: vi.fn(),
      retryCooldownMs: 60_000,
      now: () => clock
    })

    coordinator.maybeStartInstall()
    await vi.waitFor(() => expect(harness.install).toHaveBeenCalledOnce())

    // Explicit install resets the cooldown even though no time has passed.
    await coordinator.install()
    expect(harness.install).toHaveBeenCalledTimes(2)

    coordinator.maybeStartInstall()
    await vi.waitFor(() => expect(harness.install).toHaveBeenCalledTimes(3))
  })

  it('reports an explicit install as unavailable without a catalog resolution', async () => {
    const harness = createHarness({})
    const coordinator = new OcrRuntimeInstallCoordinator({
      resolveAsset: () => null,
      isAutoDownloadEnabled: () => true,
      installer: harness.installer,
      onInstalled: vi.fn()
    })

    const result = await coordinator.install()

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('unavailable')
    expect(harness.install).not.toHaveBeenCalled()
  })
})
