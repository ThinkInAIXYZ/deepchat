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
  'unsupported_platform'
] as const
export type ToolchainResolveReason = (typeof TOOLCHAIN_RESOLVE_REASONS)[number]

export interface ToolchainSelection {
  source: ToolchainSource
  version?: string
  customPath?: string
}

export interface ToolchainState {
  schemaVersion: 1
  node: ToolchainSelection
  uv: ToolchainSelection
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
