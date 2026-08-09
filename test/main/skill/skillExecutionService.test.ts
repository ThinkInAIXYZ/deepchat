import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillServicePort } from '../../../src/shared/types/skill'
import { SkillExecutionService } from '../../../src/main/skill/skillExecutionService'
import {
  CMD_COMMAND_SHELL,
  GIT_BASH_COMMAND_SHELL,
  POSIX_COMMAND_SHELL,
  WINDOWS_POWERSHELL_COMMAND_SHELL
} from '../../helpers/commandShell'

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/mock/app',
    getPath: () => '/mock/userData'
  }
}))

vi.mock('@/agent/shared/process/shellEnvHelper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/agent/shared/process/shellEnvHelper')>()

  return {
    ...actual,
    getShellEnvironment: vi.fn().mockResolvedValue({ PATH: '/shell/bin' })
  }
})

vi.mock('@/agent/shared/process/rtkRuntimeService', () => ({
  RTK_ENABLED_SETTING_KEY: 'rtkEnabled',
  rtkRuntimeService: {
    prepareShellCommand: vi
      .fn()
      .mockImplementation(async (command: string, env: Record<string, string>) => ({
        originalCommand: command,
        command,
        env,
        rewritten: false,
        usedRtk: false,
        rtkApplied: false,
        rtkMode: 'bypass'
      })),
    prepareExecutionEnv: vi.fn().mockImplementation(async (env: Record<string, string>) => env)
  }
}))

import { spawn } from 'child_process'
import { backgroundExecSessionManager } from '@/agent/shared/process/backgroundExecSessionManager'
import { getShellEnvironment } from '@/agent/shared/process/shellEnvHelper'
import { rtkRuntimeService } from '@/agent/shared/process/rtkRuntimeService'

describe('SkillExecutionService', () => {
  let skillService: SkillServicePort
  let service: SkillExecutionService
  let resolveConversationWorkdir: ReturnType<typeof vi.fn>
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(spawn).mockReset()
    vi.mocked(getShellEnvironment).mockResolvedValue({ PATH: '/shell/bin' })
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    vi.mocked(fs.promises.stat).mockResolvedValue({
      isDirectory: () => true
    } as never)

    skillService = {
      resolveSessionAgentId: vi.fn().mockResolvedValue('deepchat'),
      getActiveSkills: vi.fn().mockResolvedValue(['ocr']),
      getMetadataList: vi.fn().mockResolvedValue([
        {
          name: 'ocr',
          description: 'OCR helper',
          path: '/skills/ocr/SKILL.md',
          skillRoot: '/skills/ocr'
        }
      ]),
      readSkillFile: vi.fn().mockResolvedValue('---\nname: ocr\ndescription: OCR helper\n---\n'),
      getSkillExtensionForAgent: vi.fn().mockResolvedValue({
        version: 1,
        env: { API_KEY: 'secret' },
        runtimePolicy: { python: 'auto', node: 'auto' },
        scriptOverrides: {}
      }),
      saveSkillWithExtension: vi.fn().mockResolvedValue({ success: true, skillName: 'ocr' }),
      listSkillScriptsForAgent: vi.fn().mockResolvedValue([
        {
          name: 'run.py',
          relativePath: 'scripts/run.py',
          absolutePath: '/skills/ocr/scripts/run.py',
          runtime: 'python',
          enabled: true
        }
      ])
    } as unknown as SkillServicePort

    resolveConversationWorkdir = vi.fn().mockResolvedValue('/workspace/session')
    service = new SkillExecutionService(
      skillService,
      {
        get: vi.fn().mockReturnValue(true)
      } as never,
      {
        resolveConversationWorkdir
      }
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  const resolvePath = (targetPath: string) => path.resolve(targetPath)

  it('hides the Windows console for runtime availability probes', async () => {
    const child = new EventEmitter()
    vi.mocked(spawn).mockReturnValue(child as never)

    const available = (service as never).hasCommand('uv.exe', ['--version'], {
      PATH: 'C:\\runtime'
    })
    child.emit('close', 0)

    await expect(available).resolves.toBe(true)
    expect(spawn).toHaveBeenCalledWith('uv.exe', ['--version'], {
      env: { PATH: 'C:\\runtime' },
      stdio: 'ignore',
      shell: false,
      windowsHide: true
    })
  })

  it('builds spawn plan with session workdir cwd and skill root env', async () => {
    vi.spyOn(service as never, 'resolveRuntimeCommand' as never).mockResolvedValue({
      command: 'uv',
      mode: 'uv'
    })

    const plan = await (service as never).buildSpawnPlan(
      {
        skill: 'ocr',
        script: 'scripts/run.py',
        args: ['--lang', 'en']
      },
      'conv-1',
      POSIX_COMMAND_SHELL
    )

    expect(plan.cwd).toBe(resolvePath('/workspace/session'))
    expect(plan.env.PATH).toContain('/shell/bin')
    expect(plan.env.API_KEY).toBe('secret')
    expect(plan.env.SKILL_ROOT).toBe('/skills/ocr')
    expect(plan.env.DEEPCHAT_SKILL_ROOT).toBe('/skills/ocr')
    expect(plan.args).toEqual(['run', '/skills/ocr/scripts/run.py', '--lang', 'en'])
  })

  it('uses a session cwd when the conversation workdir is unavailable', async () => {
    resolveConversationWorkdir.mockResolvedValueOnce(null)
    vi.spyOn(service as never, 'resolveRuntimeCommand' as never).mockResolvedValue({
      command: 'uv',
      mode: 'uv'
    })

    const plan = await (service as never).buildSpawnPlan(
      {
        skill: 'ocr',
        script: 'scripts/run.py'
      },
      'conv-1',
      POSIX_COMMAND_SHELL
    )

    const sessionDir = path.resolve(os.homedir(), '.deepchat', 'sessions', 'conv-1')
    expect(plan.cwd).toBe(sessionDir)
    expect(fs.mkdirSync).toHaveBeenCalledWith(sessionDir, { recursive: true })
  })

  it('uses a session cwd when the resolved conversation workdir is not a directory', async () => {
    vi.mocked(fs.promises.stat).mockResolvedValueOnce({
      isDirectory: () => false
    } as never)
    vi.spyOn(service as never, 'resolveRuntimeCommand' as never).mockResolvedValue({
      command: 'uv',
      mode: 'uv'
    })

    const plan = await (service as never).buildSpawnPlan(
      {
        skill: 'ocr',
        script: 'scripts/run.py'
      },
      'conv-1',
      POSIX_COMMAND_SHELL
    )

    expect(plan.cwd).toBe(path.resolve(os.homedir(), '.deepchat', 'sessions', 'conv-1'))
  })

  it('falls back to skill root cwd when a session cwd cannot be created', async () => {
    resolveConversationWorkdir.mockResolvedValueOnce(null)
    vi.mocked(fs.mkdirSync).mockImplementationOnce(() => {
      throw new Error('mkdir failed')
    })
    vi.spyOn(service as never, 'resolveRuntimeCommand' as never).mockResolvedValue({
      command: 'uv',
      mode: 'uv'
    })

    const plan = await (service as never).buildSpawnPlan(
      {
        skill: 'ocr',
        script: 'scripts/run.py'
      },
      'conv-1',
      POSIX_COMMAND_SHELL
    )

    expect(plan.cwd).toBe(resolvePath('/skills/ocr'))
  })

  it('falls back to bundled uv for python auto runtime', async () => {
    vi.spyOn(service as never, 'hasCommand' as never).mockResolvedValue(false)
    vi.spyOn(service as never, 'getBundledRuntimeCommand' as never).mockImplementation(
      (command: 'uv' | 'node') => (command === 'uv' ? '/runtime/uv' : null)
    )

    const runtime = await (service as never).resolvePythonRuntime(
      'auto',
      { PATH: '/bin' },
      '/skill'
    )

    expect(runtime).toEqual({
      command: '/runtime/uv',
      mode: 'uv'
    })
  })

  it('reports unavailable python runtime when uv and system python are missing', async () => {
    vi.spyOn(service as never, 'hasCommand' as never).mockResolvedValue(false)
    vi.spyOn(service as never, 'getBundledRuntimeCommand' as never).mockReturnValue(null)
    vi.spyOn(service as never, 'findSystemPythonRuntime' as never).mockResolvedValue(null)

    await expect(
      (service as never).resolvePythonRuntime('auto', { PATH: '/bin' }, '/skill')
    ).rejects.toThrow('No compatible Python runtime found for this skill')
  })

  it.each([WINDOWS_POWERSHELL_COMMAND_SHELL, CMD_COMMAND_SHELL])(
    'rejects Windows shell skills under the $displayName profile',
    async (commandShell) => {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })

      await expect(
        (service as never).resolveRuntimeCommand(
          { runtime: 'shell' },
          { runtimePolicy: {} },
          '/skills/ocr',
          {},
          commandShell
        )
      ).rejects.toThrow('Shell skill scripts on Windows require the Git Bash command shell')
    }
  )

  it('runs Windows shell skills through the selected Git Bash profile', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })

    await expect(
      (service as never).resolveRuntimeCommand(
        { runtime: 'shell' },
        { runtimePolicy: {} },
        '/skills/ocr',
        {},
        GIT_BASH_COMMAND_SHELL
      )
    ).resolves.toEqual({ command: GIT_BASH_COMMAND_SHELL.executable, mode: 'shell' })
  })

  it('switches to shell spawn mode when RTK rewrites the command', async () => {
    vi.mocked(rtkRuntimeService.prepareShellCommand).mockResolvedValueOnce({
      originalCommand: 'node /skills/ocr/scripts/run.py',
      command: 'rtk run -- node /skills/ocr/scripts/run.py',
      env: { PATH: '/shell/bin', API_KEY: 'secret', RTK_DB_PATH: '/mock/rtk.db' },
      rewritten: true,
      usedRtk: true,
      rtkApplied: true,
      rtkMode: 'rewrite'
    })

    const preparedPlan = await (service as never).preparePlanForExecution(
      {
        command: 'node',
        args: ['/skills/ocr/scripts/run.py'],
        cwd: '/skills/ocr',
        env: { PATH: '/shell/bin', API_KEY: 'secret' },
        shellCommand: 'node /skills/ocr/scripts/run.py',
        outputPrefix: 'skill_ocr',
        spawnMode: 'direct'
      },
      POSIX_COMMAND_SHELL
    )

    expect(preparedPlan.spawnMode).toBe('shell')
    expect(preparedPlan.shellCommand).toBe('rtk run -- node /skills/ocr/scripts/run.py')
    expect(preparedPlan.env.RTK_DB_PATH).toBe('/mock/rtk.db')
  })

  it('rejects scripts that are not declared under scripts directory', async () => {
    await expect(
      service.execute(
        {
          skill: 'ocr',
          script: '../hack.py'
        },
        { conversationId: 'conv-1', commandShell: POSIX_COMMAND_SHELL }
      )
    ).rejects.toThrow(/not found/)
  })

  it('preserves the Agent preview limit for background skill sessions', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
    const plan = {
      command: 'python',
      args: ['script.py'],
      cwd: '/skills/ocr',
      env: { PATH: '/bin' },
      shellCommand: 'python script.py',
      outputPrefix: 'skill_ocr',
      spawnMode: 'direct'
    }
    vi.spyOn(service as never, 'buildSpawnPlan' as never).mockResolvedValue(plan)
    vi.spyOn(service as never, 'preparePlanForExecution' as never).mockResolvedValue(plan)
    const start = vi
      .spyOn(backgroundExecSessionManager, 'start')
      .mockResolvedValue({ sessionId: 'bg_skill', status: 'running' })

    await service.execute(
      { skill: 'ocr', script: 'scripts/run.py', background: true },
      {
        conversationId: 'conv-1',
        commandShell: POSIX_COMMAND_SHELL,
        outputPreviewChars: 7_000
      }
    )

    expect(start).toHaveBeenCalledWith(
      'conv-1',
      'python script.py',
      resolvePath('/skills/ocr'),
      expect.objectContaining({
        commandShell: POSIX_COMMAND_SHELL,
        previewChars: 7_000,
        offloadThresholdChars: 7_000
      })
    )
  })

  it('does not commit dispatch when the resolved spawn cwd is unusable', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const plan = {
      command: 'python',
      args: ['/skills/ocr/scripts/run.py'],
      cwd: '/missing/workspace',
      env: { PATH: '/bin' },
      shellCommand: "'python' '/skills/ocr/scripts/run.py'",
      outputPrefix: 'skill_ocr',
      spawnMode: 'direct' as const
    }
    vi.spyOn(service as never, 'buildSpawnPlan' as never).mockResolvedValue(plan)
    vi.spyOn(service as never, 'preparePlanForExecution' as never).mockResolvedValue(plan)
    const runForeground = vi.spyOn(service as never, 'runForeground' as never)
    const beforeExecute = vi.fn()

    await expect(
      service.execute(
        { skill: 'ocr', script: 'scripts/run.py' },
        { conversationId: 'conv-1', commandShell: POSIX_COMMAND_SHELL, beforeExecute }
      )
    ).rejects.toThrow('Working directory does not exist or is not accessible')

    expect(beforeExecute).not.toHaveBeenCalled()
    expect(runForeground).not.toHaveBeenCalled()
  })

  it('commits the resolved spawn plan before starting the skill process', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
    const plan = {
      command: 'python',
      args: ['/skills/ocr/scripts/run.py', '--lang', 'en'],
      cwd: '/workspace/session',
      env: { PATH: '/bin', API_KEY: 'secret' },
      shellCommand: "'python' '/skills/ocr/scripts/run.py' '--lang' 'en'",
      outputPrefix: 'skill_ocr',
      spawnMode: 'direct' as const
    }
    vi.spyOn(service as never, 'buildSpawnPlan' as never).mockResolvedValue(plan)
    vi.spyOn(service as never, 'preparePlanForExecution' as never).mockResolvedValue(plan)
    const order: string[] = []
    vi.spyOn(service as never, 'runForeground' as never).mockImplementation(async () => {
      order.push('spawn')
      return { output: 'ok' }
    })
    const beforeExecute = vi.fn(() => order.push('commit'))

    await service.execute(
      {
        skill: 'ocr',
        script: 'scripts/run.py',
        args: ['--lang', 'en'],
        stdin: 'input',
        timeoutMs: 5000
      },
      { conversationId: 'conv-1', commandShell: POSIX_COMMAND_SHELL, beforeExecute }
    )

    expect(order).toEqual(['commit', 'spawn'])
    expect(beforeExecute).toHaveBeenCalledWith({
      skill: 'ocr',
      script: 'scripts/run.py',
      args: ['--lang', 'en'],
      stdin: 'input',
      background: false,
      timeoutMs: 5000,
      resolvedCommand: 'python',
      resolvedArgs: ['/skills/ocr/scripts/run.py', '--lang', 'en'],
      resolvedCwd: path.resolve('/workspace/session'),
      shellCommand: "'python' '/skills/ocr/scripts/run.py' '--lang' 'en'",
      spawnMode: 'direct'
    })
  })

  it('keeps Command Prompt skill plans direct and bypasses shell rewriting', async () => {
    vi.spyOn(service as never, 'resolveRuntimeCommand' as never).mockResolvedValue({
      command: 'node.exe',
      mode: 'node'
    })

    const plan = await (service as never).buildSpawnPlan(
      {
        skill: 'ocr',
        script: 'scripts/run.py',
        args: ['value%PATH%', '"quoted"', '& whoami', '!delayed!', 'line one\r\nline two']
      },
      'conv-1',
      CMD_COMMAND_SHELL
    )
    const prepared = await (service as never).preparePlanForExecution(plan, CMD_COMMAND_SHELL)

    expect(plan.shellCommand).toBeUndefined()
    expect(prepared.spawnMode).toBe('direct')
    expect(rtkRuntimeService.prepareExecutionEnv).toHaveBeenCalledWith(plan.env)
    expect(rtkRuntimeService.prepareShellCommand).not.toHaveBeenCalled()
  })

  it('keeps PowerShell skill plans direct and bypasses POSIX RTK rewriting', async () => {
    vi.spyOn(service as never, 'resolveRuntimeCommand' as never).mockResolvedValue({
      command: 'node.exe',
      mode: 'node'
    })

    const plan = await (service as never).buildSpawnPlan(
      {
        skill: 'ocr',
        script: 'scripts/run.py',
        args: ['value;still-an-argument']
      },
      'conv-1',
      WINDOWS_POWERSHELL_COMMAND_SHELL
    )
    const prepared = await (service as never).preparePlanForExecution(
      plan,
      WINDOWS_POWERSHELL_COMMAND_SHELL
    )

    expect(prepared.spawnMode).toBe('direct')
    expect(prepared.shellCommand).toBeUndefined()
    expect(rtkRuntimeService.prepareExecutionEnv).toHaveBeenCalledWith(plan.env)
    expect(rtkRuntimeService.prepareShellCommand).not.toHaveBeenCalled()
  })

  it('passes background skill arguments as a direct invocation', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
    const args = [
      '/skills/ocr/scripts/run.js',
      'value%PATH%',
      '"quoted"',
      '& whoami',
      '!delayed!',
      'line one\r\nline two',
      'trailing\\'
    ]
    const plan = {
      command: 'node.exe',
      args,
      cwd: '/workspace/session',
      env: { PATH: 'C:\\runtime' },
      outputPrefix: 'skill_ocr',
      spawnMode: 'direct' as const
    }
    vi.spyOn(service as never, 'buildSpawnPlan' as never).mockResolvedValue(plan)
    vi.spyOn(service as never, 'preparePlanForExecution' as never).mockResolvedValue(plan)
    const start = vi.spyOn(backgroundExecSessionManager, 'start').mockResolvedValue({
      sessionId: 'bg_skill',
      status: 'running'
    })

    await expect(
      service.execute(
        { skill: 'ocr', script: 'scripts/run.py', background: true },
        { conversationId: 'conv-1', commandShell: CMD_COMMAND_SHELL }
      )
    ).resolves.toMatchObject({
      output: { status: 'running', sessionId: 'bg_skill' }
    })

    expect(start).toHaveBeenCalledWith(
      'conv-1',
      expect.any(String),
      path.resolve('/workspace/session'),
      {
        commandShell: CMD_COMMAND_SHELL,
        directInvocation: {
          executable: 'node.exe',
          args
        },
        timeout: 120000,
        env: { PATH: 'C:\\runtime' },
        previewChars: 12000,
        offloadThresholdChars: 10000
      }
    )
  })

  it('uses the PowerShell call operator for quoted executables', () => {
    expect(
      (service as never).buildShellCommand(
        'C:\\Program Files\\Python\\python.exe',
        ['script path\\run.py'],
        'powershell'
      )
    ).toBe("& 'C:\\Program Files\\Python\\python.exe' 'script path\\run.py'")
  })

  it('wraps Windows shell-mode foreground commands with UTF-8 output setup', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })
    class MockStream extends EventEmitter {
      destroy = vi.fn()
    }

    class MockChild extends EventEmitter {
      stdout = new MockStream()
      stderr = new MockStream()
      stdin = {
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn()
      }
      kill = vi.fn()
    }

    const child = new MockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.spyOn(service as never, 'createForegroundOutputPath' as never).mockReturnValue(null)

    const resultPromise = (service as never).runForeground(
      {
        command: 'node',
        args: ['script.js'],
        cwd: '/skills/ocr',
        env: { PATH: '/bin' },
        shellCommand: 'dir',
        outputPrefix: 'skill_ocr',
        spawnMode: 'shell'
      },
      1000,
      'conv-1',
      WINDOWS_POWERSHELL_COMMAND_SHELL
    )

    child.stdout.emit('data', Buffer.from('ok\n'))
    child.emit('close', 0)

    const result = await resultPromise

    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-Command', expect.stringContaining('[Console]::OutputEncoding')],
      expect.objectContaining({
        shell: false,
        env: expect.objectContaining({
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1'
        })
      })
    )
    expect(result.output).toContain('ok')
    expect(result.output).toContain('Exit Code: 0')
  })

  it('decodes split UTF-8 foreground output', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })

    class MockStream extends EventEmitter {
      destroy = vi.fn()
    }

    class MockChild extends EventEmitter {
      stdout = new MockStream()
      stderr = new MockStream()
      stdin = {
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn()
      }
      kill = vi.fn()
    }

    const child = new MockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.spyOn(service as never, 'createForegroundOutputPath' as never).mockReturnValue(null)

    const resultPromise = (service as never).runForeground(
      {
        command: 'python',
        args: ['script.py'],
        cwd: '/skills/ocr',
        env: { PATH: '/bin' },
        shellCommand: 'python script.py',
        outputPrefix: 'skill_ocr',
        spawnMode: 'direct'
      },
      1000,
      'conv-1',
      POSIX_COMMAND_SHELL
    )

    const bytes = Buffer.from('中文.txt\n', 'utf8')
    child.stdout.emit('data', bytes.subarray(0, 2))
    child.stdout.emit('data', bytes.subarray(2))
    child.emit('close', 0)

    const result = await resultPromise

    expect(spawn).toHaveBeenCalledWith(
      'python',
      ['script.py'],
      expect.objectContaining({
        env: expect.objectContaining({
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1'
        })
      })
    )
    expect(result.output).toContain('中文.txt')
    expect(result.output).toContain('Exit Code: 0')
  })

  it('escalates to SIGKILL when foreground timeout grace expires', async () => {
    vi.useFakeTimers()

    class MockStream extends EventEmitter {
      setEncoding = vi.fn()
      destroy = vi.fn()
    }

    class MockChild extends EventEmitter {
      stdout = new MockStream()
      stderr = new MockStream()
      stdin = {
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn()
      }
      unref = vi.fn()
      kill = vi.fn((signal?: NodeJS.Signals) => {
        if (signal === 'SIGKILL') {
          this.emit('close', null)
        }
        return true
      })
    }

    const child = new MockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.spyOn(service as never, 'createForegroundOutputPath' as never).mockReturnValue(null)

    const resultPromise = (service as never).runForeground(
      {
        command: 'python',
        args: ['script.py'],
        cwd: '/skills/ocr',
        env: { PATH: '/bin' },
        shellCommand: 'python script.py',
        outputPrefix: 'skill_ocr'
      },
      10,
      'conv-1',
      POSIX_COMMAND_SHELL
    )

    await vi.advanceTimersByTimeAsync(10)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    await vi.advanceTimersByTimeAsync(2000)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')

    const result = await resultPromise
    expect(result.output).toContain('Timed out')
    expect(result.output).toContain('Exit Code: null')
  })

  it('falls back to capped in-memory buffering when foreground offload fails', async () => {
    class MockStream extends EventEmitter {
      setEncoding = vi.fn()
    }

    class MockChild extends EventEmitter {
      stdout = new MockStream()
      stderr = new MockStream()
      stdin = {
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn()
      }
      kill = vi.fn()
    }

    const child = new MockChild()
    const originalAppendFile = fs.promises.appendFile
    const appendFileMock = vi.fn().mockRejectedValue(new Error('disk full'))
    Object.defineProperty(fs.promises, 'appendFile', {
      configurable: true,
      value: appendFileMock
    })
    const previewSpy = vi
      .spyOn(service as never, 'readLastCharsFromFile' as never)
      .mockReturnValue('')

    vi.mocked(spawn).mockReturnValue(child as never)
    vi.spyOn(service as never, 'createForegroundOutputPath' as never).mockReturnValue(
      '/mock/session/skill.log'
    )

    const resultPromise = (service as never).runForeground(
      {
        command: 'python',
        args: ['script.py'],
        cwd: '/skills/ocr',
        env: { PATH: '/bin' },
        shellCommand: 'python script.py',
        outputPrefix: 'skill_ocr'
      },
      1000,
      'conv-1',
      POSIX_COMMAND_SHELL,
      undefined,
      1_000
    )

    const firstChunk = 'a'.repeat(1_001)
    child.stdout.emit('data', firstChunk)
    await Promise.resolve()
    await Promise.resolve()

    child.stdout.emit('data', 'tail')
    child.emit('close', 0)

    try {
      const result = await resultPromise

      expect(appendFileMock).toHaveBeenCalledTimes(1)
      expect(previewSpy).toHaveBeenCalledTimes(1)
      expect(result.output).not.toContain('Output offloaded:')
      expect(result.output).toContain('tail')
      expect(result.output).toContain('Exit Code: 0')
    } finally {
      Object.defineProperty(fs.promises, 'appendFile', {
        configurable: true,
        value: originalAppendFile
      })
      previewSpy.mockRestore()
    }
  })
})
