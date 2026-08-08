import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { z } from 'zod'
import type { SettingsStore } from '@/config/settingsStore'
import {
  AgentCommandShellConfigSchema,
  ResolvedCommandShellSchema,
  normalizeAgentCommandShellConfig,
  type AgentCommandShellConfig,
  type CommandShellProfile,
  type GitBashAvailability,
  type GitBashResolutionError,
  type GitBashResolutionSource,
  type ResolvedCommandShell
} from '@shared/commandShell'
import { getUserShell } from './shellEnvHelper'

const GIT_BASH_PROBE_TIMEOUT_MS = 5_000
const GIT_BASH_DISCOVERY_TIMEOUT_MS = 15_000
const COMMAND_PROBE_MAX_BUFFER_BYTES = 64 * 1_024
const GIT_BASH_IDENTITY_PROBE = 'printf "deepchat-bash:%s:%s" "$BASH_VERSION" "$OSTYPE"'

export interface CommandProbeResult {
  stdout: string
  stderr: string
}

export type CommandProbeRunner = (
  executable: string,
  args: readonly string[],
  timeoutMs: number
) => Promise<CommandProbeResult>

export interface CommandShellServiceDependencies {
  settings: Pick<SettingsStore, 'get' | 'set'>
  getPlatform?: () => NodeJS.Platform
  getEnvironment?: () => NodeJS.ProcessEnv
  runCommand?: CommandProbeRunner
  statFile?: (candidate: string) => fs.Stats | null
  resolvePosixShell?: () => { shell: string; args: string[] }
  now?: () => number
}

interface GitBashCandidate {
  executable: string
  source: GitBashResolutionSource
}

interface ValidatedCandidateCacheEntry {
  fileIdentity: string
}

interface PendingCandidateValidation {
  fileIdentity: string
  promise: Promise<boolean>
}

export class CommandShellUnavailableError extends Error {
  constructor(
    readonly profile: CommandShellProfile,
    readonly reason: GitBashResolutionError
  ) {
    super(`Command shell profile "${profile}" is unavailable: ${reason}`)
    this.name = 'CommandShellUnavailableError'
  }
}

function runCommandProbe(
  executable: string,
  args: readonly string[],
  timeoutMs: number
): Promise<CommandProbeResult> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      {
        encoding: 'utf8',
        maxBuffer: COMMAND_PROBE_MAX_BUFFER_BYTES,
        timeout: timeoutMs,
        windowsHide: true,
        ...(path.win32.isAbsolute(executable) ? { cwd: path.win32.dirname(executable) } : {})
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      }
    )
  })
}

function readFileStat(candidate: string): fs.Stats | null {
  try {
    const stat = fs.statSync(candidate)
    return stat.isFile() ? stat : null
  } catch {
    return null
  }
}

function freezeResolvedCommandShell(
  input: z.input<typeof ResolvedCommandShellSchema>
): ResolvedCommandShell {
  const parsed = ResolvedCommandShellSchema.parse(input)
  return Object.freeze({
    ...parsed,
    args: Object.freeze([...parsed.args])
  }) as ResolvedCommandShell
}

function resolveWindowsPowerShell(): ResolvedCommandShell {
  return freezeResolvedCommandShell({
    profile: 'windows-powershell',
    dialect: 'powershell',
    pathStyle: 'win32',
    executable: 'powershell.exe',
    args: ['-NoProfile', '-Command'],
    displayName: 'Windows PowerShell'
  })
}

function resolveCmdShell(): ResolvedCommandShell {
  return freezeResolvedCommandShell({
    profile: 'cmd',
    dialect: 'cmd',
    pathStyle: 'win32',
    executable: 'cmd.exe',
    args: ['/c'],
    displayName: 'Command Prompt'
  })
}

function resolveAutoWindowsShell(environment: NodeJS.ProcessEnv): ResolvedCommandShell {
  return environment.PSModulePath ? resolveWindowsPowerShell() : resolveCmdShell()
}

function normalizeWindowsExecutable(candidate: string): string | null {
  const trimmed = candidate.trim()
  if (!trimmed || !path.win32.isAbsolute(trimmed)) return null

  const normalized = path.win32.normalize(trimmed)
  return path.win32.basename(normalized).toLowerCase() === 'bash.exe' ? normalized : null
}

function dedupeCandidates(candidates: GitBashCandidate[]): GitBashCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = candidate.executable.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getCommonGitBashCandidates(environment: NodeJS.ProcessEnv): GitBashCandidate[] {
  const roots = [
    path.win32.join(environment.ProgramFiles || 'C:\\Program Files', 'Git'),
    path.win32.join(environment['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git'),
    ...(environment.LOCALAPPDATA
      ? [path.win32.join(environment.LOCALAPPDATA, 'Programs', 'Git')]
      : [])
  ]

  return roots.flatMap((root) => [
    { executable: path.win32.join(root, 'bin', 'bash.exe'), source: 'common-path' },
    { executable: path.win32.join(root, 'usr', 'bin', 'bash.exe'), source: 'common-path' }
  ])
}

function deriveGitBashCandidates(gitExecutable: string): GitBashCandidate[] {
  const normalized = path.win32.normalize(gitExecutable.trim())
  if (
    !path.win32.isAbsolute(normalized) ||
    path.win32.basename(normalized).toLowerCase() !== 'git.exe'
  ) {
    return []
  }

  const directory = path.win32.dirname(normalized)
  const directoryName = path.win32.basename(directory).toLowerCase()
  const root =
    directoryName === 'cmd' || directoryName === 'bin' ? path.win32.dirname(directory) : directory

  return dedupeCandidates([
    ...(directoryName === 'bin'
      ? [{ executable: path.win32.join(directory, 'bash.exe'), source: 'git-path' as const }]
      : []),
    { executable: path.win32.join(root, 'bin', 'bash.exe'), source: 'git-path' },
    { executable: path.win32.join(root, 'usr', 'bin', 'bash.exe'), source: 'git-path' }
  ])
}

export class CommandShellService {
  private readonly getPlatform: () => NodeJS.Platform
  private readonly getEnvironment: () => NodeJS.ProcessEnv
  private readonly runCommand: CommandProbeRunner
  private readonly statFile: (candidate: string) => fs.Stats | null
  private readonly resolvePosixShell: () => { shell: string; args: string[] }
  private readonly now: () => number
  private readonly validatedCandidates = new Map<string, ValidatedCandidateCacheEntry>()
  private readonly pendingValidations = new Map<string, PendingCandidateValidation>()
  private resolvedGitBashCandidate: GitBashCandidate | null = null
  private validationGeneration = 0

  constructor(private readonly dependencies: CommandShellServiceDependencies) {
    this.getPlatform = dependencies.getPlatform ?? (() => process.platform)
    this.getEnvironment = dependencies.getEnvironment ?? (() => process.env)
    this.runCommand = dependencies.runCommand ?? runCommandProbe
    this.statFile = dependencies.statFile ?? readFileStat
    this.resolvePosixShell = dependencies.resolvePosixShell ?? getUserShell
    this.now = dependencies.now ?? (() => performance.now())
  }

  getConfig(): AgentCommandShellConfig {
    return normalizeAgentCommandShellConfig(this.dependencies.settings.get('agentCommandShell'))
  }

  setConfig(value: AgentCommandShellConfig): AgentCommandShellConfig {
    const parsed = AgentCommandShellConfigSchema.parse(value)
    this.dependencies.settings.set('agentCommandShell', parsed)
    this.clearValidationCache()
    return parsed
  }

  clearValidationCache(): void {
    this.validationGeneration += 1
    this.validatedCandidates.clear()
    this.pendingValidations.clear()
    this.resolvedGitBashCandidate = null
  }

  async resolveForTurn(): Promise<ResolvedCommandShell> {
    if (this.getPlatform() !== 'win32') return this.resolveProfile('posix')

    const config = this.getConfig()
    switch (config.preference) {
      case 'auto':
        return resolveAutoWindowsShell(this.getEnvironment())
      case 'windows-powershell':
        return this.resolveProfile('windows-powershell')
      case 'git-bash':
        return this.resolveProfile('git-bash')
    }
  }

  async resolveProfile(profile: CommandShellProfile): Promise<ResolvedCommandShell> {
    const platform = this.getPlatform()
    if (profile === 'posix') {
      if (platform === 'win32') {
        throw new Error('The posix command shell profile is unavailable on Windows')
      }
      const { shell } = this.resolvePosixShell()
      return freezeResolvedCommandShell({
        profile: 'posix',
        dialect: 'posix',
        pathStyle: 'native',
        executable: shell,
        args: ['-c'],
        displayName: path.basename(shell) || shell
      })
    }

    if (platform !== 'win32') {
      throw new Error(`The ${profile} command shell profile is available only on Windows`)
    }

    if (profile === 'cmd') return resolveCmdShell()
    if (profile === 'windows-powershell') return resolveWindowsPowerShell()

    const availability = await this.checkGitBash()
    if (!availability.available) {
      throw new CommandShellUnavailableError(profile, availability.error)
    }
    return freezeResolvedCommandShell({
      profile: 'git-bash',
      dialect: 'posix',
      pathStyle: 'msys',
      executable: availability.executable,
      args: ['-c'],
      displayName: 'Git Bash'
    })
  }

  async checkGitBash(options: { forceRefresh?: boolean } = {}): Promise<GitBashAvailability> {
    if (this.getPlatform() !== 'win32') {
      return { supported: false, available: false, error: 'unsupported-platform' }
    }
    if (options.forceRefresh) this.clearValidationCache()
    const deadline = this.now() + GIT_BASH_DISCOVERY_TIMEOUT_MS

    const config = this.getConfig()
    const override = config.gitBashExecutableOverride
    if (override) {
      const normalized = normalizeWindowsExecutable(override)
      if (!normalized || !this.statFile(normalized)) {
        return { supported: true, available: false, error: 'override-invalid' }
      }
      return (
        (await this.validateCandidate(
          { executable: normalized, source: 'override' },
          deadline
        )) ?? {
          supported: true,
          available: false,
          error: 'validation-failed'
        }
      )
    }

    if (this.resolvedGitBashCandidate) {
      const cachedResult = await this.validateCandidate(this.resolvedGitBashCandidate, deadline)
      if (cachedResult) return cachedResult
      this.resolvedGitBashCandidate = null
    }

    const environment = this.getEnvironment()
    const commonCandidates = getCommonGitBashCandidates(environment)
    const commonResult = await this.findValidatedCandidate(commonCandidates, deadline)
    if (commonResult) return commonResult

    const gitCandidates = await this.findCandidatesFromGitPath(environment, deadline)
    const gitResult = await this.findValidatedCandidate(gitCandidates, deadline)
    if (gitResult) return gitResult

    const hasExistingCandidate = [...commonCandidates, ...gitCandidates].some((candidate) =>
      Boolean(this.statFile(candidate.executable))
    )
    return {
      supported: true,
      available: false,
      error: hasExistingCandidate || this.now() >= deadline ? 'validation-failed' : 'not-found'
    }
  }

  private async findCandidatesFromGitPath(
    environment: NodeJS.ProcessEnv,
    deadline: number
  ): Promise<GitBashCandidate[]> {
    try {
      const timeoutMs = this.remainingProbeTimeout(deadline)
      if (timeoutMs === null) return []
      const windowsDirectory = environment.SystemRoot || environment.windir || 'C:\\Windows'
      const whereExecutable = path.win32.join(windowsDirectory, 'System32', 'where.exe')
      const result = await this.runCommand(whereExecutable, ['git'], timeoutMs)
      return dedupeCandidates(
        result.stdout
          .split(/\r?\n/)
          .flatMap((gitExecutable) => deriveGitBashCandidates(gitExecutable))
      )
    } catch {
      return []
    }
  }

  private async findValidatedCandidate(
    candidates: GitBashCandidate[],
    deadline: number
  ): Promise<GitBashAvailability | null> {
    for (const candidate of dedupeCandidates(candidates)) {
      if (this.now() >= deadline) return null
      if (!this.statFile(candidate.executable)) continue
      const result = await this.validateCandidate(candidate, deadline)
      if (result) {
        this.resolvedGitBashCandidate = candidate
        return result
      }
    }
    return null
  }

  private async validateCandidate(
    candidate: GitBashCandidate,
    deadline: number
  ): Promise<GitBashAvailability | null> {
    const normalized = normalizeWindowsExecutable(candidate.executable)
    if (!normalized) return null

    const stat = this.statFile(normalized)
    if (!stat) return null
    const cacheKey = normalized.toLowerCase()
    const fileIdentity = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
    if (this.validatedCandidates.get(cacheKey)?.fileIdentity === fileIdentity) {
      return {
        supported: true,
        available: true,
        executable: normalized,
        source: candidate.source
      }
    }

    const generation = this.validationGeneration
    let pending = this.pendingValidations.get(cacheKey)
    if (!pending || pending.fileIdentity !== fileIdentity) {
      const versionTimeoutMs = this.remainingProbeTimeout(deadline)
      if (versionTimeoutMs === null) return null
      const promise = this.runCommand(normalized, ['--version'], versionTimeoutMs)
        .then(async () => {
          const identityTimeoutMs = this.remainingProbeTimeout(deadline)
          if (identityTimeoutMs === null) return false
          const identity = await this.runCommand(
            normalized,
            ['-c', GIT_BASH_IDENTITY_PROBE],
            identityTimeoutMs
          )
          return /^deepchat-bash:[^:\r\n]+:msys2?$/i.test(identity.stdout.trim())
        })
        .catch(() => false)
      pending = { fileIdentity, promise }
      this.pendingValidations.set(cacheKey, pending)
      void promise.finally(() => {
        if (this.pendingValidations.get(cacheKey)?.promise === promise) {
          this.pendingValidations.delete(cacheKey)
        }
      })
    }

    const valid = await pending.promise
    if (!valid || generation !== this.validationGeneration) return null
    this.validatedCandidates.set(cacheKey, { fileIdentity })
    return {
      supported: true,
      available: true,
      executable: normalized,
      source: candidate.source
    }
  }

  private remainingProbeTimeout(deadline: number): number | null {
    const remaining = deadline - this.now()
    if (remaining <= 0) return null
    return Math.max(1, Math.min(GIT_BASH_PROBE_TIMEOUT_MS, Math.ceil(remaining)))
  }
}

export { deriveGitBashCandidates, getCommonGitBashCandidates, resolveAutoWindowsShell }
