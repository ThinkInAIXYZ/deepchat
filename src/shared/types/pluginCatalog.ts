export type PluginCatalogChannel = 'stable' | 'pre-release'

export interface PluginCatalogTarget {
  platform: string
  arch: string
  url: string
  sha256: string
  size: number
  mirrors: string[]
}

export interface PluginCatalogArtifact {
  pluginId: string
  version: string
  channel: PluginCatalogChannel
  displayName?: string
  description?: string
  minAppVersion?: string
  targets: PluginCatalogTarget[]
}

export interface PluginCatalog {
  schemaVersion: 1
  artifacts: PluginCatalogArtifact[]
  runtimeAssets?: RuntimeCatalogAsset[]
}

export interface RuntimeCatalogAsset {
  id: string
  version: string
  channel: PluginCatalogChannel
  displayName?: string
  description?: string
  minAppVersion?: string
  targets: PluginCatalogTarget[]
}

export type RuntimeAssetInstallPhase =
  | 'idle'
  | 'probing'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'installed'
  | 'error'
  | 'cancelled'

export interface RuntimeAssetInstallState {
  assetId: string
  version: string
  phase: RuntimeAssetInstallPhase
  receivedBytes: number
  totalBytes: number | null
  error: string | null
  updatedAt: number
}

export type RuntimeAssetAvailability = 'available' | 'incompatible-app' | 'unsupported-platform'

export interface RuntimeAssetCatalogEntry {
  assetId: string
  version: string
  channel: PluginCatalogChannel
  displayName?: string
  description?: string
  availability: RuntimeAssetAvailability
  sizeBytes: number | null
  installState: RuntimeAssetInstallState | null
}

export type PluginCatalogInstallPhase =
  | 'idle'
  | 'probing'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'installed'
  | 'error'
  | 'cancelled'

export interface PluginCatalogInstallState {
  pluginId: string
  version: string
  phase: PluginCatalogInstallPhase
  receivedBytes: number
  totalBytes: number | null
  error: string | null
  updatedAt: number
}

export type PluginCatalogAvailability = 'available' | 'incompatible-app' | 'unsupported-platform'

export interface PluginCatalogEntry {
  pluginId: string
  version: string
  channel: PluginCatalogChannel
  displayName?: string
  description?: string
  availability: PluginCatalogAvailability
  sizeBytes: number | null
  installed: boolean
  installedVersion: string | null
  installState: PluginCatalogInstallState | null
}
