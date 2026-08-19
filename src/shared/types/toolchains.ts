export const TOOLCHAIN_KINDS = ['node', 'uv'] as const
export type ToolchainKind = (typeof TOOLCHAIN_KINDS)[number]

export const TOOLCHAIN_SOURCES = ['bundled', 'managed', 'system', 'custom', 'unconfigured'] as const
export type ToolchainSource = (typeof TOOLCHAIN_SOURCES)[number]

export const TOOLCHAIN_PURPOSES = ['ocr', 'mcp', 'acp', 'skill', 'generic'] as const
export type ToolchainPurpose = (typeof TOOLCHAIN_PURPOSES)[number]

export const TOOLCHAIN_RESOLVE_REASONS = [
  'unconfigured',
  'missing',
  'incomplete',
  'version_mismatch',
  'abi_mismatch',
  'path_invalid',
  'unsupported_platform',
  'transient'
] as const
export type ToolchainResolveReason = (typeof TOOLCHAIN_RESOLVE_REASONS)[number]

export interface ToolchainSelection {
  source: ToolchainSource
  version?: string
  customPath?: string
  explicit?: boolean
}

export interface ToolchainState {
  schemaVersion: 1
  node: ToolchainSelection
  uv: ToolchainSelection
}

export type ToolchainPersistedState = {
  schemaVersion: 1
  node?: ToolchainSelection
  uv?: ToolchainSelection
}

export interface ResolvedNodeToolchain {
  kind: 'node'
  source: Exclude<ToolchainSource, 'unconfigured'>
  version: string | null
  nodeModuleVersion: number | null
  rootDir: string
  binDir: string
  node: string
  npm: string
  npx: string
  corepack: string | null
}

export interface ResolvedUvToolchain {
  kind: 'uv'
  source: Exclude<ToolchainSource, 'unconfigured'>
  version: string | null
  rootDir: string
  binDir: string
  uv: string
  uvx: string
}

export type ResolvedToolchain = ResolvedNodeToolchain | ResolvedUvToolchain

export const TOOLCHAIN_DOWNLOAD_REASONS = [
  'dns',
  'timeout',
  'http',
  'proxy',
  'checksum_mismatch',
  'disk',
  'cancelled',
  'activation_failed',
  'unsupported_platform'
] as const
export type ToolchainDownloadReason = (typeof TOOLCHAIN_DOWNLOAD_REASONS)[number]

export const TOOLCHAIN_INSTALL_PHASES = [
  'idle',
  'probing',
  'downloading',
  'verifying',
  'extracting',
  'activating'
] as const
export type ToolchainInstallPhase = (typeof TOOLCHAIN_INSTALL_PHASES)[number]

export interface ToolchainInstallProgress {
  kind: ToolchainKind
  phase: ToolchainInstallPhase
  receivedBytes: number
  totalBytes: number | null
  error: ToolchainDownloadReason | null
}

export interface ToolchainSystemPresence {
  path: string
  version: string | null
}

export interface ToolchainKindStatus {
  kind: ToolchainKind
  selection: ToolchainSelection
  derived: boolean
  availability: 'ready' | 'missing' | 'incomplete' | 'unconfigured'
  reason: ToolchainResolveReason | null
  resolvedVersion: string | null
  resolvedPath: string | null
  bundledAvailable: boolean
  managedAvailable: boolean
  system: ToolchainSystemPresence | null
  install: ToolchainInstallProgress | null
  ocrCompatible: boolean | null
}

export interface ToolchainMissingNotice {
  kind: ToolchainKind
  reason: ToolchainResolveReason
}

export interface ToolchainStatusSnapshot {
  node: ToolchainKindStatus
  uv: ToolchainKindStatus
  missing: ToolchainMissingNotice[]
}
