import type fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  CommandShellService,
  CommandShellUnavailableError,
  deriveGitBashCandidates
} from '@/agent/shared/process/commandShellService'
import type { AgentCommandShellConfig } from '@shared/commandShell'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

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
  const statFile = vi.fn(
    (candidate: string) => normalizedFiles.get(candidate.toLowerCase()) ?? null
  )
  const service = new CommandShellService({
    settings: settings as never,
    getPlatform: () => options.platform ?? 'win32',
    getEnvironment: () => options.environment ?? {},
    runCommand,
    statFile,
    resolvePosixShell: options.resolvePosixShell,
    now: options.now
  })

  return { runCommand, service, settings, normalizedFiles, statFile }
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

  it.each([
    ['darwin', 'git-bash'],
    ['linux', 'cmd'],
    ['win32', 'zsh']
  ] as const)('falls back from persisted %s-incompatible %s settings', (platform, preference) => {
    const { service } = createHarness({ config: { preference }, platform })

    expect(service.getConfig()).toEqual({ preference: 'auto' })
  })

  it('treats an invalid explicit override as authoritative and does not fall through', async () => {
    const executable = 'C:\\Missing\\bash.exe'
    const { service, runCommand, normalizedFiles } = createHarness({
      config: {
        preference: 'git-bash',
        gitBashExecutableOverride: executable
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

    normalizedFiles.set(executable.toLowerCase(), fileStat())
    await expect(service.checkGitBash()).resolves.toMatchObject({
      available: true,
      executable,
      source: 'override'
    })
    expect(runCommand).toHaveBeenCalledTimes(2)
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

  it('caches discovery failures briefly and retries after the TTL', async () => {
    let now = 0
    let whereProbeCount = 0
    const firstWhereResult = createDeferred<{ stdout: string; stderr: string }>()
    const { service, runCommand } = createHarness({
      config: { preference: 'git-bash' },
      now: () => now,
      runCommand: async (command) => {
        if (command.toLowerCase().endsWith('\\system32\\where.exe')) {
          whereProbeCount += 1
          return whereProbeCount === 1 ? firstWhereResult.promise : { stdout: '', stderr: '' }
        }
        return { stdout: '', stderr: '' }
      }
    })

    const firstCheck = service.checkGitBash()
    await vi.waitFor(() => expect(whereProbeCount).toBe(1))
    now = 10_000
    firstWhereResult.resolve({ stdout: '', stderr: '' })
    await expect(firstCheck).resolves.toMatchObject({
      available: false,
      error: 'not-found'
    })
    now = 39_999
    await expect(service.checkGitBash()).resolves.toMatchObject({
      available: false,
      error: 'not-found'
    })
    expect(runCommand).toHaveBeenCalledTimes(1)

    now = 40_000
    await expect(service.checkGitBash()).resolves.toMatchObject({
      available: false,
      error: 'not-found'
    })
    expect(runCommand).toHaveBeenCalledTimes(2)
  })

  it('isolates cached failures from caller mutation', async () => {
    const { service } = createHarness({ config: { preference: 'git-bash' } })

    await service.checkGitBash()
    const cachedResult = await service.checkGitBash()
    if (cachedResult.available || !cachedResult.supported) {
      throw new Error('Expected a supported Git Bash discovery failure')
    }
    cachedResult.error = 'validation-failed'

    await expect(service.checkGitBash()).resolves.toEqual({
      supported: true,
      available: false,
      error: 'not-found'
    })
  })

  it('invalidates cached failures on refresh and configuration changes', async () => {
    const { service, runCommand } = createHarness({ config: { preference: 'git-bash' } })

    await service.checkGitBash()
    await service.checkGitBash({ forceRefresh: true })
    service.setConfig({ preference: 'windows-powershell' })
    await service.checkGitBash()

    expect(runCommand).toHaveBeenCalledTimes(3)
  })

  it('shares one in-flight discovery across concurrent callers', async () => {
    const whereResult = createDeferred<{ stdout: string; stderr: string }>()
    const { service, runCommand } = createHarness({
      config: { preference: 'git-bash' },
      runCommand: async (command) => {
        if (command.toLowerCase().endsWith('\\system32\\where.exe')) {
          return whereResult.promise
        }
        return { stdout: '', stderr: '' }
      }
    })

    const first = service.checkGitBash()
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledOnce())
    const second = service.checkGitBash()
    expect(runCommand).toHaveBeenCalledOnce()

    whereResult.resolve({ stdout: '', stderr: '' })
    await expect(Promise.all([first, second])).resolves.toEqual([
      { supported: true, available: false, error: 'not-found' },
      { supported: true, available: false, error: 'not-found' }
    ])
    expect(runCommand).toHaveBeenCalledOnce()
  })

  it('does not let an old discovery cache a failure over a refreshed success', async () => {
    const executable = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const oldWhereResult = createDeferred<{ stdout: string; stderr: string }>()
    const { service, normalizedFiles, runCommand } = createHarness({
      config: { preference: 'git-bash' },
      runCommand: async (command, args) => {
        if (command.toLowerCase().endsWith('\\system32\\where.exe')) {
          return oldWhereResult.promise
        }
        return args[0] === '-c'
          ? { stdout: 'deepchat-bash:5.2.37(1)-release:msys', stderr: '' }
          : { stdout: 'GNU bash, version 5.2.37(1)-release', stderr: '' }
      }
    })

    const oldCheck = service.checkGitBash()
    await vi.waitFor(() =>
      expect(runCommand).toHaveBeenCalledWith(
        'C:\\Windows\\System32\\where.exe',
        ['git'],
        expect.any(Number)
      )
    )

    normalizedFiles.set(executable.toLowerCase(), fileStat())
    await expect(service.checkGitBash({ forceRefresh: true })).resolves.toMatchObject({
      available: true,
      executable
    })

    oldWhereResult.resolve({ stdout: '', stderr: '' })
    await expect(oldCheck).resolves.toMatchObject({
      available: false,
      error: 'validation-failed'
    })
    await expect(service.checkGitBash()).resolves.toMatchObject({
      available: true,
      executable
    })
  })

  it('returns an in-flight success after refresh without deleting the new validation', async () => {
    const executable = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const firstVersion = createDeferred<void>()
    const secondVersion = createDeferred<void>()
    let versionProbeCount = 0
    const { service, runCommand } = createHarness({
      config: { preference: 'git-bash' },
      files: { [executable]: fileStat() },
      runCommand: async (_command, args) => {
        if (args[0] === '--version') {
          versionProbeCount += 1
          await (versionProbeCount === 1 ? firstVersion.promise : secondVersion.promise)
          return { stdout: 'GNU bash, version 5.2.37(1)-release', stderr: '' }
        }
        return { stdout: 'deepchat-bash:5.2.37(1)-release:msys', stderr: '' }
      }
    })

    const inFlight = service.checkGitBash()
    await vi.waitFor(() => expect(versionProbeCount).toBe(1))

    const refreshed = service.checkGitBash({ forceRefresh: true })
    await vi.waitFor(() => expect(versionProbeCount).toBe(2))

    firstVersion.resolve()
    await expect(inFlight).resolves.toMatchObject({ available: true, executable })
    const joinedRefresh = service.checkGitBash()
    let joinedRefreshSettled = false
    void joinedRefresh.finally(() => {
      joinedRefreshSettled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(versionProbeCount).toBe(2)
    expect(joinedRefreshSettled).toBe(false)

    secondVersion.resolve()
    await expect(Promise.all([refreshed, joinedRefresh])).resolves.toEqual([
      expect.objectContaining({ available: true, executable }),
      expect.objectContaining({ available: true, executable })
    ])
    expect(runCommand.mock.calls.filter(([, args]) => args[0] === '--version')).toHaveLength(2)
  })

  it('does not let an old-generation success overwrite the current resolved candidate', async () => {
    const oldExecutable = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const currentExecutable = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
    const oldVersion = createDeferred<void>()
    const currentVersion = createDeferred<void>()
    const { service, normalizedFiles, statFile } = createHarness({
      config: { preference: 'git-bash' },
      files: { [oldExecutable]: fileStat() },
      runCommand: async (command, args) => {
        if (args[0] === '--version') {
          await (command === oldExecutable ? oldVersion.promise : currentVersion.promise)
          return { stdout: 'GNU bash, version 5.2.37(1)-release', stderr: '' }
        }
        return { stdout: 'deepchat-bash:5.2.37(1)-release:msys', stderr: '' }
      }
    })

    const earlierCheck = service.checkGitBash()
    await vi.waitFor(() =>
      expect(statFile).toHaveBeenCalledWith(expect.stringMatching(/Git\\bin\\bash\.exe$/))
    )

    normalizedFiles.delete(oldExecutable.toLowerCase())
    normalizedFiles.set(currentExecutable.toLowerCase(), fileStat())
    service.setConfig({ preference: 'windows-powershell' })
    const currentCheck = service.checkGitBash()

    currentVersion.resolve()
    await expect(currentCheck).resolves.toMatchObject({
      available: true,
      executable: currentExecutable
    })

    oldVersion.resolve()
    await expect(earlierCheck).resolves.toMatchObject({
      available: true,
      executable: oldExecutable
    })

    statFile.mockClear()
    await expect(service.checkGitBash()).resolves.toMatchObject({
      available: true,
      executable: currentExecutable
    })
    expect(statFile.mock.calls[0]?.[0]).toBe(currentExecutable)
  })

  it('does not let an old-generation failure clear the current resolved candidate', async () => {
    const oldExecutable = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const currentExecutable = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
    const staleVersion = createDeferred<void>()
    let now = 0
    let oldVersionProbeCount = 0
    const { service, normalizedFiles, statFile } = createHarness({
      config: { preference: 'git-bash' },
      files: { [oldExecutable]: fileStat(100, 1) },
      now: () => now,
      runCommand: async (command, args) => {
        if (command === oldExecutable && args[0] === '--version') {
          oldVersionProbeCount += 1
          if (oldVersionProbeCount === 2) await staleVersion.promise
        }
        return args[0] === '-c'
          ? { stdout: 'deepchat-bash:5.2.37(1)-release:msys', stderr: '' }
          : { stdout: 'GNU bash, version 5.2.37(1)-release', stderr: '' }
      }
    })

    await expect(service.checkGitBash()).resolves.toMatchObject({
      available: true,
      executable: oldExecutable
    })
    normalizedFiles.set(oldExecutable.toLowerCase(), fileStat(101, 2))
    const staleCheck = service.checkGitBash()
    await vi.waitFor(() => expect(oldVersionProbeCount).toBe(2))

    normalizedFiles.delete(oldExecutable.toLowerCase())
    normalizedFiles.set(currentExecutable.toLowerCase(), fileStat())
    await expect(service.checkGitBash({ forceRefresh: true })).resolves.toMatchObject({
      available: true,
      executable: currentExecutable
    })

    now = 15_000
    staleVersion.reject(new Error('stale probe failed'))
    await expect(staleCheck).resolves.toEqual({
      supported: true,
      available: false,
      error: 'validation-failed'
    })

    now = 16_000
    statFile.mockClear()
    await expect(service.checkGitBash()).resolves.toMatchObject({
      available: true,
      executable: currentExecutable
    })
    expect(statFile.mock.calls[0]?.[0]).toBe(currentExecutable)
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

  it('wraps the current non-Windows shell for Auto', async () => {
    const { service, runCommand } = createHarness({
      config: { preference: 'auto' },
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

  it.each([
    ['bash', '/bin/bash', 'Bash'],
    ['zsh', '/bin/zsh', 'Zsh'],
    ['fish', '/bin/fish', 'Fish']
  ] as const)(
    'resolves an explicit %s profile on POSIX platforms',
    async (preference, executable, displayName) => {
      const { service, runCommand } = createHarness({
        config: { preference },
        platform: 'linux',
        files: { [executable]: fileStat() },
        resolvePosixShell: () => ({ shell: '/bin/sh', args: ['-c'] })
      })

      await expect(service.resolveForTurn()).resolves.toEqual({
        profile: preference,
        dialect: 'posix',
        pathStyle: 'native',
        executable,
        args: ['-c'],
        displayName
      })
      expect(runCommand).not.toHaveBeenCalled()
    }
  )

  it('validates PowerShell 7 once and keeps Command Prompt probe-free', async () => {
    const powershell = createHarness({
      config: { preference: 'powershell-core' },
      runCommand: async () => ({ stdout: 'deepchat-pwsh:7.5.2', stderr: '' })
    })
    const cmd = createHarness({ config: { preference: 'cmd' } })

    await expect(powershell.service.resolveForTurn()).resolves.toMatchObject({
      profile: 'powershell-core',
      executable: 'pwsh.exe',
      displayName: 'PowerShell 7'
    })
    await powershell.service.resolveForTurn()
    expect(powershell.runCommand).toHaveBeenCalledOnce()
    await expect(cmd.service.resolveForTurn()).resolves.toMatchObject({
      profile: 'cmd',
      executable: 'cmd.exe'
    })
    expect(cmd.runCommand).not.toHaveBeenCalled()
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
