import { spawnSync } from 'node:child_process'
import path from 'node:path'
import logger from '@shared/logger'
import type {
  ResolvedNodeToolchain,
  ResolvedToolchain,
  ResolvedUvToolchain,
  ToolchainKind,
  ToolchainPurpose,
  ToolchainSelection,
  ToolchainSource,
  ToolchainState
} from '@shared/types/toolchains'
import { isNodeVersionInCompatRange, NODE_MODULE_VERSION, NODE_PIN } from './catalog'
import { ToolchainResolutionError } from './errors'
import { bundledKindRoot, managedKindRoot } from './layout'
import {
  probeCustomNode,
  probeCustomUv,
  probeNodeRoot,
  probeSystemNode,
  probeSystemUv,
  probeUvRoot
} from './probe'
import {
  emptyToolchainState,
  loadToolchainState,
  quarantineCorruptState,
  saveToolchainState
} from './stateStore'

export type NodeInspection = {
  version: string
  modules: number
}

export type ToolchainServiceOptions = {
  userDataDir: string
  appPath: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  inspectNode?: (executable: string) => NodeInspection | null
}

export type ResolveOptions = {
  purpose?: ToolchainPurpose
  sourceOverride?: ToolchainSelection
}

const NODE_COMMANDS = new Set(['node', 'npm', 'npx'])
const UV_COMMANDS = new Set(['uv', 'uvx'])

export class ToolchainService {
  private static instance: ToolchainService | null = null

  private readonly platform: NodeJS.Platform
  private readonly env: NodeJS.ProcessEnv
  private readonly inspectNode: (executable: string) => NodeInspection | null
  private state: ToolchainState | null = null
  private readonly resolvedCache = new Map<string, ResolvedToolchain>()
  private readonly inspectionCache = new Map<string, NodeInspection>()

  constructor(private readonly options: ToolchainServiceOptions) {
    this.platform = options.platform ?? process.platform
    this.env = options.env ?? process.env
    this.inspectNode = options.inspectNode ?? ((executable) => inspectNodeExecutable(executable))
  }

  static initialize(options: ToolchainServiceOptions): ToolchainService {
    this.instance = new ToolchainService(options)
    return this.instance
  }

  static getInstance(): ToolchainService {
    if (!this.instance) {
      throw new Error('ToolchainService is not initialized')
    }
    return this.instance
  }

  static resetForTests(): void {
    this.instance = null
  }

  getState(): ToolchainState {
    return structuredClone(this.ensureState())
  }

  detectSystem(kind: ToolchainKind): ResolvedToolchain | null {
    if (kind === 'node') {
      const probed = probeSystemNode(this.env, this.platform)
      return probed.status === 'complete' ? { ...probed.toolchain, source: 'system' } : null
    }
    const probed = probeSystemUv(this.env, this.platform)
    return probed.status === 'complete' ? { ...probed.toolchain, source: 'system' } : null
  }

  setSource(kind: ToolchainKind, selection: ToolchainSelection): ToolchainState {
    this.assertSelection(kind, selection)
    const current = this.ensureState()
    this.persist({
      schemaVersion: 1,
      node: { ...current.node },
      uv: { ...current.uv },
      [kind]: { ...selection }
    })
    return this.getState()
  }

  resolve(kind: 'node', options?: ResolveOptions): ResolvedNodeToolchain
  resolve(kind: 'uv', options?: ResolveOptions): ResolvedUvToolchain
  resolve(kind: ToolchainKind, options?: ResolveOptions): ResolvedToolchain
  resolve(kind: ToolchainKind, options: ResolveOptions = {}): ResolvedToolchain {
    const selection = options.sourceOverride ?? this.ensureState()[kind]
    const cacheKey = `${kind}:${selection.source}:${selection.version ?? ''}:${selection.customPath ?? ''}:${options.purpose ?? ''}`
    const cached = this.resolvedCache.get(cacheKey)
    if (cached) return cached as ResolvedToolchain

    if (selection.source === 'unconfigured') {
      throw new ToolchainResolutionError(
        kind,
        'unconfigured',
        `${kind} toolchain is not configured`
      )
    }

    const resolved =
      kind === 'node' ? this.resolveNode(selection, options.purpose) : this.resolveUv(selection)
    Object.freeze(resolved)
    this.resolvedCache.set(cacheKey, resolved)
    return resolved
  }

  rewriteCommand(command: string, args: string[]): { command: string; args: string[] } {
    return {
      command: this.rewriteToken(command),
      args: args.map((arg) => this.rewriteToken(arg))
    }
  }

  prependResolvedToEnv(env: Record<string, string>): Record<string, string> {
    const binDirs: string[] = []
    for (const kind of ['uv', 'node'] as const) {
      try {
        binDirs.push(this.resolve(kind).binDir)
      } catch {
        // Keep PATH unchanged for kinds that are not configured.
      }
    }
    if (binDirs.length === 0) return { ...env }

    const separator = this.platform === 'win32' ? ';' : ':'
    const next = { ...env }
    const existing = next.PATH || next.Path || this.env.PATH || this.env.Path || this.env.path || ''
    const merged = [...binDirs, ...existing.split(separator).filter(Boolean)]
    const seen = new Set<string>()
    const value = merged
      .filter((entry) => {
        const normalized = this.platform === 'win32' ? entry.toLowerCase() : entry
        if (seen.has(normalized)) return false
        seen.add(normalized)
        return true
      })
      .join(separator)
    next.PATH = value
    if (this.platform === 'win32') next.Path = value
    return next
  }

  private resolveNode(
    selection: ToolchainSelection,
    purpose?: ToolchainPurpose
  ): ResolvedNodeToolchain {
    const probed = this.probeNodeSelection(selection)
    if (probed.status === 'missing') {
      throw new ToolchainResolutionError('node', 'missing', 'Node toolchain is missing')
    }
    if (probed.status === 'incomplete') {
      throw new ToolchainResolutionError(
        'node',
        'incomplete',
        'Node toolchain is missing npm or npx'
      )
    }

    const resolved: ResolvedNodeToolchain = {
      ...probed.toolchain,
      source: selection.source as Exclude<ToolchainSource, 'unconfigured'>
    }
    this.fillNodeIdentity(resolved, selection)

    if (purpose === 'ocr') {
      if (!resolved.version || !isNodeVersionInCompatRange(resolved.version)) {
        throw new ToolchainResolutionError(
          'node',
          'version_mismatch',
          'Node version is outside the OCR compatibility range'
        )
      }
      if (resolved.nodeModuleVersion !== NODE_MODULE_VERSION) {
        throw new ToolchainResolutionError(
          'node',
          'abi_mismatch',
          'Node ABI is not the official OCR-validated module version'
        )
      }
    }

    return resolved
  }

  private resolveUv(selection: ToolchainSelection): ResolvedUvToolchain {
    const probed = this.probeUvSelection(selection)
    if (probed.status === 'missing') {
      throw new ToolchainResolutionError('uv', 'missing', 'uv toolchain is missing')
    }
    if (probed.status === 'incomplete') {
      throw new ToolchainResolutionError('uv', 'incomplete', 'uv toolchain is missing uvx')
    }
    return {
      ...probed.toolchain,
      source: selection.source as Exclude<ToolchainSource, 'unconfigured'>
    }
  }

  private probeNodeSelection(selection: ToolchainSelection) {
    switch (selection.source) {
      case 'bundled':
        return probeNodeRoot(bundledKindRoot(this.options.appPath, 'node'), this.platform, false)
      case 'managed':
        return probeNodeRoot(
          managedKindRoot(this.options.userDataDir, 'node', selection.version ?? ''),
          this.platform,
          true
        )
      case 'system':
        return probeSystemNode(this.env, this.platform)
      case 'custom':
        return probeCustomNode(selection.customPath ?? '', this.platform)
      default:
        return { status: 'missing' as const }
    }
  }

  private probeUvSelection(selection: ToolchainSelection) {
    switch (selection.source) {
      case 'bundled':
        return probeUvRoot(bundledKindRoot(this.options.appPath, 'uv'), this.platform)
      case 'managed':
        return probeUvRoot(
          managedKindRoot(this.options.userDataDir, 'uv', selection.version ?? ''),
          this.platform
        )
      case 'system':
        return probeSystemUv(this.env, this.platform)
      case 'custom':
        return probeCustomUv(selection.customPath ?? '', this.platform)
      default:
        return { status: 'missing' as const }
    }
  }

  private fillNodeIdentity(resolved: ResolvedNodeToolchain, selection: ToolchainSelection): void {
    if (selection.source === 'bundled') {
      resolved.version = NODE_PIN
      resolved.nodeModuleVersion = NODE_MODULE_VERSION
      return
    }
    if (selection.source === 'managed' && selection.version) {
      resolved.version = selection.version.startsWith('v')
        ? selection.version
        : `v${selection.version}`
    }

    const inspected =
      this.inspectionCache.get(resolved.node) ?? this.inspectNode(resolved.node) ?? null
    if (inspected) {
      this.inspectionCache.set(resolved.node, inspected)
      resolved.version = inspected.version
      resolved.nodeModuleVersion = inspected.modules
    }
  }

  private rewriteToken(token: string): string {
    const command = toolchainCommandName(token, this.platform)
    if (!command) return token
    if (NODE_COMMANDS.has(command)) {
      const resolved = this.resolve('node')
      if (command === 'npm') return resolved.npm
      if (command === 'npx') return resolved.npx
      return resolved.node
    }
    if (UV_COMMANDS.has(command)) {
      const resolved = this.resolve('uv')
      return command === 'uvx' ? resolved.uvx : resolved.uv
    }
    return token
  }

  private ensureState(): ToolchainState {
    if (this.state) return this.state
    try {
      this.state = loadToolchainState(this.options.userDataDir)
    } catch (error) {
      logger.warn('[ToolchainService] Quarantining unreadable toolchain state', error)
      quarantineCorruptState(this.options.userDataDir)
      this.state = null
    }
    if (!this.state) {
      this.state = this.migrateFirstRun()
      this.persist(this.state)
    }
    return this.state
  }

  private migrateFirstRun(): ToolchainState {
    const state = emptyToolchainState()
    const bundledNode = probeNodeRoot(
      bundledKindRoot(this.options.appPath, 'node'),
      this.platform,
      false
    )
    if (bundledNode.status === 'complete') {
      state.node = { source: 'bundled' }
    } else if (probeSystemNode(this.env, this.platform).status === 'complete') {
      state.node = { source: 'system' }
    }

    const bundledUv = probeUvRoot(bundledKindRoot(this.options.appPath, 'uv'), this.platform)
    if (bundledUv.status === 'complete') {
      state.uv = { source: 'bundled' }
    } else if (probeSystemUv(this.env, this.platform).status === 'complete') {
      state.uv = { source: 'system' }
    }
    return state
  }

  private persist(state: ToolchainState): void {
    saveToolchainState(this.options.userDataDir, state)
    this.state = state
    this.resolvedCache.clear()
  }

  private assertSelection(kind: ToolchainKind, selection: ToolchainSelection): void {
    if (selection.source === 'managed' && !selection.version) {
      throw new ToolchainResolutionError(kind, 'path_invalid', 'Managed source requires a version')
    }
    if (selection.source === 'custom') {
      const customPath = selection.customPath
      if (!customPath || !path.isAbsolute(customPath) || customPath.includes('\0')) {
        throw new ToolchainResolutionError(kind, 'path_invalid', 'Custom source path is invalid')
      }
    }
  }
}

export function inspectNodeExecutable(executable: string): NodeInspection | null {
  const result = spawnSync(
    executable,
    ['-p', 'JSON.stringify({v:process.version,m:Number(process.versions.modules)})'],
    { encoding: 'utf8', timeout: 5000, windowsHide: true }
  )
  if (result.status !== 0 || !result.stdout) return null
  try {
    const parsed = JSON.parse(result.stdout) as { v?: unknown; m?: unknown }
    if (
      typeof parsed.v !== 'string' ||
      typeof parsed.m !== 'number' ||
      !Number.isFinite(parsed.m)
    ) {
      return null
    }
    return { version: parsed.v, modules: parsed.m }
  } catch {
    return null
  }
}

function toolchainCommandName(token: string, platform: NodeJS.Platform): string | null {
  const basename = path.basename(token)
  if (!basename) return null
  const normalized =
    platform === 'win32' ? basename.toLowerCase().replace(/\.(exe|cmd|bat)$/i, '') : basename
  if (NODE_COMMANDS.has(normalized) || UV_COMMANDS.has(normalized)) return normalized
  return null
}
