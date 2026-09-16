import logger from '@shared/logger'
import fs from 'node:fs'
import path from 'node:path'
import compareVersions from 'compare-versions'
import { parsePluginCatalog } from '@shared/contracts/routes'
import type {
  PluginCatalog,
  PluginCatalogArtifact,
  PluginCatalogTarget,
  RuntimeCatalogAsset
} from '@shared/types/pluginCatalog'

export const PLUGIN_CATALOG_OVERRIDE_ENV = 'DEEPCHAT_PLUGIN_CATALOG'
export const PLUGIN_CATALOG_FILE_NAME = 'plugin-catalog.json'
export const LIGHT_OCR_RUNTIME_ASSET_ID = 'light-ocr'

export type PluginCatalogResolution = {
  artifact: PluginCatalogArtifact
  target: PluginCatalogTarget
}

export type RuntimeAssetResolution = {
  asset: RuntimeCatalogAsset
  target: PluginCatalogTarget
}

export type CatalogEntryAvailability = 'available' | 'incompatible-app' | 'unsupported-platform'

export type PluginCatalogServiceDeps = {
  appPath?: string
  resourcesPath?: string
  isPackaged?: boolean
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  appVersion?: string
  env?: NodeJS.ProcessEnv
}

const EMPTY_CATALOG: PluginCatalog = { schemaVersion: 1, artifacts: [] }

/**
 * Loads the static plugin distribution catalog and resolves per-platform
 * artifacts. Stable packaged builds only resolve `stable` channel entries;
 * dev builds also resolve `pre-release` entries for staging tests.
 */
export class PluginCatalogService {
  private readonly appPath?: string
  private readonly resourcesPath?: string
  private readonly isPackaged: boolean
  private readonly platform: NodeJS.Platform
  private readonly arch: NodeJS.Architecture
  private readonly appVersion: string
  private readonly env: NodeJS.ProcessEnv
  private catalog: PluginCatalog | null = null

  constructor(deps: PluginCatalogServiceDeps = {}) {
    this.appPath = deps.appPath
    this.resourcesPath = deps.resourcesPath
    this.isPackaged = deps.isPackaged ?? false
    this.platform = deps.platform ?? process.platform
    this.arch = deps.arch ?? process.arch
    this.appVersion = deps.appVersion ?? '0.0.0'
    this.env = deps.env ?? process.env
  }

  getCatalog(): PluginCatalog {
    if (this.catalog) return this.catalog
    this.catalog = this.loadCatalog()
    return this.catalog
  }

  reload(): PluginCatalog {
    this.catalog = this.loadCatalog()
    return this.catalog
  }

  private loadCatalog(): PluginCatalog {
    const catalogPath = this.resolveCatalogPath()
    if (!catalogPath) {
      return EMPTY_CATALOG
    }
    if (!fs.existsSync(catalogPath)) {
      // A missing catalog is a valid state: no remotely distributable plugins.
      return EMPTY_CATALOG
    }
    try {
      return parsePluginCatalog(
        JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as unknown,
        catalogPath
      )
    } catch (error) {
      logger.error('[PluginCatalog] Failed to load plugin catalog', {
        catalogPath,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  private resolveCatalogPath(): string | undefined {
    // Dev/test override. Never honored in packaged builds so a user-set env
    // cannot redirect artifact downloads in production.
    const override = this.env[PLUGIN_CATALOG_OVERRIDE_ENV]
    if (override && !this.isPackaged) {
      return path.resolve(override)
    }
    if (this.isPackaged) {
      return this.resourcesPath
        ? path.join(this.resourcesPath, PLUGIN_CATALOG_FILE_NAME)
        : undefined
    }
    return this.appPath ? path.join(this.appPath, 'resources', PLUGIN_CATALOG_FILE_NAME) : undefined
  }

  /**
   * All artifacts visible to this build (channel filtered) with availability
   * for the current platform/arch/app version.
   */
  listVisibleArtifacts(): PluginCatalogArtifact[] {
    return this.getCatalog().artifacts.filter((artifact) => this.isChannelVisible(artifact.channel))
  }

  resolveArtifact(pluginId: string): PluginCatalogResolution | null {
    const artifact = this.listVisibleArtifacts().find(
      (candidate) => candidate.pluginId === pluginId
    )
    if (!artifact) return null
    const target = this.resolveTarget(artifact.targets, artifact.minAppVersion)
    return target ? { artifact, target } : null
  }

  listVisibleRuntimeAssets(): RuntimeCatalogAsset[] {
    return (this.getCatalog().runtimeAssets ?? []).filter((asset) =>
      this.isChannelVisible(asset.channel)
    )
  }

  resolveRuntimeAsset(assetId: string): RuntimeAssetResolution | null {
    const asset = this.listVisibleRuntimeAssets().find((candidate) => candidate.id === assetId)
    if (!asset) return null
    const target = this.resolveTarget(asset.targets, asset.minAppVersion)
    return target ? { asset, target } : null
  }

  describeRuntimeAssetAvailability(asset: RuntimeCatalogAsset): {
    availability: CatalogEntryAvailability
    target: PluginCatalogTarget | null
  } {
    return this.describeTargetAvailability(asset.targets, asset.minAppVersion)
  }

  private resolveTarget(
    targets: PluginCatalogTarget[],
    minAppVersion: string | undefined
  ): PluginCatalogTarget | null {
    const target = targets.find(
      (candidate) => candidate.platform === this.platform && candidate.arch === this.arch
    )
    if (!target) return null
    if (!this.satisfiesAppVersion(minAppVersion)) return null
    return target
  }

  describeAvailability(artifact: PluginCatalogArtifact): {
    availability: CatalogEntryAvailability
    target: PluginCatalogTarget | null
  } {
    return this.describeTargetAvailability(artifact.targets, artifact.minAppVersion)
  }

  private describeTargetAvailability(
    targets: PluginCatalogTarget[],
    minAppVersion: string | undefined
  ): {
    availability: CatalogEntryAvailability
    target: PluginCatalogTarget | null
  } {
    const target =
      targets.find(
        (candidate) => candidate.platform === this.platform && candidate.arch === this.arch
      ) ?? null
    if (!target) {
      return { availability: 'unsupported-platform', target: null }
    }
    if (!this.satisfiesAppVersion(minAppVersion)) {
      return { availability: 'incompatible-app', target }
    }
    return { availability: 'available', target }
  }

  private isChannelVisible(channel: PluginCatalog['artifacts'][number]['channel']): boolean {
    if (channel === 'stable') return true
    return !this.isPackaged
  }

  private satisfiesAppVersion(minAppVersion: string | undefined): boolean {
    if (!minAppVersion) return true
    try {
      return compareVersions.compare(this.appVersion, minAppVersion, '>=')
    } catch {
      logger.warn('[PluginCatalog] Invalid minAppVersion in catalog', { minAppVersion })
      return false
    }
  }
}
