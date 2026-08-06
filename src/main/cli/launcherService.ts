import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'

export type CliLauncherState =
  | 'not-installed'
  | 'installed'
  | 'stale'
  | 'needs-repair'
  | 'conflict'
  | 'unavailable'

export type CliLauncherReason =
  | 'unsupported-platform'
  | 'source-missing'
  | 'path-unavailable'
  | 'ownership-marker-invalid'
  | 'unowned-command'
  | 'command-modified'
  | 'command-missing'
  | 'shell-config-modified'
  | 'shell-config-too-large'
  | 'shell-config-missing'
  | 'upgrade-required'

export type CliLauncherStatus = Readonly<{
  state: CliLauncherState
  reason: CliLauncherReason | null
  commandPath: string | null
  shellConfigPath: string | null
}>

const LAUNCHER_MARKER_VERSION = 1
const LAUNCHER_MARKER_FILENAME = 'launcher.json'
const MANAGED_BLOCK_START = '# >>> DeepChat CLI >>>'
const MANAGED_BLOCK_END = '# <<< DeepChat CLI <<<'
const MAX_MARKER_BYTES = 16 * 1024
const MAX_SHELL_CONFIG_BYTES = 1024 * 1024

type PosixProfileKind = 'zsh' | 'bash' | 'bash-login' | 'fish' | 'profile'

type PosixLauncherMarker = Readonly<{
  version: 1
  platform: 'posix'
  commandPath: string
  launcherTarget: string
  commandHash?: string
  profileKind: PosixProfileKind | null
  profilePrefixLength: 0 | 1 | 2
  profileCreated: boolean
}>

type WindowsLauncherMarker = Readonly<{
  version: 1
  platform: 'windows'
  commandPath: string
  commandHash: string
}>

type LauncherMarker = PosixLauncherMarker | WindowsLauncherMarker

export type CliLauncherServiceOptions = Readonly<{
  platform?: NodeJS.Platform
  homeDirectory: string
  userDataDirectory: string
  environmentPath?: string
  shell?: string
  localAppDataDirectory?: string
  resolveCliDirectory(): string | null
}>

type MarkerReadResult =
  | Readonly<{ state: 'missing'; raw: null }>
  | Readonly<{ state: 'invalid'; raw: string }>
  | Readonly<{ state: 'valid'; raw: string; marker: LauncherMarker }>

type ProfileInspection = Readonly<{
  kind: PosixProfileKind
  path: string
  content: string
  exists: boolean
  blockState: 'missing' | 'exact' | 'modified' | 'too-large'
}>

type AppendedManagedBlock = Readonly<{
  content: string
  prefixLength: 0 | 1 | 2
}>

type CliSource = Readonly<{
  posixLauncher: string
  modulePath: string
  runtimeNode: string
}>

type OwnedCommand =
  | Readonly<{ kind: 'link'; value: string }>
  | Readonly<{ kind: 'text'; value: string; executable: boolean }>

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function pathsEqual(left: string, right: string, platform: NodeJS.Platform): boolean {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function isPosixProfileKind(value: unknown): value is PosixProfileKind {
  return (
    value === 'zsh' ||
    value === 'bash' ||
    value === 'bash-login' ||
    value === 'fish' ||
    value === 'profile'
  )
}

function parseLauncherMarker(value: unknown): LauncherMarker | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const marker = value as Record<string, unknown>
  if (marker.version !== LAUNCHER_MARKER_VERSION || typeof marker.commandPath !== 'string') {
    return null
  }
  if (
    marker.platform === 'posix' &&
    typeof marker.launcherTarget === 'string' &&
    (marker.commandHash === undefined ||
      (typeof marker.commandHash === 'string' && /^[0-9a-f]{64}$/.test(marker.commandHash))) &&
    (marker.profileKind === null || isPosixProfileKind(marker.profileKind)) &&
    (marker.profilePrefixLength === 0 ||
      marker.profilePrefixLength === 1 ||
      marker.profilePrefixLength === 2) &&
    typeof marker.profileCreated === 'boolean'
  ) {
    return marker as PosixLauncherMarker
  }
  if (
    marker.platform === 'windows' &&
    typeof marker.commandHash === 'string' &&
    /^[0-9a-f]{64}$/.test(marker.commandHash)
  ) {
    return marker as WindowsLauncherMarker
  }
  return null
}

function managedProfileBlock(kind: PosixProfileKind): string {
  const command =
    kind === 'fish'
      ? 'fish_add_path --global --move "$HOME/.local/bin"'
      : 'case ":$PATH:" in\n  *":$HOME/.local/bin:"*) ;;\n  *) export PATH="$HOME/.local/bin:$PATH" ;;\nesac'
  return `${MANAGED_BLOCK_START}\n${command}\n${MANAGED_BLOCK_END}`
}

function inspectManagedBlock(content: string, block: string): ProfileInspection['blockState'] {
  const blockOccurrences = content.split(block).length - 1
  const startOccurrences = content.split(MANAGED_BLOCK_START).length - 1
  const endOccurrences = content.split(MANAGED_BLOCK_END).length - 1
  if (blockOccurrences === 1 && startOccurrences === 1 && endOccurrences === 1) return 'exact'
  if (startOccurrences === 0 && endOccurrences === 0) return 'missing'
  return 'modified'
}

function appendManagedBlock(content: string, block: string): AppendedManagedBlock {
  const prefixLength: AppendedManagedBlock['prefixLength'] = content
    ? content.endsWith('\n')
      ? 1
      : 2
    : 0
  return {
    content: `${content}${'\n'.repeat(prefixLength)}${block}\n`,
    prefixLength
  }
}

function hasManagedBlockPrefix(content: string, block: string, prefixLength: 0 | 1 | 2): boolean {
  const index = content.indexOf(block)
  return (
    index >= prefixLength &&
    content.slice(index - prefixLength, index) === '\n'.repeat(prefixLength)
  )
}

function removeManagedBlock(content: string, block: string, prefixLength: 0 | 1 | 2): string {
  const index = content.indexOf(block)
  if (index < 0) return content
  const start = index - prefixLength
  let end = index + block.length
  if (content[end] === '\n') end += 1
  return `${content.slice(0, start)}${content.slice(end)}`
}

function escapeBatchLiteral(value: string): string {
  return value.replaceAll('%', '%%')
}

function quotePosixLiteral(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

function createPosixCommand(source: CliSource): string {
  return [
    '#!/bin/sh',
    'set -eu',
    'runtime_node=' + quotePosixLiteral(source.runtimeNode),
    'cli_module=' + quotePosixLiteral(source.modulePath),
    'if [ ! -x "$runtime_node" ] || [ ! -f "$cli_module" ]; then',
    '  echo "DeepChat CLI bundled resources are unavailable." >&2',
    '  exit 127',
    'fi',
    'exec "$runtime_node" "$cli_module" "$@"',
    ''
  ].join('\n')
}

function createWindowsCommand(source: CliSource): string {
  const cliModule = escapeBatchLiteral(source.modulePath)
  const runtimeNode = escapeBatchLiteral(source.runtimeNode)
  return [
    '@echo off',
    'setlocal',
    `set "cli_module=${cliModule}"`,
    `set "runtime_node=${runtimeNode}"`,
    'if not exist "%runtime_node%" goto missing_runtime',
    'if not exist "%cli_module%" goto missing_runtime',
    '"%runtime_node%" "%cli_module%" %*',
    'exit /b %errorlevel%',
    ':missing_runtime',
    'echo DeepChat CLI bundled resources are unavailable. 1>&2',
    'exit /b 127',
    ''
  ].join('\r\n')
}

function ownedCommandsEqual(left: OwnedCommand | null, right: OwnedCommand | null): boolean {
  return (
    left?.kind === right?.kind &&
    left?.value === right?.value &&
    (left?.kind !== 'text' || (right?.kind === 'text' && left.executable === right.executable))
  )
}

export class CliLauncherService {
  private readonly platform: NodeJS.Platform
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: CliLauncherServiceOptions) {
    this.platform = options.platform ?? process.platform
  }

  async getStatus(): Promise<CliLauncherStatus> {
    return await this.runExclusive(() => this.inspectStatus())
  }

  async ensureInstalled(): Promise<CliLauncherStatus> {
    return await this.runExclusive(async () => {
      await this.installOrRepair()
      return await this.inspectStatus()
    })
  }

  async removeOwnedLauncher(): Promise<CliLauncherStatus> {
    return await this.runExclusive(async () => {
      await this.uninstall()
      return await this.inspectStatus()
    })
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(operation, operation)
    this.operationQueue = run.then(
      () => undefined,
      () => undefined
    )
    return await run
  }

  private get markerPath(): string {
    return path.join(this.options.userDataDirectory, 'local-control', LAUNCHER_MARKER_FILENAME)
  }

  private get isSupportedPlatform(): boolean {
    return this.platform === 'darwin' || this.platform === 'linux' || this.platform === 'win32'
  }

  private get commandPath(): string | null {
    if (this.platform === 'darwin' || this.platform === 'linux') {
      return path.join(this.options.homeDirectory, '.local', 'bin', 'deepchat')
    }
    if (this.platform === 'win32') {
      const localAppData =
        this.options.localAppDataDirectory ??
        path.join(this.options.homeDirectory, 'AppData', 'Local')
      return path.join(localAppData, 'Microsoft', 'WindowsApps', 'deepchat.cmd')
    }
    return null
  }

  private async resolveSource(): Promise<CliSource | null> {
    const directory = this.options.resolveCliDirectory()
    if (!directory) return null
    const resolvedDirectory = path.resolve(directory)
    const runtimeExecutable =
      this.platform === 'win32' ? path.join('node', 'node.exe') : path.join('node', 'bin', 'node')
    const runtimeCandidates = [
      path.resolve(resolvedDirectory, '..', 'runtime', runtimeExecutable),
      path.resolve(resolvedDirectory, '..', '..', 'runtime', runtimeExecutable)
    ]
    let runtimeNode: string | null = null
    for (const candidate of runtimeCandidates) {
      try {
        const stats = await lstat(candidate)
        if (
          stats.isFile() &&
          !stats.isSymbolicLink() &&
          (this.platform === 'win32' || (stats.mode & 0o111) !== 0)
        ) {
          runtimeNode = candidate
          break
        }
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
    }
    if (!runtimeNode) return null
    const source: CliSource = {
      posixLauncher: path.join(resolvedDirectory, 'deepchat'),
      modulePath: path.join(resolvedDirectory, 'deepchat.mjs'),
      runtimeNode
    }
    const requiredPaths =
      this.platform === 'win32' ? [source.modulePath] : [source.posixLauncher, source.modulePath]
    for (const requiredPath of requiredPaths) {
      try {
        const stats = await lstat(requiredPath)
        if (!stats.isFile() || stats.isSymbolicLink()) return null
        if (
          this.platform !== 'win32' &&
          requiredPath === source.posixLauncher &&
          (stats.mode & 0o111) === 0
        ) {
          return null
        }
      } catch (error) {
        if (isMissingFileError(error)) return null
        throw error
      }
    }
    return source
  }

  private async inspectStatus(): Promise<CliLauncherStatus> {
    const commandPath = this.commandPath
    if (!this.isSupportedPlatform || !commandPath) {
      return {
        state: 'unavailable',
        reason: 'unsupported-platform',
        commandPath: null,
        shellConfigPath: null
      }
    }

    const markerResult = await this.readMarker()
    if (markerResult.state === 'invalid') {
      return {
        state: 'conflict',
        reason: 'ownership-marker-invalid',
        commandPath,
        shellConfigPath: null
      }
    }

    if (markerResult.state === 'missing') {
      if (await this.pathEntryExists(commandPath)) {
        return {
          state: 'conflict',
          reason: 'unowned-command',
          commandPath,
          shellConfigPath: null
        }
      }
      const profileKind = this.platform === 'win32' ? null : await this.selectProfileKind()
      const orphanedProfile = await this.findUnownedProfileConflict(profileKind)
      if (orphanedProfile && orphanedProfile.blockState !== 'too-large') {
        return {
          state: 'conflict',
          reason: 'unowned-command',
          commandPath,
          shellConfigPath: null
        }
      }
      if (orphanedProfile?.blockState === 'too-large') {
        return {
          state: 'unavailable',
          reason: 'shell-config-too-large',
          commandPath,
          shellConfigPath: orphanedProfile.path
        }
      }
      if (this.platform === 'win32' && !this.isCommandDirectoryOnPath()) {
        return {
          state: 'unavailable',
          reason: 'path-unavailable',
          commandPath,
          shellConfigPath: null
        }
      }
      const source = await this.resolveSource()
      return {
        state: source ? 'not-installed' : 'unavailable',
        reason: source ? null : 'source-missing',
        commandPath,
        shellConfigPath: null
      }
    }

    const { marker } = markerResult
    const expectedPlatform = this.platform === 'win32' ? 'windows' : 'posix'
    if (
      marker.platform !== expectedPlatform ||
      !pathsEqual(marker.commandPath, commandPath, this.platform)
    ) {
      return {
        state: 'conflict',
        reason: 'ownership-marker-invalid',
        commandPath,
        shellConfigPath: null
      }
    }

    const profile =
      marker.platform === 'posix' ? await this.inspectProfile(marker.profileKind) : null
    if (profile?.blockState === 'too-large') {
      return {
        state: 'unavailable',
        reason: 'shell-config-too-large',
        commandPath,
        shellConfigPath: profile.path
      }
    }
    if (
      profile?.blockState === 'modified' ||
      (profile?.blockState === 'exact' &&
        marker.platform === 'posix' &&
        !hasManagedBlockPrefix(
          profile.content,
          managedProfileBlock(profile.kind),
          marker.profilePrefixLength
        ))
    ) {
      return {
        state: 'conflict',
        reason: 'shell-config-modified',
        commandPath,
        shellConfigPath: profile.path
      }
    }

    const commandState = await this.inspectOwnedCommand(marker)
    if (commandState === 'modified') {
      return {
        state: 'conflict',
        reason: 'command-modified',
        commandPath,
        shellConfigPath: profile?.path ?? null
      }
    }

    const source = await this.resolveSource()
    if (!source) {
      return {
        state: 'unavailable',
        reason: 'source-missing',
        commandPath,
        shellConfigPath: profile?.path ?? null
      }
    }
    if (commandState === 'missing') {
      return {
        state: 'needs-repair',
        reason: 'command-missing',
        commandPath,
        shellConfigPath: profile?.path ?? null
      }
    }
    if (profile?.blockState === 'missing') {
      return {
        state: 'needs-repair',
        reason: 'shell-config-missing',
        commandPath,
        shellConfigPath: profile.path
      }
    }
    if (this.platform === 'win32' && !this.isCommandDirectoryOnPath()) {
      return {
        state: 'needs-repair',
        reason: 'path-unavailable',
        commandPath,
        shellConfigPath: null
      }
    }
    const current = this.markerForSource(
      source,
      marker.platform === 'posix' ? marker.profileKind : null,
      marker.platform === 'posix' ? marker.profilePrefixLength : 0,
      marker.platform === 'posix' ? marker.profileCreated : false
    )
    const stale =
      marker.platform === 'posix'
        ? marker.commandHash === undefined ||
          marker.commandHash !== (current as PosixLauncherMarker).commandHash
        : marker.commandHash !== (current as WindowsLauncherMarker).commandHash
    return {
      state: stale ? 'stale' : 'installed',
      reason: stale ? 'upgrade-required' : null,
      commandPath,
      shellConfigPath: profile?.path ?? null
    }
  }

  private async installOrRepair(): Promise<void> {
    if (!this.isSupportedPlatform || !this.commandPath) {
      throw new Error('DeepChat CLI launcher installation is not supported on this platform')
    }
    const source = await this.resolveSource()
    if (!source) throw new Error('The bundled DeepChat CLI is unavailable')
    if (this.platform === 'win32' && !this.isCommandDirectoryOnPath()) {
      throw new Error('The Windows user command directory is not available on PATH')
    }
    const markerResult = await this.readMarker()
    if (markerResult.state === 'invalid') {
      throw new Error('The DeepChat CLI ownership marker is invalid')
    }

    let previousMarker: LauncherMarker | null = null
    let previousMarkerRaw: string | null = null
    let profileKind: PosixProfileKind | null = null
    if (markerResult.state === 'valid') {
      previousMarker = markerResult.marker
      previousMarkerRaw = markerResult.raw
      const expectedPlatform = this.platform === 'win32' ? 'windows' : 'posix'
      if (
        previousMarker.platform !== expectedPlatform ||
        !pathsEqual(previousMarker.commandPath, this.commandPath, this.platform)
      ) {
        throw new Error('The DeepChat CLI ownership marker does not match this installation')
      }
      profileKind = previousMarker.platform === 'posix' ? previousMarker.profileKind : null
    } else {
      if (await this.pathEntryExists(this.commandPath)) {
        throw new Error('A DeepChat CLI command or shell block exists without an ownership marker')
      }
      profileKind = this.platform === 'win32' ? null : await this.selectProfileKind()
      const orphanedProfile = await this.findUnownedProfileConflict(profileKind)
      if (orphanedProfile && orphanedProfile.blockState !== 'too-large') {
        throw new Error('A DeepChat CLI command or shell block exists without an ownership marker')
      }
      if (orphanedProfile?.blockState === 'too-large') {
        throw new Error('The DeepChat CLI shell configuration exceeds the supported size')
      }
    }

    const profile = this.platform === 'win32' ? null : await this.inspectProfile(profileKind)
    if (profile?.blockState === 'too-large') {
      throw new Error('The DeepChat CLI shell configuration exceeds the supported size')
    }
    if (profile?.blockState === 'modified') {
      throw new Error('The managed DeepChat CLI shell block has been modified')
    }

    const previousCommand = await this.captureOwnedCommand(previousMarker)
    const previousProfileContent = profile?.exists ? profile.content : null
    const appendedProfile =
      profile && profile.blockState === 'missing'
        ? appendManagedBlock(profile.content, managedProfileBlock(profile.kind))
        : null
    const profilePrefixLength =
      appendedProfile?.prefixLength ??
      (previousMarker?.platform === 'posix' ? previousMarker.profilePrefixLength : 0)
    const profileCreated =
      previousMarker?.platform === 'posix'
        ? previousMarker.profileCreated
        : Boolean(profile && !profile.exists)
    if (
      profile?.blockState === 'exact' &&
      previousMarker?.platform === 'posix' &&
      !hasManagedBlockPrefix(
        profile.content,
        managedProfileBlock(profile.kind),
        previousMarker.profilePrefixLength
      )
    ) {
      throw new Error('The managed DeepChat CLI shell block prefix has been modified')
    }
    const nextProfileContent = appendedProfile?.content ?? previousProfileContent
    const nextMarker = this.markerForSource(
      source,
      profileKind,
      profilePrefixLength,
      profileCreated
    )
    const nextMarkerRaw = `${JSON.stringify(nextMarker)}\n`
    const nextCommand = this.commandForSource(source)
    let commandChanged = false
    let profileChanged = false
    try {
      if (!ownedCommandsEqual(previousCommand, nextCommand)) {
        await this.writeOwnedCommand(source, previousCommand)
        commandChanged = true
      }
      if (profile && nextProfileContent !== null && nextProfileContent !== previousProfileContent) {
        await this.prepareHomeManagedDirectory(path.dirname(profile.path))
        await this.atomicWriteText(profile.path, nextProfileContent, previousProfileContent, 0o644)
        profileChanged = true
      }
      if (nextMarkerRaw !== previousMarkerRaw) {
        await this.writeMarker(nextMarkerRaw, previousMarkerRaw)
      }
    } catch (error) {
      if (profileChanged && profile && nextProfileContent !== null) {
        await this.restoreTextFile(profile.path, previousProfileContent, nextProfileContent).catch(
          () => undefined
        )
      }
      if (commandChanged) {
        await this.restoreOwnedCommand(previousCommand, nextCommand).catch(() => undefined)
      }
      throw error
    }
  }

  private async uninstall(): Promise<void> {
    const commandPath = this.commandPath
    if (!this.isSupportedPlatform || !commandPath) {
      throw new Error('DeepChat CLI launcher removal is not supported on this platform')
    }
    const markerResult = await this.readMarker()
    if (markerResult.state === 'invalid') {
      throw new Error('The DeepChat CLI ownership marker is invalid')
    }
    if (markerResult.state === 'missing') {
      if (await this.pathEntryExists(commandPath)) {
        throw new Error('Refusing to remove a CLI command without an ownership marker')
      }
      const profileKind = this.platform === 'win32' ? null : await this.selectProfileKind()
      const orphanedProfile = await this.findUnownedProfileConflict(profileKind)
      if (orphanedProfile && orphanedProfile.blockState !== 'too-large') {
        throw new Error('Refusing to remove a CLI command without an ownership marker')
      }
      if (orphanedProfile?.blockState === 'too-large') {
        throw new Error(
          'Cannot inspect the DeepChat CLI shell configuration because it is too large'
        )
      }
      return
    }

    const { marker, raw: markerRaw } = markerResult
    const expectedPlatform = this.platform === 'win32' ? 'windows' : 'posix'
    if (
      marker.platform !== expectedPlatform ||
      !pathsEqual(marker.commandPath, commandPath, this.platform)
    ) {
      throw new Error('The DeepChat CLI ownership marker does not match this installation')
    }
    const profile =
      marker.platform === 'posix' ? await this.inspectProfile(marker.profileKind) : null
    if (profile?.blockState === 'too-large') {
      throw new Error('Cannot inspect the DeepChat CLI shell configuration because it is too large')
    }
    if (
      profile?.blockState === 'modified' ||
      (profile?.blockState === 'exact' &&
        marker.platform === 'posix' &&
        !hasManagedBlockPrefix(
          profile.content,
          managedProfileBlock(profile.kind),
          marker.profilePrefixLength
        ))
    ) {
      throw new Error('Refusing to edit a modified DeepChat CLI shell block')
    }
    const previousCommand = await this.captureOwnedCommand(marker)
    const previousProfileContent = profile?.exists ? profile.content : null
    const nextProfileContent =
      profile?.blockState === 'exact' && marker.platform === 'posix'
        ? removeManagedBlock(
            profile.content,
            managedProfileBlock(profile.kind),
            marker.profilePrefixLength
          )
        : previousProfileContent
    let commandRemoved = false
    let profileChanged = false
    let profileRemoved = false
    try {
      if (previousCommand !== null) {
        await this.removeOwnedCommand(previousCommand)
        commandRemoved = true
      }
      if (profile && nextProfileContent !== null && nextProfileContent !== previousProfileContent) {
        await this.prepareHomeManagedDirectory(path.dirname(profile.path))
        if (marker.platform === 'posix' && marker.profileCreated && nextProfileContent === '') {
          await this.unlinkTextIfMatches(profile.path, previousProfileContent ?? '')
          profileRemoved = true
        } else {
          await this.atomicWriteText(
            profile.path,
            nextProfileContent,
            previousProfileContent,
            0o644
          )
        }
        profileChanged = true
      }
      await this.removeMarker(markerRaw)
    } catch (error) {
      if (profileChanged && profile && nextProfileContent !== null) {
        await this.restoreTextFile(
          profile.path,
          previousProfileContent,
          profileRemoved ? null : nextProfileContent
        ).catch(() => undefined)
      }
      if (commandRemoved) {
        await this.restoreOwnedCommand(previousCommand, null).catch(() => undefined)
      }
      throw error
    }
  }

  private async selectProfileKind(): Promise<PosixProfileKind | null> {
    if (this.isCommandDirectoryOnPath()) return null
    const fallbackShell =
      this.platform === 'darwin' ? 'zsh' : this.platform === 'linux' ? 'bash' : ''
    switch (path.basename(this.options.shell ?? fallbackShell)) {
      case 'zsh':
        return 'zsh'
      case 'bash':
        if (this.platform === 'darwin') {
          if (await this.pathEntryExists(path.join(this.options.homeDirectory, '.bash_profile'))) {
            return 'bash'
          }
          if (await this.pathEntryExists(path.join(this.options.homeDirectory, '.bash_login'))) {
            return 'bash-login'
          }
          return 'profile'
        }
        return 'bash'
      case 'fish':
        return 'fish'
      default:
        return 'profile'
    }
  }

  private isCommandDirectoryOnPath(): boolean {
    const commandPath = this.commandPath
    if (!commandPath) return false
    const commandDirectory = path.resolve(path.dirname(commandPath))
    const delimiter = this.platform === 'win32' ? ';' : ':'
    return (this.options.environmentPath ?? '').split(delimiter).some((entry) => {
      if (!entry) return false
      const candidate = path.resolve(entry.replace(/^"|"$/g, ''))
      return this.platform === 'win32'
        ? candidate.toLowerCase() === commandDirectory.toLowerCase()
        : candidate === commandDirectory
    })
  }

  private profilePath(kind: PosixProfileKind): string {
    switch (kind) {
      case 'zsh':
        return path.join(
          this.options.homeDirectory,
          this.platform === 'darwin' ? '.zprofile' : '.zshrc'
        )
      case 'bash':
        return path.join(
          this.options.homeDirectory,
          this.platform === 'darwin' ? '.bash_profile' : '.bashrc'
        )
      case 'bash-login':
        return path.join(this.options.homeDirectory, '.bash_login')
      case 'fish':
        return path.join(
          this.options.homeDirectory,
          '.config',
          'fish',
          'conf.d',
          'deepchat-cli.fish'
        )
      case 'profile':
        return path.join(this.options.homeDirectory, '.profile')
    }
  }

  private async inspectProfile(kind: PosixProfileKind | null): Promise<ProfileInspection | null> {
    if (!kind) return null
    const profilePath = this.profilePath(kind)
    if (!isPathWithin(this.options.homeDirectory, profilePath)) {
      throw new Error('Shell configuration path is outside the user home directory')
    }
    let content = ''
    let exists = false
    try {
      const stats = await lstat(profilePath)
      if (!stats.isFile() || stats.isSymbolicLink()) {
        return { kind, path: profilePath, content, exists: true, blockState: 'modified' }
      }
      if (stats.size > MAX_SHELL_CONFIG_BYTES) {
        return { kind, path: profilePath, content, exists: true, blockState: 'too-large' }
      }
      content = await readFile(profilePath, 'utf8')
      exists = true
    } catch (error) {
      if (!isMissingFileError(error)) throw error
    }
    return {
      kind,
      path: profilePath,
      content,
      exists,
      blockState: inspectManagedBlock(content, managedProfileBlock(kind))
    }
  }

  private async findUnownedProfileConflict(
    selectedProfileKind: PosixProfileKind | null
  ): Promise<ProfileInspection | null> {
    if (this.platform === 'win32') return null
    let tooLarge: ProfileInspection | null = null
    for (const kind of ['zsh', 'bash', 'bash-login', 'fish', 'profile'] as const) {
      const profile = await this.inspectProfile(kind)
      if (!profile || profile.blockState === 'missing') continue
      if (profile.blockState !== 'too-large') return profile
      if (kind === selectedProfileKind) tooLarge = profile
    }
    return tooLarge
  }

  private markerForSource(
    source: CliSource,
    profileKind: PosixProfileKind | null,
    profilePrefixLength: 0 | 1 | 2,
    profileCreated: boolean
  ): LauncherMarker {
    const commandPath = this.commandPath
    if (!commandPath) throw new Error('CLI launcher command path is unavailable')
    if (this.platform === 'win32') {
      return {
        version: LAUNCHER_MARKER_VERSION,
        platform: 'windows',
        commandPath,
        commandHash: sha256(createWindowsCommand(source))
      }
    }
    return {
      version: LAUNCHER_MARKER_VERSION,
      platform: 'posix',
      commandPath,
      launcherTarget: source.posixLauncher,
      commandHash: sha256(createPosixCommand(source)),
      profileKind,
      profilePrefixLength,
      profileCreated
    }
  }

  private async inspectOwnedCommand(
    marker: LauncherMarker
  ): Promise<'current' | 'missing' | 'modified'> {
    try {
      const command = await this.readOwnedCommand()
      if (command === null) return 'missing'
      return this.commandMatchesMarker(command, marker) ? 'current' : 'modified'
    } catch {
      return 'modified'
    }
  }

  private commandMatchesMarker(command: OwnedCommand, marker: LauncherMarker): boolean {
    if (marker.platform === 'windows') {
      return command.kind === 'text' && sha256(command.value) === marker.commandHash
    }
    if (marker.commandHash !== undefined) {
      return (
        command.kind === 'text' &&
        command.executable &&
        sha256(command.value) === marker.commandHash
      )
    }
    return command.kind === 'link' && command.value === path.resolve(marker.launcherTarget)
  }

  private async captureOwnedCommand(marker: LauncherMarker | null): Promise<OwnedCommand | null> {
    const command = await this.readOwnedCommand()
    if (command === null) return null
    if (!marker || !this.commandMatchesMarker(command, marker)) {
      throw new Error('Refusing to replace an unowned DeepChat CLI command')
    }
    return command
  }

  private async writeOwnedCommand(
    source: CliSource,
    previousCommand: OwnedCommand | null
  ): Promise<void> {
    const commandPath = this.commandPath
    if (!commandPath) throw new Error('CLI launcher command path is unavailable')
    await this.prepareCommandDirectory(path.dirname(commandPath))
    if (this.platform === 'win32') {
      if (previousCommand?.kind === 'link') {
        throw new Error('Windows CLI launcher cannot replace a symbolic link')
      }
      await this.atomicWriteText(
        commandPath,
        createWindowsCommand(source),
        previousCommand?.value ?? null,
        0o755
      )
      return
    }
    await this.atomicWritePosixCommand(
      { kind: 'text', value: createPosixCommand(source), executable: true },
      previousCommand
    )
  }

  private commandForSource(source: CliSource): OwnedCommand {
    return {
      kind: 'text',
      value: this.platform === 'win32' ? createWindowsCommand(source) : createPosixCommand(source),
      executable: true
    }
  }

  private async restoreOwnedCommand(
    previousCommand: OwnedCommand | null,
    expectedCurrent: OwnedCommand | null
  ): Promise<void> {
    const commandPath = this.commandPath
    if (!commandPath) return
    if (this.platform !== 'win32') {
      if (previousCommand === null) {
        if (expectedCurrent !== null) await this.unlinkPosixCommandIfMatches(expectedCurrent)
      } else {
        await this.atomicWritePosixCommand(previousCommand, expectedCurrent)
      }
      return
    }
    if (previousCommand?.kind === 'link' || expectedCurrent?.kind === 'link') {
      throw new Error('Windows CLI launcher cannot restore a symbolic link')
    }
    if (previousCommand === null) {
      if (expectedCurrent !== null) {
        await this.unlinkTextIfMatches(commandPath, expectedCurrent.value)
      }
      return
    }
    await this.atomicWriteText(
      commandPath,
      previousCommand.value,
      expectedCurrent?.value ?? null,
      0o755
    )
  }

  private async removeOwnedCommand(previousCommand: OwnedCommand): Promise<void> {
    const commandPath = this.commandPath
    if (!commandPath) return
    if (this.platform === 'win32') {
      if (previousCommand.kind !== 'text') {
        throw new Error('Windows CLI launcher cannot remove a symbolic link')
      }
      await this.unlinkTextIfMatches(commandPath, previousCommand.value)
    } else {
      await this.unlinkPosixCommandIfMatches(previousCommand)
    }
  }

  private async readOwnedCommand(): Promise<OwnedCommand | null> {
    if (this.platform === 'win32') {
      const content = await this.readWindowsCommand()
      return content === null ? null : { kind: 'text', value: content, executable: true }
    }
    return await this.readPosixCommand()
  }

  private async readPosixCommand(): Promise<OwnedCommand | null> {
    const commandPath = this.commandPath
    if (!commandPath) return null
    try {
      const stats = await lstat(commandPath)
      if (stats.isSymbolicLink()) {
        const target = await readlink(commandPath)
        return { kind: 'link', value: path.resolve(path.dirname(commandPath), target) }
      }
      if (!stats.isFile() || stats.size > 64 * 1024) {
        throw new Error('DeepChat CLI command is not an owned launcher')
      }
      return {
        kind: 'text',
        value: await readFile(commandPath, 'utf8'),
        executable: (stats.mode & 0o111) !== 0
      }
    } catch (error) {
      if (isMissingFileError(error)) return null
      throw error
    }
  }

  private async readWindowsCommand(): Promise<string | null> {
    const commandPath = this.commandPath
    if (!commandPath) return null
    try {
      const stats = await lstat(commandPath)
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 64 * 1024) {
        throw new Error('DeepChat CLI command is not an owned launcher file')
      }
      return await readFile(commandPath, 'utf8')
    } catch (error) {
      if (isMissingFileError(error)) return null
      throw error
    }
  }

  private async prepareCommandDirectory(directory: string): Promise<void> {
    if (this.platform !== 'win32') {
      await this.prepareHomeManagedDirectory(directory)
      return
    }
    await mkdir(directory, { recursive: true, mode: 0o755 })
    const stats = await lstat(directory)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('CLI launcher directory is not a real directory')
    }
  }

  private async prepareHomeManagedDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o755 })
    const stats = await lstat(directory)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Managed user directory is not a real directory')
    }
    const [physicalHome, physicalDirectory] = await Promise.all([
      realpath(this.options.homeDirectory),
      realpath(directory)
    ])
    if (!isPathWithin(physicalHome, physicalDirectory)) {
      throw new Error('Managed user directory is outside the user home directory')
    }
  }

  private async atomicWritePosixCommand(
    command: OwnedCommand,
    expectedCommand: OwnedCommand | null
  ): Promise<void> {
    const commandPath = this.commandPath
    if (!commandPath) throw new Error('CLI launcher command path is unavailable')
    const currentCommand = await this.readPosixCommand()
    if (!ownedCommandsEqual(currentCommand, expectedCommand)) {
      throw new Error('CLI launcher changed during installation')
    }
    const tempPath = path.join(path.dirname(commandPath), `.deepchat-${randomUUID()}.tmp`)
    try {
      if (command.kind === 'link') {
        await symlink(command.value, tempPath)
      } else {
        await writeFile(tempPath, command.value, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o755
        })
        await chmod(tempPath, 0o755)
      }
      const verifiedCommand = await this.readPosixCommand()
      if (!ownedCommandsEqual(verifiedCommand, currentCommand)) {
        throw new Error('CLI launcher changed during installation')
      }
      await rename(tempPath, commandPath)
    } catch (error) {
      await unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  private async atomicWriteText(
    filePath: string,
    content: string,
    expectedContent: string | null,
    mode: number
  ): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o755 })
    const currentContent = await this.readRegularText(
      filePath,
      Math.max(MAX_SHELL_CONFIG_BYTES, 64 * 1024)
    )
    if (currentContent !== expectedContent) throw new Error('Managed file changed during operation')
    const tempPath = path.join(path.dirname(filePath), `.deepchat-${randomUUID()}.tmp`)
    try {
      await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx', mode })
      if (this.platform !== 'win32') await chmod(tempPath, mode)
      const verifiedContent = await this.readRegularText(
        filePath,
        Math.max(MAX_SHELL_CONFIG_BYTES, 64 * 1024)
      )
      if (verifiedContent !== currentContent)
        throw new Error('Managed file changed during operation')
      await rename(tempPath, filePath)
    } catch (error) {
      await unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  private async restoreTextFile(
    filePath: string,
    previousContent: string | null,
    currentContent: string | null
  ): Promise<void> {
    if (previousContent === null) {
      if (currentContent === null) return
      await this.unlinkTextIfMatches(filePath, currentContent)
      return
    }
    await this.atomicWriteText(filePath, previousContent, currentContent, 0o644)
  }

  private async readRegularText(filePath: string, maxBytes: number): Promise<string | null> {
    try {
      const stats = await lstat(filePath)
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes) {
        throw new Error('Managed path is not a supported regular file')
      }
      return await readFile(filePath, 'utf8')
    } catch (error) {
      if (isMissingFileError(error)) return null
      throw error
    }
  }

  private async unlinkPosixCommandIfMatches(expectedCommand: OwnedCommand): Promise<void> {
    const commandPath = this.commandPath
    if (!commandPath) return
    const currentCommand = await this.readPosixCommand()
    if (!ownedCommandsEqual(currentCommand, expectedCommand)) {
      throw new Error('Refusing to remove a changed CLI launcher')
    }
    await unlink(commandPath)
  }

  private async unlinkTextIfMatches(filePath: string, expectedContent: string): Promise<void> {
    const currentContent = await this.readRegularText(filePath, 64 * 1024)
    if (currentContent !== expectedContent) {
      throw new Error('Refusing to remove a changed CLI launcher')
    }
    await unlink(filePath)
  }

  private async pathEntryExists(filePath: string): Promise<boolean> {
    try {
      await lstat(filePath)
      return true
    } catch (error) {
      if (isMissingFileError(error)) return false
      throw error
    }
  }

  private async readMarker(): Promise<MarkerReadResult> {
    try {
      const directory = path.dirname(this.markerPath)
      const directoryStats = await lstat(directory)
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
        return { state: 'invalid', raw: '' }
      }
      const [physicalUserData, physicalDirectory] = await Promise.all([
        realpath(this.options.userDataDirectory),
        realpath(directory)
      ])
      if (!isPathWithin(physicalUserData, physicalDirectory)) {
        return { state: 'invalid', raw: '' }
      }
      const stats = await lstat(this.markerPath)
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_MARKER_BYTES) {
        return { state: 'invalid', raw: '' }
      }
      const raw = await readFile(this.markerPath, 'utf8')
      const marker = parseLauncherMarker(JSON.parse(raw))
      return marker ? { state: 'valid', raw, marker } : { state: 'invalid', raw }
    } catch (error) {
      if (isMissingFileError(error)) return { state: 'missing', raw: null }
      if (error instanceof SyntaxError) return { state: 'invalid', raw: '' }
      throw error
    }
  }

  private async writeMarker(content: string, expectedContent: string | null): Promise<void> {
    const directory = path.dirname(this.markerPath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const directoryStats = await lstat(directory)
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new Error('CLI launcher ownership directory is not a real directory')
    }
    const [physicalUserData, physicalDirectory] = await Promise.all([
      realpath(this.options.userDataDirectory),
      realpath(directory)
    ])
    if (!isPathWithin(physicalUserData, physicalDirectory)) {
      throw new Error('CLI launcher ownership directory is outside application data')
    }
    if (this.platform !== 'win32') await chmod(directory, 0o700)
    await this.atomicWriteText(this.markerPath, content, expectedContent, 0o600)
  }

  private async removeMarker(expectedContent: string): Promise<void> {
    await this.unlinkTextIfMatches(this.markerPath, expectedContent)
  }
}
