import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import logger from '@shared/logger'
import type {
  ResolvedNodeToolchain,
  ResolvedToolchain,
  ResolvedUvToolchain,
  ToolchainInstallProgress,
  ToolchainKind,
  ToolchainKindStatus,
  ToolchainMissingNotice,
  ToolchainPurpose,
  ToolchainResolveReason,
  ToolchainSelection,
  ToolchainSource,
  ToolchainState,
  ToolchainStatusSnapshot
} from '@shared/types/toolchains'
import {
  catalogVersionFor,
  isNodeVersionInCompatRange,
  NODE_MODULE_VERSION,
  NODE_PIN,
  resolveToolchainArtifact
} from './catalog'
import { downloadVerifiedFile, selectDownloadUrl, type FetchLike } from './downloader'
import {
  classifyDownloadError,
  isToolchainDownloadError,
  isToolchainResolutionError,
  ToolchainDownloadError,
  ToolchainResolutionError
} from './errors'
import {
  extractArchive,
  replaceDirectory,
  takeExtractedRoot,
  type ArchiveExtractor
} from './extract'
import {
  assertSafeToolchainVersion,
  bundledKindRoot,
  downloadStagingDir,
  gcRetiredToolchainTrees,
  managedKindRoot
} from './layout'
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
  arch?: string
  env?: NodeJS.ProcessEnv
  inspectNode?: (executable: string) => NodeInspection | null | undefined
  fetch?: FetchLike
  extractArchive?: ArchiveExtractor
  removeTree?: (directory: string) => void
  mirrorUrl?: string
  onProgress?: (progress: ToolchainInstallProgress) => void
  onMissing?: (missing: ToolchainMissingNotice[]) => void
}

export type ResolveOptions = {
  purpose?: ToolchainPurpose
  sourceOverride?: ToolchainSelection
}

const NODE_COMMANDS = new Set(['node', 'npm', 'npx', 'corepack'])
const UV_COMMANDS = new Set(['uv', 'uvx'])

export class ToolchainService {
  private static instance: ToolchainService | null = null

  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private env: NodeJS.ProcessEnv
  private readonly fetchImpl: FetchLike
  private readonly extract: ArchiveExtractor
  private state: ToolchainState | null = null
  private readonly resolvedCache = new Map<string, ResolvedToolchain>()
  private readonly inspectionCache = new Map<string, NodeInspection | null>()
  private readonly missing = new Map<string, ToolchainResolveReason>()
  private readonly progress = new Map<ToolchainKind, ToolchainInstallProgress>()
  private readonly inflight = new Map<ToolchainKind, Promise<void>>()
  private readonly controllers = new Map<ToolchainKind, AbortController>()

  constructor(private readonly options: ToolchainServiceOptions) {
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.env = options.env ?? process.env
    this.fetchImpl = options.fetch ?? fetch
    this.extract = options.extractArchive ?? extractArchive
    gcRetiredToolchainTrees(options.userDataDir)
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

  updateDetectionEnv(env: NodeJS.ProcessEnv): void {
    this.env = env
    this.invalidateAndReevaluate()
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
    const next = this.normalizeSelection(kind, selection)
    this.assertSelection(kind, next)
    const current = this.ensureState()
    this.persist({
      schemaVersion: 1,
      node: { ...current.node },
      uv: { ...current.uv },
      [kind]: { ...next }
    })
    if (next.source === 'unconfigured') {
      this.recordMissing(kind, undefined, 'unconfigured')
    } else {
      this.clearAllMissing(kind)
    }
    return this.getState()
  }

  getStatus(): ToolchainStatusSnapshot {
    return {
      node: this.inspectKind('node'),
      uv: this.inspectKind('uv'),
      missing: this.collectMissing()
    }
  }

  async install(kind: ToolchainKind): Promise<ToolchainState> {
    await this.runExclusive(kind, () => this.installManaged(kind))
    return this.getState()
  }

  async repair(kind: ToolchainKind): Promise<ToolchainState> {
    await this.runExclusive(kind, async () => {
      if (this.ensureState()[kind].source !== 'managed') {
        throw new ToolchainResolutionError(
          kind,
          'path_invalid',
          'Repair is only available for a managed toolchain'
        )
      }
      await this.installManaged(kind)
    })
    return this.getState()
  }

  revert(kind: ToolchainKind): ToolchainState {
    const bundled =
      kind === 'node'
        ? probeNodeRoot(bundledKindRoot(this.options.appPath, 'node'), this.platform, false)
        : probeUvRoot(bundledKindRoot(this.options.appPath, 'uv'), this.platform)
    if (bundled.status === 'complete') {
      return this.setSource(kind, { source: 'bundled' })
    }
    return this.setSource(kind, { source: 'unconfigured' })
  }

  cancelInstall(kind: ToolchainKind): void {
    this.controllers.get(kind)?.abort()
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
      const error = new ToolchainResolutionError(
        kind,
        'unconfigured',
        `${kind} toolchain is not configured`
      )
      this.recordMissing(kind, options.purpose, error.reason)
      throw error
    }

    try {
      const resolved =
        kind === 'node' ? this.resolveNode(selection, options.purpose) : this.resolveUv(selection)
      Object.freeze(resolved)
      this.resolvedCache.set(cacheKey, resolved)
      this.clearMissing(kind, options.purpose)
      return resolved
    } catch (error) {
      if (isToolchainResolutionError(error)) {
        logger.warn('[ToolchainService] Resolve failed', {
          kind,
          purpose: options.purpose ?? 'generic',
          reason: error.reason
        })
        this.recordMissing(kind, options.purpose, error.reason)
      }
      throw error
    }
  }

  rewriteCommand(command: string, args: string[]): { command: string; args: string[] } {
    return {
      command: this.rewriteToken(command),
      args
    }
  }

  prependResolvedToEnv(env: Record<string, string>): Record<string, string> {
    const binDirs: string[] = []
    for (const kind of ['uv', 'node'] as const) {
      if (this.ensureState()[kind].source === 'unconfigured') continue
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
          managedKindRoot(
            this.options.userDataDir,
            'node',
            selection.version || catalogVersionFor('node')
          ),
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
          managedKindRoot(
            this.options.userDataDir,
            'uv',
            selection.version || catalogVersionFor('uv')
          ),
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

    if (this.inspectionCache.has(resolved.node)) {
      const cached = this.inspectionCache.get(resolved.node)
      if (cached) {
        resolved.version = cached.version
        resolved.nodeModuleVersion = cached.modules
      }
      return
    }
    const inspected = this.inspectNodeForCache(resolved.node)
    if (inspected === undefined) return
    this.inspectionCache.set(resolved.node, inspected)
    if (inspected) {
      resolved.version = inspected.version
      resolved.nodeModuleVersion = inspected.modules
    }
  }

  private inspectNodeForCache(executable: string): NodeInspection | null | undefined {
    if (this.options.inspectNode) return this.options.inspectNode(executable)
    const result = inspectNodeExecutableResult(executable)
    return result.retryable ? undefined : result.inspection
  }

  private rewriteToken(token: string): string {
    const command = toolchainCommandName(token, this.platform)
    if (!command) return token
    if (NODE_COMMANDS.has(command)) {
      const resolved = this.resolve('node')
      if (command === 'npm') return resolved.npm
      if (command === 'npx') return resolved.npx
      if (command === 'corepack') return resolved.corepack ?? token
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

  private invalidateAndReevaluate(): void {
    this.resolvedCache.clear()
    this.inspectionCache.clear()
    if (this.state?.provisional) {
      this.persist(this.migrateFirstRun())
    }
    this.recomputeMissing()
  }

  private recomputeMissing(): void {
    const pending = [...this.missing.keys()]
    this.missing.clear()
    for (const key of pending) {
      const [kind, purpose] = key.split(':') as [ToolchainKind, string]
      try {
        this.resolve(kind, {
          purpose: purpose === 'generic' ? undefined : (purpose as ToolchainPurpose)
        })
      } catch {
        // resolve() records typed missing notices.
      }
    }
    this.emitMissing()
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
    state.provisional = true
    return state
  }

  private persist(state: ToolchainState): void {
    saveToolchainState(this.options.userDataDir, state)
    this.state = state
    this.resolvedCache.clear()
    this.inspectionCache.clear()
  }

  private async runExclusive(kind: ToolchainKind, operation: () => Promise<void>): Promise<void> {
    const existing = this.inflight.get(kind)
    if (existing) {
      await existing
      return
    }
    const task = operation()
    this.inflight.set(kind, task)
    try {
      await task
    } finally {
      this.inflight.delete(kind)
      this.controllers.delete(kind)
    }
  }

  private async installManaged(kind: ToolchainKind): Promise<void> {
    let artifact
    try {
      artifact = resolveToolchainArtifact(kind, this.platform, this.arch)
    } catch {
      this.setProgress(kind, 'idle', { error: 'unsupported_platform' })
      throw new ToolchainDownloadError(
        'unsupported_platform',
        `${kind} has no official artifact for ${this.platform}-${this.arch}`
      )
    }

    const controller = new AbortController()
    this.controllers.set(kind, controller)
    const stagingDir = downloadStagingDir(this.options.userDataDir, kind, artifact.version)
    const archivePath = path.join(stagingDir, artifact.filename)
    const extractDir = path.join(stagingDir, 'extract')
    const managedDir = managedKindRoot(this.options.userDataDir, kind, artifact.version)

    try {
      this.setProgress(kind, 'probing')
      const url = await selectDownloadUrl(artifact.officialUrl, this.fetchImpl, {
        mirrorUrl: this.options.mirrorUrl,
        signal: controller.signal,
        allowProbe: true
      })

      this.setProgress(kind, 'downloading')
      await downloadVerifiedFile({
        url,
        destPath: archivePath,
        sha256: artifact.sha256,
        fetch: this.fetchImpl,
        signal: controller.signal,
        onProgress: (progress) =>
          this.setProgress(kind, 'downloading', {
            receivedBytes: progress.receivedBytes,
            totalBytes: progress.totalBytes
          })
      })

      this.setProgress(kind, 'verifying')
      rmSync(extractDir, { recursive: true, force: true })
      this.setProgress(kind, 'extracting')
      await this.extract(archivePath, extractDir)

      const payloadRoot = takeExtractedRoot(extractDir, this.platform)
      const complete =
        kind === 'node'
          ? probeNodeRoot(payloadRoot, this.platform, true)
          : probeUvRoot(payloadRoot, this.platform)
      if (complete.status !== 'complete') {
        throw new ToolchainDownloadError(
          'activation_failed',
          `${kind} archive is missing required binaries`
        )
      }

      this.setProgress(kind, 'activating')
      replaceDirectory(payloadRoot, managedDir)
      this.setSource(kind, { source: 'managed', version: artifact.version })
      this.setProgress(kind, 'idle')
    } catch (error) {
      const classified = isToolchainDownloadError(error) ? error : classifyDownloadError(error)
      logger.warn('[ToolchainService] Install failed', { kind, reason: classified.reason })
      this.setProgress(kind, 'idle', { error: classified.reason })
      throw classified
    }
    this.removeTreeBestEffort(stagingDir, kind)
  }

  private removeTreeBestEffort(directory: string, kind: ToolchainKind): void {
    try {
      if (this.options.removeTree) this.options.removeTree(directory)
      else rmSync(directory, { recursive: true, force: true })
    } catch (error) {
      logger.warn('[ToolchainService] Staging cleanup failed', { kind, error })
    }
  }

  private inspectKind(kind: ToolchainKind): ToolchainKindStatus {
    const selection = this.ensureState()[kind]
    const bundled =
      kind === 'node'
        ? probeNodeRoot(bundledKindRoot(this.options.appPath, 'node'), this.platform, false)
        : probeUvRoot(bundledKindRoot(this.options.appPath, 'uv'), this.platform)
    const managedVersion =
      selection.source === 'managed' ? selection.version : catalogVersionFor(kind)
    const managed =
      kind === 'node'
        ? probeNodeRoot(
            managedKindRoot(this.options.userDataDir, 'node', managedVersion ?? ''),
            this.platform,
            true
          )
        : probeUvRoot(
            managedKindRoot(this.options.userDataDir, 'uv', managedVersion ?? ''),
            this.platform
          )
    const system = this.detectSystem(kind)
    let availability: ToolchainKindStatus['availability'] = 'unconfigured'
    let reason: ToolchainResolveReason | null = null
    let resolvedVersion: string | null = null
    let resolvedPath: string | null = null

    if (selection.source !== 'unconfigured') {
      const probed =
        kind === 'node' ? this.probeNodeSelection(selection) : this.probeUvSelection(selection)
      if (probed.status === 'complete') {
        availability = 'ready'
        if (kind === 'node') {
          const resolved = {
            ...probed.toolchain,
            source: selection.source
          } as ResolvedNodeToolchain
          this.fillNodeIdentity(resolved, selection)
          resolvedVersion = resolved.version
          resolvedPath = resolved.node
        } else if (probed.toolchain.kind === 'uv') {
          resolvedVersion = selection.version ?? probed.toolchain.version
          resolvedPath = probed.toolchain.uv
        }
      } else {
        availability = probed.status
        reason = probed.status
      }
    }

    return {
      kind,
      selection,
      availability,
      reason,
      resolvedVersion,
      resolvedPath,
      bundledAvailable: bundled.status === 'complete',
      managedAvailable: managed.status === 'complete',
      system: system
        ? {
            path: system.kind === 'node' ? system.node : system.uv,
            version: system.kind === 'node' ? this.peekNodeVersion(system) : system.version
          }
        : null,
      install: this.progress.get(kind) ?? null
    }
  }

  private setProgress(
    kind: ToolchainKind,
    phase: ToolchainInstallProgress['phase'],
    extras?: Partial<Pick<ToolchainInstallProgress, 'receivedBytes' | 'totalBytes' | 'error'>>
  ): void {
    const current = this.progress.get(kind)
    const next: ToolchainInstallProgress = {
      kind,
      phase,
      receivedBytes:
        extras?.receivedBytes ?? (phase === 'downloading' ? (current?.receivedBytes ?? 0) : 0),
      totalBytes:
        extras?.totalBytes ?? (phase === 'downloading' ? (current?.totalBytes ?? null) : null),
      error: extras?.error ?? null
    }
    this.progress.set(kind, next)
    this.options.onProgress?.(next)
  }

  private peekNodeVersion(resolved: ResolvedNodeToolchain): string | null {
    this.fillNodeIdentity(resolved, { source: resolved.source })
    return resolved.version
  }

  private missingKey(kind: ToolchainKind, purpose?: ToolchainPurpose): string {
    return `${kind}:${purpose ?? 'generic'}`
  }

  private recordMissing(
    kind: ToolchainKind,
    purpose: ToolchainPurpose | undefined,
    reason: ToolchainResolveReason
  ): void {
    this.missing.set(this.missingKey(kind, purpose), reason)
    this.emitMissing()
  }

  private clearMissing(kind: ToolchainKind, purpose?: ToolchainPurpose): void {
    if (this.missing.delete(this.missingKey(kind, purpose))) {
      this.emitMissing()
    }
  }

  private clearAllMissing(kind: ToolchainKind): void {
    let changed = false
    for (const key of this.missing.keys()) {
      if (key.startsWith(`${kind}:`)) {
        this.missing.delete(key)
        changed = true
      }
    }
    if (changed) this.emitMissing()
  }

  private collectMissing(): ToolchainMissingNotice[] {
    const rank: Record<ToolchainResolveReason, number> = {
      unconfigured: 1,
      missing: 2,
      path_invalid: 2,
      incomplete: 3,
      unsupported_platform: 3,
      version_mismatch: 4,
      abi_mismatch: 5
    }
    const byKind = new Map<ToolchainKind, ToolchainResolveReason>()
    for (const [key, reason] of this.missing) {
      const kind = key.split(':')[0] as ToolchainKind
      const current = byKind.get(kind)
      if (!current || rank[reason] > rank[current]) {
        byKind.set(kind, reason)
      }
    }
    return [...byKind.entries()].map(([kind, reason]) => ({ kind, reason }))
  }

  private emitMissing(): void {
    this.options.onMissing?.(this.collectMissing())
  }

  private normalizeSelection(
    kind: ToolchainKind,
    selection: ToolchainSelection
  ): ToolchainSelection {
    if (selection.source !== 'managed') return selection
    return {
      ...selection,
      version: assertSafeToolchainVersion(selection.version || catalogVersionFor(kind))
    }
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
  return inspectNodeExecutableResult(executable).inspection
}

export function inspectNodeExecutableResult(
  executable: string,
  timeout = 5000
): {
  inspection: NodeInspection | null
  retryable: boolean
} {
  const result = spawnSync(
    executable,
    ['-p', 'JSON.stringify({v:process.version,m:Number(process.versions.modules)})'],
    { encoding: 'utf8', timeout, windowsHide: true }
  )
  if (isRetryableInspectFailure(result)) {
    return { inspection: null, retryable: true }
  }
  if (result.status !== 0 || !result.stdout) return { inspection: null, retryable: false }
  try {
    const parsed = JSON.parse(result.stdout) as { v?: unknown; m?: unknown }
    if (
      typeof parsed.v !== 'string' ||
      typeof parsed.m !== 'number' ||
      !Number.isFinite(parsed.m)
    ) {
      return { inspection: null, retryable: false }
    }
    return { inspection: { version: parsed.v, modules: parsed.m }, retryable: false }
  } catch {
    return { inspection: null, retryable: false }
  }
}

function isRetryableInspectFailure(result: ReturnType<typeof spawnSync>): boolean {
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ETIMEDOUT' || result.signal === 'SIGTERM' || result.signal === 'SIGKILL'
}

function toolchainCommandName(token: string, platform: NodeJS.Platform): string | null {
  const basename = path.basename(token)
  if (!basename) return null
  const normalized =
    platform === 'win32' ? basename.toLowerCase().replace(/\.(exe|cmd|bat)$/i, '') : basename
  if (NODE_COMMANDS.has(normalized) || UV_COMMANDS.has(normalized)) return normalized
  return null
}
