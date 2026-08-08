import type fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  CommandShellService,
  CommandShellUnavailableError,
  deriveGitBashCandidates
} from '@/agent/shared/process/commandShellService'
import type { AgentCommandShellConfig } from '@shared/commandShell'

function fileStat(size = 100, mtimeMs = 1): fs.Stats {
  return {
    isFile: () => true,
    size,
    mtimeMs
  } as fs.Stats
}

function createHarness(options: {
  config?: unknown
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  files?: Record<string, fs.Stats>
  resolvePosixShell?: () => { shell: string; args: string[] }
  runCommand?: (
    executable: string,
    args: readonly string[],
    timeoutMs: number
  ) => Promise<{
    stdout: string
    stderr: string
  }>
  now?: () => number
}) {
  let storedConfig = options.config
  const settings = {
    get: vi.fn(() => storedConfig),
    set: vi.fn((_key: string, value: AgentCommandShellConfig) => {
      storedConfig = value
    })
  }
  const normalizedFiles = new Map(
    Object.entries(options.files ?? {}).map(([candidate, stat]) => [candidate.toLowerCase(), stat])
  )
  const runCommand = vi.fn(
    options.runCommand ??
      (async (_executable, args) => {
        if (args[0] === '--version') {
          return { stdout: 'GNU bash, version 5.2.37(1)-release', stderr: '' }
        }
        if (args[0] === '-c') {
          return { stdout: 'deepchat-bash:5.2.37(1)-release:msys', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      })
  )
  const service = new CommandShellService({
    settings: settings as never,
    getPlatform: () => options.platform ?? 'win32',
    getEnvironment: () => options.environment ?? {},
    runCommand,
    statFile: (candidate) => normalizedFiles.get(candidate.toLowerCase()) ?? null,
    resolvePosixShell: options.resolvePosixShell,
    now: options.now
  })

  return { runCommand, service, settings, normalizedFiles }
}

describe('CommandShellService', () => {
  it('preserves the existing Auto PowerShell and CMD branches without probing Git Bash', async () => {
    const powershell = createHarness({
      config: { preference: 'auto' },
      environment: { PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules' }
    })
    const cmd = createHarness({ config: { preference: 'auto' } })

    await expect(powershell.service.resolveForTurn()).resolves.toMatchObject({
      profile: 'windows-powershell',
      executable: 'powershell.exe',
      args: ['-NoProfile', '-Command']
    })
    await expect(cmd.service.resolveForTurn()).resolves.toMatchObject({
      profile: 'cmd',
      executable: 'cmd.exe',
      args: ['/c']
    })
    expect(powershell.runCommand).not.toHaveBeenCalled()
    expect(cmd.runCommand).not.toHaveBeenCalled()
  })

  it('normalizes malformed stored settings to Auto and validates updates atomically', () => {
    const { service, settings } = createHarness({ config: { preference: 'pwsh' } })

    expect(service.getConfig()).toEqual({ preference: 'auto' })
    expect(
      service.setConfig({
        preference: 'git-bash',
        gitBashExecutableOverride: ' C:\\Portable Git\\bin\\bash.exe '
      })
    ).toEqual({
      preference: 'git-bash',
      gitBashExecutableOverride: 'C:\\Portable Git\\bin\\bash.exe'
    })
    expect(settings.set).toHaveBeenCalledOnce()
  })

  it('treats an invalid explicit override as authoritative and does not fall through', async () => {
    const { service, runCommand } = createHarness({
      config: {
        preference: 'git-bash',
        gitBashExecutableOverride: 'C:\\Missing\\bash.exe'
      }
    })

    await expect(service.checkGitBash()).resolves.toEqual({
      supported: true,
      available: false,
      error: 'override-invalid'
    })
    expect(runCommand).not.toHaveBeenCalled()
    await expect(service.resolveForTurn()).rejects.toEqual(
      expect.objectContaining<Partial<CommandShellUnavailableError>>({
        name: 'CommandShellUnavailableError',
        profile: 'git-bash',
        reason: 'override-invalid'
      })
    )
  })

  it('validates a common installation with bash --version and caches the file identity', async () => {
    const executable = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const { service, runCommand, normalizedFiles } = createHarness({
      config: { preference: 'git-bash' },
      files: { [executable]: fileStat(100, 1) }
    })

    await expect(service.checkGitBash()).resolves.toEqual({
      supported: true,
      available: true,
      executable,
      source: 'common-path'
    })
    await service.checkGitBash()
    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(runCommand).toHaveBeenCalledWith(executable, ['--version'], expect.any(Number))
    expect(runCommand).toHaveBeenCalledWith(
      executable,
      ['-c', 'printf "deepchat-bash:%s:%s" "$BASH_VERSION" "$OSTYPE"'],
      expect.any(Number)
    )

    normalizedFiles.set(executable.toLowerCase(), fileStat(101, 2))
    await service.checkGitBash()
    expect(runCommand).toHaveBeenCalledTimes(4)

    await service.checkGitBash({ forceRefresh: true })
    expect(runCommand).toHaveBeenCalledTimes(6)
  })

  it('derives Git Bash from where git after common paths miss', async () => {
    const executable = 'D:\\Tools\\Git\\bin\\bash.exe'
    const { service, runCommand } = createHarness({
      config: { preference: 'git-bash' },
      files: { [executable]: fileStat() },
      runCommand: async (command, args) => {
        if (command.toLowerCase().endsWith('\\system32\\where.exe')) {
          return { stdout: 'D:\\Tools\\Git\\cmd\\git.exe\r\n', stderr: '' }
        }
        return args[0] === '--version'
          ? { stdout: 'GNU bash, version 5.2.37(1)-release', stderr: '' }
          : { stdout: 'deepchat-bash:5.2.37(1)-release:msys', stderr: '' }
      }
    })

    await expect(service.checkGitBash()).resolves.toEqual({
      supported: true,
      available: true,
      executable,
      source: 'git-path'
    })
    await expect(service.checkGitBash()).resolves.toMatchObject({ executable, source: 'git-path' })
    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      'C:\\Windows\\System32\\where.exe',
      ['git'],
      expect.any(Number)
    )
    expect(runCommand).toHaveBeenNthCalledWith(2, executable, ['--version'], expect.any(Number))
    expect(runCommand).toHaveBeenNthCalledWith(
      3,
      executable,
      ['-c', 'printf "deepchat-bash:%s:%s" "$BASH_VERSION" "$OSTYPE"'],
      expect.any(Number)
    )
    expect(runCommand).toHaveBeenCalledTimes(3)
  })

  it('rejects an executable that runs successfully but is not GNU Bash', async () => {
    const executable = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const { service } = createHarness({
      config: { preference: 'git-bash' },
      files: { [executable]: fileStat() },
      runCommand: async (command) =>
        command.toLowerCase().endsWith('\\system32\\where.exe')
          ? { stdout: '', stderr: '' }
          : { stdout: 'not actually bash', stderr: '' }
    })

    await expect(service.checkGitBash()).resolves.toEqual({
      supported: true,
      available: false,
      error: 'validation-failed'
    })
  })

  it('rejects GNU Bash builds that do not provide MSYS path semantics', async () => {
    const executable = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const { service } = createHarness({
      config: { preference: 'git-bash' },
      files: { [executable]: fileStat() },
      runCommand: async (_command, args) =>
        args[0] === '--version'
          ? { stdout: 'GNU bash, version 5.2.37(1)-release', stderr: '' }
          : { stdout: 'deepchat-bash:5.2.37(1)-release:linux-gnu', stderr: '' }
    })

    await expect(service.checkGitBash()).resolves.toEqual({
      supported: true,
      available: false,
      error: 'validation-failed'
    })
  })

  it('does not depend on localized bash --version output', async () => {
    const executable = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const { service } = createHarness({
      config: { preference: 'git-bash' },
      files: { [executable]: fileStat() },
      runCommand: async (_command, args) =>
        args[0] === '--version'
          ? { stdout: 'GNU bash\uff0c\u7248\u672c 5.2.37', stderr: '' }
          : { stdout: 'deepchat-bash:5.2.37(1)-release:msys', stderr: '' }
    })

    await expect(service.checkGitBash()).resolves.toMatchObject({
      available: true,
      executable
    })
  })

  it('bounds discovery across multiple damaged candidates', async () => {
    let now = 0
    const candidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe'
    ]
    const { runCommand, service } = createHarness({
      config: { preference: 'git-bash' },
      files: Object.fromEntries(candidates.map((candidate) => [candidate, fileStat()])),
      now: () => now,
      runCommand: async (_command, _args, timeoutMs) => {
        now += timeoutMs
        throw new Error('probe timed out')
      }
    })

    await expect(service.checkGitBash()).resolves.toEqual({
      supported: true,
      available: false,
      error: 'validation-failed'
    })
    expect(runCommand).toHaveBeenCalledTimes(3)
    expect(runCommand.mock.calls.map((call) => call[2])).toEqual([5_000, 5_000, 5_000])
  })

  it('resolves a recorded Windows profile independently of the current preference', async () => {
    const { service } = createHarness({ config: { preference: 'auto' } })

    await expect(service.resolveProfile('windows-powershell')).resolves.toMatchObject({
      profile: 'windows-powershell',
      dialect: 'powershell'
    })
    await expect(service.resolveProfile('cmd')).resolves.toMatchObject({
      profile: 'cmd',
      dialect: 'cmd'
    })
  })

  it('wraps the current non-Windows shell without applying Windows preferences', async () => {
    const { service, runCommand } = createHarness({
      config: { preference: 'git-bash' },
      platform: 'darwin',
      resolvePosixShell: () => ({ shell: '/opt/homebrew/bin/fish', args: ['-c'] })
    })

    const resolved = await service.resolveForTurn()

    expect(resolved).toEqual({
      profile: 'posix',
      dialect: 'posix',
      pathStyle: 'native',
      executable: '/opt/homebrew/bin/fish',
      args: ['-c'],
      displayName: 'fish'
    })
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.args)).toBe(true)
    expect(runCommand).not.toHaveBeenCalled()
  })
})

describe('deriveGitBashCandidates', () => {
  it('rejects non-absolute and non-git executable results', () => {
    expect(deriveGitBashCandidates('git.exe')).toEqual([])
    expect(deriveGitBashCandidates('C:\\Tools\\git.cmd')).toEqual([])
  })

  it('supports standard cmd and portable bin layouts', () => {
    expect(deriveGitBashCandidates('C:\\Git\\cmd\\git.exe')).toContainEqual({
      executable: 'C:\\Git\\bin\\bash.exe',
      source: 'git-path'
    })
    expect(deriveGitBashCandidates('C:\\PortableGit\\bin\\git.exe')).toContainEqual({
      executable: 'C:\\PortableGit\\bin\\bash.exe',
      source: 'git-path'
    })
  })
})
