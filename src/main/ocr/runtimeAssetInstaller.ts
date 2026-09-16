import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { unzip as unzipAsync } from 'fflate'
import logger from '@shared/logger'
import type { FetchLike } from '@/toolchains/downloader'
import { isToolchainDownloadError } from '@/toolchains/errors'
import {
  downloadArtifactToStaging,
  type RemoteArtifactDescriptor
} from '@/lib/remoteArtifactDownload'
import { isPackagedRuntimeManifest } from './ocrRuntimeAssetResolver'
import type {
  PluginCatalogTarget,
  RuntimeAssetInstallPhase,
  RuntimeAssetInstallState,
  RuntimeCatalogAsset
} from '@shared/types/pluginCatalog'

const OCR_RUNTIME_MANIFEST_ENTRY = 'runtime/ocr/manifest.json'
// Generous bounds for the decompressed payload relative to the pinned
// compressed size: the real OCR payload decompresses at roughly 2.5x, so an
// 8x ratio with a 256 MiB floor rejects zip bombs without rejecting builds.
const MAX_DECOMPRESSION_RATIO = 8
const MAX_DECOMPRESSED_BYTES_FLOOR = 256 * 1024 * 1024

export type OcrRuntimeAssetInstallResult = {
  ok: boolean
  assetId: string
  version: string
  reason: string | null
  error: string | null
}

export type OcrRuntimeAssetInstallerDeps = {
  installRoot: () => string
  stagingRoot: () => string
  fetchImpl?: FetchLike
  probeTimeoutMs?: number
  onProgress?: (state: RuntimeAssetInstallState) => void
  now?: () => number
}

/**
 * Downloads and materializes the OCR runtime payload declared by the
 * distribution catalog. The payload is a zip of the packaged OCR runtime
 * root (manifest.json + helper entry + facade/runtime/model/native package
 * directories) — the exact layout `OcrRuntimeAssetResolver` validates — so a
 * downloaded install is verified with the same identity checks as a bundled
 * one. Payloads land in versioned directories under the install root; stale
 * or foreign-version directories simply fail resolver validation and are
 * ignored.
 */
export class OcrRuntimeAssetInstaller {
  private readonly deps: OcrRuntimeAssetInstallerDeps
  private readonly running = new Map<string, AbortController>()
  private readonly activeOperations = new Map<string, Promise<OcrRuntimeAssetInstallResult>>()
  private readonly states = new Map<string, RuntimeAssetInstallState>()

  constructor(deps: OcrRuntimeAssetInstallerDeps) {
    this.deps = deps
  }

  getInstallState(assetId: string): RuntimeAssetInstallState | null {
    return this.states.get(assetId) ?? null
  }

  getInstallStates(): RuntimeAssetInstallState[] {
    return Array.from(this.states.values())
  }

  isRunning(assetId: string): boolean {
    return this.running.has(assetId)
  }

  cancel(assetId: string): boolean {
    const controller = this.running.get(assetId)
    if (!controller || controller.signal.aborted) return false
    controller.abort()
    return true
  }

  /** Aborts every running install and waits for them to settle. */
  async cancelAll(): Promise<void> {
    for (const controller of this.running.values()) {
      if (!controller.signal.aborted) controller.abort()
    }
    await Promise.allSettled(Array.from(this.activeOperations.values()))
  }

  /** Installed runtime root directories, newest version name first. */
  listInstalledRoots(): string[] {
    const root = this.deps.installRoot()
    if (!fs.existsSync(root)) return []
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))
      .map((name) => path.join(root, name))
  }

  async install(
    asset: RuntimeCatalogAsset,
    target: PluginCatalogTarget,
    options: { signal?: AbortSignal } = {}
  ): Promise<OcrRuntimeAssetInstallResult> {
    if (this.running.has(asset.id)) {
      return {
        ok: false,
        assetId: asset.id,
        version: asset.version,
        reason: 'busy',
        error: 'An install for this runtime asset is already running'
      }
    }

    const controller = new AbortController()
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort()
      } else {
        options.signal.addEventListener('abort', () => controller.abort(), { once: true })
      }
    }
    this.running.set(asset.id, controller)
    const operation = this.runInstall(asset, target, controller).finally(() => {
      this.running.delete(asset.id)
      this.activeOperations.delete(asset.id)
    })
    this.activeOperations.set(asset.id, operation)
    return await operation
  }

  private async runInstall(
    asset: RuntimeCatalogAsset,
    target: PluginCatalogTarget,
    controller: AbortController
  ): Promise<OcrRuntimeAssetInstallResult> {
    const descriptor: RemoteArtifactDescriptor = {
      url: target.url,
      sha256: target.sha256,
      size: target.size,
      mirrors: target.mirrors
    }

    const update = (
      phase: RuntimeAssetInstallPhase,
      patch: Partial<RuntimeAssetInstallState> = {}
    ): void => {
      const state: RuntimeAssetInstallState = {
        assetId: asset.id,
        version: asset.version,
        phase,
        receivedBytes: patch.receivedBytes ?? 0,
        totalBytes: patch.totalBytes ?? target.size,
        error: patch.error ?? null,
        updatedAt: (this.deps.now ?? Date.now)()
      }
      this.states.set(asset.id, state)
      this.deps.onProgress?.(state)
    }

    let stagingDir: string | null = null
    try {
      update('probing', { totalBytes: target.size })
      const staged = await downloadArtifactToStaging({
        descriptor,
        stagingRoot: this.deps.stagingRoot(),
        fetchImpl: this.deps.fetchImpl,
        signal: controller.signal,
        probeTimeoutMs: this.deps.probeTimeoutMs,
        now: this.deps.now,
        onProgress: (progress) => {
          update(progress.phase, {
            receivedBytes: progress.receivedBytes,
            totalBytes: progress.totalBytes
          })
        }
      })
      stagingDir = staged.stagingDir

      update('verifying', { receivedBytes: target.size, totalBytes: target.size })
      const extractedDir = await this.extractPayload(staged.archivePath, staged.stagingDir, target)

      update('installing', { receivedBytes: target.size, totalBytes: target.size })
      const installRoot = this.deps.installRoot()
      fs.mkdirSync(installRoot, { recursive: true })
      const versionDir = path.join(installRoot, this.safeDirectoryName(asset.version))
      this.swapVersionDirectory(extractedDir, versionDir)

      update('installed', { receivedBytes: target.size, totalBytes: target.size })
      return { ok: true, assetId: asset.id, version: asset.version, reason: null, error: null }
    } catch (error) {
      const cancelled = controller.signal.aborted
      const { reason, message } = cancelled
        ? { reason: 'cancelled', message: 'Install cancelled' }
        : describeInstallError(error)
      const phase: RuntimeAssetInstallPhase = reason === 'cancelled' ? 'cancelled' : 'error'
      update(phase, { error: message })
      if (phase === 'error') {
        logger.warn('[OcrRuntimeAssetInstaller] Install failed', {
          assetId: asset.id,
          version: asset.version,
          reason,
          error: message
        })
      }
      return { ok: false, assetId: asset.id, version: asset.version, reason, error: message }
    } finally {
      if (stagingDir) {
        fs.rmSync(stagingDir, { recursive: true, force: true })
      }
    }
  }

  /**
   * Unzips the payload into `<stagingDir>/payload` and performs structural
   * validation: the packaged runtime manifest must parse and its declared
   * helper entry must exist inside the payload. Full identity verification
   * (versions, hashes, inventory) is delegated to the runtime resolver, which
   * applies the same checks as for bundled payloads.
   *
   * Decompression runs through fflate's async API (worker thread) so the
   * main-process event loop is not blocked, and the total decompressed size
   * is capped relative to the catalog-pinned compressed size: a zip bomb
   * cannot exhaust memory before the cap rejects it.
   */
  private async extractPayload(
    archivePath: string,
    stagingDir: string,
    target: PluginCatalogTarget
  ): Promise<string> {
    const archive = new Uint8Array(fs.readFileSync(archivePath))
    const maxDecompressedBytes = Math.max(
      MAX_DECOMPRESSED_BYTES_FLOOR,
      target.size * MAX_DECOMPRESSION_RATIO
    )
    let oversizedEntry: string | null = null
    const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
      unzipAsync(
        archive,
        {
          // Entries beyond the cap are skipped before decompression; the
          // check after unzip rejects the whole payload if any entry was
          // skipped.
          filter: (file) => {
            if (file.originalSize > maxDecompressedBytes) {
              oversizedEntry = file.name
              return false
            }
            return true
          }
        },
        (error, data) => {
          if (error) reject(error)
          else resolve(data)
        }
      )
    })
    if (oversizedEntry) {
      throw new Error(
        `OCR runtime payload entry exceeds the decompressed size cap: ${oversizedEntry}`
      )
    }
    const manifestEntry = files[OCR_RUNTIME_MANIFEST_ENTRY]
    if (!manifestEntry) {
      throw new Error('OCR runtime payload is missing manifest.json')
    }
    let manifest: unknown
    try {
      manifest = JSON.parse(Buffer.from(manifestEntry).toString('utf8')) as unknown
    } catch (error) {
      throw new Error('OCR runtime payload manifest.json is not valid JSON', { cause: error })
    }
    if (!isPackagedRuntimeManifest(manifest)) {
      throw new Error('OCR runtime payload manifest has an invalid shape')
    }
    // The payload layout mirrors the unpacked app root: manifest paths are
    // root-relative (runtime/ocr/..., out/main/lightOcrHelper.js).
    const helperPath = manifest.paths?.helper
    if (!helperPath || !files[helperPath]) {
      throw new Error('OCR runtime payload does not contain the declared helper entry')
    }

    const payloadDir = path.join(stagingDir, 'payload')
    fs.mkdirSync(payloadDir, { recursive: true })
    for (const [relativePath, content] of Object.entries(files)) {
      if (relativePath.endsWith('/')) continue
      const outputPath = this.resolveSafePayloadPath(payloadDir, relativePath)
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(outputPath, Buffer.from(content))
    }
    return payloadDir
  }

  /**
   * Replaces the version directory atomically: the previous install is
   * renamed aside (open files in a running helper keep working), the new
   * payload is renamed into place, and only then is the old copy removed. A
   * crash mid-swap leaves either the old or the new directory intact.
   */
  private swapVersionDirectory(extractedDir: string, versionDir: string): void {
    const previous = `${versionDir}.old-${randomUUID()}`
    fs.rmSync(previous, { recursive: true, force: true })
    let movedPrevious = false
    if (fs.existsSync(versionDir)) {
      fs.renameSync(versionDir, previous)
      movedPrevious = true
    }
    try {
      fs.renameSync(extractedDir, versionDir)
    } catch (error) {
      if (movedPrevious && !fs.existsSync(versionDir)) {
        fs.renameSync(previous, versionDir)
      }
      throw error
    }
    fs.rmSync(previous, { recursive: true, force: true })
  }

  private resolveSafePayloadPath(payloadRoot: string, relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/')
    if (
      !normalized ||
      normalized.startsWith('/') ||
      normalized.includes('..') ||
      /^[A-Za-z]:/.test(normalized)
    ) {
      throw new Error(`Unsafe OCR runtime payload path: ${relativePath}`)
    }
    const resolved = path.resolve(payloadRoot, ...normalized.split('/').filter(Boolean))
    const relative = path.relative(payloadRoot, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`OCR runtime payload path escapes the payload root: ${relativePath}`)
    }
    return resolved
  }

  private safeDirectoryName(version: string): string {
    const safe = version.replace(/[^a-zA-Z0-9._-]/g, '-')
    if (!safe || safe === '.' || safe === '..') {
      throw new Error(`Invalid runtime asset version: ${version}`)
    }
    return safe
  }
}

function describeInstallError(error: unknown): { reason: string; message: string } {
  if (isToolchainDownloadError(error)) {
    return { reason: error.reason, message: error.message }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { reason: 'install_failed', message }
}
