import fs from 'node:fs'
import logger from '@shared/logger'
import type { FetchLike } from '@/toolchains/downloader'
import { isToolchainDownloadError } from '@/toolchains/errors'
import {
  downloadArtifactToStaging,
  type RemoteArtifactDescriptor
} from '@/lib/remoteArtifactDownload'
import type {
  PluginCatalogArtifact,
  PluginCatalogInstallPhase,
  PluginCatalogInstallState,
  PluginCatalogTarget
} from '@shared/types/pluginCatalog'

export type PluginRemoteInstallResult = {
  ok: boolean
  pluginId: string
  version: string
  reason: string | null
  error: string | null
}

export type PluginRemoteInstallerDeps = {
  stagingRoot: () => string
  installPackage: (packagePath: string) => Promise<{ pluginId: string; version: string }>
  fetchImpl?: FetchLike
  probeTimeoutMs?: number
  onProgress?: (state: PluginCatalogInstallState) => void
  now?: () => number
}

/**
 * Downloads official plugin packages declared by the distribution catalog.
 * The artifact is fetched into a staging directory, verified against the
 * catalog-pinned sha256 (mirrors therefore cannot serve tampered content),
 * and handed to the plugin service for package verification + installation.
 */
export class PluginRemoteInstaller {
  private readonly deps: PluginRemoteInstallerDeps
  private readonly running = new Map<string, AbortController>()
  private readonly states = new Map<string, PluginCatalogInstallState>()

  constructor(deps: PluginRemoteInstallerDeps) {
    this.deps = deps
  }

  getInstallState(pluginId: string): PluginCatalogInstallState | null {
    return this.states.get(pluginId) ?? null
  }

  getInstallStates(): PluginCatalogInstallState[] {
    return Array.from(this.states.values())
  }

  isRunning(pluginId: string): boolean {
    return this.running.has(pluginId)
  }

  cancel(pluginId: string): boolean {
    const controller = this.running.get(pluginId)
    if (!controller || controller.signal.aborted) return false
    controller.abort()
    return true
  }

  async install(
    artifact: PluginCatalogArtifact,
    target: PluginCatalogTarget,
    options: { signal?: AbortSignal } = {}
  ): Promise<PluginRemoteInstallResult> {
    const { pluginId, version } = artifact
    if (this.running.has(pluginId)) {
      return {
        ok: false,
        pluginId,
        version,
        reason: 'busy',
        error: 'An install for this plugin is already running'
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
    this.running.set(pluginId, controller)

    try {
      return await this.runInstall(artifact, target, controller)
    } finally {
      this.running.delete(pluginId)
    }
  }

  private async runInstall(
    artifact: PluginCatalogArtifact,
    target: PluginCatalogTarget,
    controller: AbortController
  ): Promise<PluginRemoteInstallResult> {
    const { pluginId, version } = artifact
    const descriptor: RemoteArtifactDescriptor = {
      url: target.url,
      sha256: target.sha256,
      size: target.size,
      mirrors: target.mirrors
    }

    const update = (
      phase: PluginCatalogInstallPhase,
      patch: Partial<PluginCatalogInstallState> = {}
    ): void => {
      const state: PluginCatalogInstallState = {
        pluginId,
        version,
        phase,
        receivedBytes: patch.receivedBytes ?? 0,
        totalBytes: patch.totalBytes ?? target.size,
        error: patch.error ?? null,
        updatedAt: (this.deps.now ?? Date.now)()
      }
      this.states.set(pluginId, state)
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
      update('installing', { receivedBytes: target.size, totalBytes: target.size })
      const installed = await this.deps.installPackage(staged.archivePath)
      if (installed.pluginId !== pluginId) {
        throw new Error(`Installed package declares a different plugin id: ${installed.pluginId}`)
      }

      update('installed', { receivedBytes: target.size, totalBytes: target.size })
      return { ok: true, pluginId, version, reason: null, error: null }
    } catch (error) {
      const cancelled = controller.signal.aborted
      const { reason, message } = cancelled
        ? { reason: 'cancelled', message: 'Install cancelled' }
        : describeInstallError(error)
      const phase: PluginCatalogInstallPhase = reason === 'cancelled' ? 'cancelled' : 'error'
      update(phase, { error: message })
      if (phase === 'error') {
        logger.warn('[PluginRemoteInstaller] Install failed', {
          pluginId,
          version,
          reason,
          error: message
        })
      }
      return { ok: false, pluginId, version, reason, error: message }
    } finally {
      if (stagingDir) {
        fs.rmSync(stagingDir, { recursive: true, force: true })
      }
    }
  }
}

function describeInstallError(error: unknown): { reason: string; message: string } {
  if (isToolchainDownloadError(error)) {
    return { reason: error.reason, message: error.message }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { reason: 'install_failed', message }
}
