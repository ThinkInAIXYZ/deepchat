import logger from '@shared/logger'
import type { RuntimeAssetInstallState } from '@shared/types/pluginCatalog'
import type { RuntimeAssetResolution } from '@/plugin/catalog'
import type {
  OcrRuntimeAssetInstallResult,
  OcrRuntimeAssetInstaller
} from './runtimeAssetInstaller'

const DEFAULT_RETRY_COOLDOWN_MS = 5 * 60 * 1000

export type OcrRuntimeInstallCoordinatorDeps = {
  resolveAsset: () => RuntimeAssetResolution | null
  installer: Pick<
    OcrRuntimeAssetInstaller,
    'install' | 'installFromFile' | 'isRunning' | 'getInstallState'
  >
  onInstalled: () => void
  retryCooldownMs?: number
  now?: () => number
}

/**
 * Coordinates OCR runtime downloads. Attachment routing consults OCR
 * availability on every turn; when the runtime is missing, a background
 * install starts silently. The triggering turn still degrades (skips OCR
 * text extraction) — only later turns benefit. A failed automatic install
 * enters a cooldown so a bad network does not retrigger a download on every
 * message; explicit installs (settings page) bypass and reset the cooldown.
 */
export class OcrRuntimeInstallCoordinator {
  private readonly deps: OcrRuntimeInstallCoordinatorDeps
  private cooldownUntil = 0

  constructor(deps: OcrRuntimeInstallCoordinatorDeps) {
    this.deps = deps
  }

  getInstallState(): RuntimeAssetInstallState | null {
    return this.deps.installer.getInstallState(this.assetId)
  }

  private get assetId(): string {
    return this.deps.resolveAsset()?.asset.id ?? 'light-ocr'
  }

  /** Fire-and-forget trigger from first-use (attachment routing) paths. */
  maybeStartInstall(): void {
    if (this.deps.installer.isRunning(this.assetId)) return
    const state = this.deps.installer.getInstallState(this.assetId)
    if (state?.phase === 'installed') return
    const now = (this.deps.now ?? Date.now)()
    if (state?.phase === 'error' && now < this.cooldownUntil) return

    const resolution = this.deps.resolveAsset()
    if (!resolution) return
    void this.runInstall(resolution, { automatic: true })
  }

  /** Explicit install (settings page); bypasses and resets the cooldown. */
  async install(): Promise<OcrRuntimeAssetInstallResult> {
    const resolution = this.deps.resolveAsset()
    if (!resolution) {
      return {
        ok: false,
        assetId: this.assetId,
        version: '',
        reason: 'unavailable',
        error: 'OCR runtime is not available for this platform or app version'
      }
    }
    return await this.runInstall(resolution, { automatic: false })
  }

  /** Manual install from a locally selected archive; resets the cooldown. */
  async installFromFile(filePath: string): Promise<OcrRuntimeAssetInstallResult> {
    this.cooldownUntil = 0
    const result = await this.deps.installer.installFromFile(filePath)
    if (result.ok) {
      this.cooldownUntil = 0
      this.deps.onInstalled()
    }
    return result
  }

  private async runInstall(
    resolution: NonNullable<ReturnType<OcrRuntimeInstallCoordinatorDeps['resolveAsset']>>,
    options: { automatic: boolean }
  ): Promise<OcrRuntimeAssetInstallResult> {
    if (options.automatic) {
      logger.info('[OcrRuntimeInstall] Starting automatic runtime download', {
        version: resolution.asset.version
      })
    } else {
      this.cooldownUntil = 0
    }
    const result = await this.deps.installer.install(resolution.asset, resolution.target)
    if (result.ok) {
      this.cooldownUntil = 0
      this.deps.onInstalled()
    } else if (options.automatic && result.reason !== 'busy' && result.reason !== 'cancelled') {
      this.cooldownUntil =
        (this.deps.now ?? Date.now)() + (this.deps.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS)
    }
    return result
  }
}
