import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ISkillPresenter } from '../../../../src/shared/types/skill'
import { SkillExecutionService } from '../../../../src/main/presenter/skillPresenter/skillExecutionService'

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/mock/app',
    getPath: () => '/mock/userData'
  }
}))

vi.mock('../../../../src/main/lib/agentRuntime/shellEnvHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/main/lib/agentRuntime/shellEnvHelper')>()

  return {
    ...actual,
    getShellEnvironment: vi.fn().mockResolvedValue({ PATH: '/shell/bin' }),
    getUserShell: vi.fn().mockReturnValue({ shell: '/bin/zsh', args: ['-c'] })
  }
})

vi.mock('../../../../src/main/lib/agentRuntime/rtkRuntimeService', () => ({
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
      }))
  }
}))

import { spawn } from 'child_process'
import * as shellEnvHelper from '../../../../src/main/lib/agentRuntime/shellEnvHelper'
import { rtkRuntimeService } from '../../../../src/main/lib/agentRuntime/rtkRuntimeService'

describe('SkillExecutionService', () => {
  let skillPresenter: ISkillPresenter
  let service: SkillExecutionService
  let resolveConversationWorkdir: ReturnType<typeof vi.fn>
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(shellEnvHelper.getUserShell).mockReturnValue({ shell: '/bin/zsh', args: ['-c'] })
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    vi.mocked(fs.promises.stat).mockResolvedValue({
      isDirectory: () => true
    } as never)

    skillPresenter = {
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
      getSkillExtension: vi.fn().mockResolvedValue({
        version: 1,
        env: { API_KEY: 'secret' },
        runtimePolicy: { python: 'auto', node: 'auto' },
        scriptOverrides: {}
      }),
      saveSkillWithExtension: vi.fn().mockResolvedValue({ success: true, skillName: 'ocr' }),
      listSkillScripts: vi.fn().mockResolvedValue([
        {
          name: 'run.py',
          relativePath: 'scripts/run.py',
          absolutePath: '/skills/ocr/scripts/run.py',
          runtime: 'python',
          enabled: true
        }
      ])
    } as unknown as ISkillPresenter

    resolveConversationWorkdir = vi.fn().mockResolvedValue('/workspace/session')
    service = new SkillExecutionService(
      skillPresenter,
      {
        getSetting: vi.fn().mockReturnValue(true)
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
      'conv-1'
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
      'conv-1'
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
      'conv-1'
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
      'conv-1'
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

    const preparedPlan = await (service as never).preparePlanForExecution({
      command: 'node',
      args: ['/skills/ocr/scripts/run.py'],
      cwd: '/skills/ocr',
      env: { PATH: '/shell/bin', API_KEY: 'secret' },
      shellCommand: 'node /skills/ocr/scripts/run.py',
      outputPrefix: 'skill_ocr',
      spawnMode: 'direct'
    })

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
        { conversationId: 'conv-1' }
      )
    ).rejects.toThrow(/not found/)
  })

  it('escapes percent signs for Windows shell quoting', () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })

    expect((service as never).quoteForShell('value%"PATH"%')).toBe('"value%%\\"PATH\\"%%"')
  })

  it('wraps Windows shell-mode foreground commands with UTF-8 output setup', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })
    vi.mocked(shellEnvHelper.getUserShell).mockReturnValue({
      shell: 'powershell.exe',
      args: ['-NoProfile', '-Command']
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
      'conv-1'
    )

    child.stdout.emit('data', Buffer.from('ok\n'))
    child.emit('close', 0)

    const result = await resultPromise

    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-Command', expect.stringContaining('[Console]::OutputEncoding')],
      expect.objectContaining({
        shell: false
      })
    )
    expect(result).toContain('ok')
    expect(result).toContain('Exit Code: 0')
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
      'conv-1'
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
    expect(result).toContain('中文.txt')
    expect(result).toContain('Exit Code: 0')
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
      'conv-1'
    )

    await vi.advanceTimersByTimeAsync(10)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    await vi.advanceTimersByTimeAsync(2000)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')

    const result = await resultPromise
    expect(result).toContain('Timed out')
    expect(result).toContain('Exit Code: null')
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
      'conv-1'
    )

    const firstChunk = 'a'.repeat(10001)
    child.stdout.emit('data', firstChunk)
    await Promise.resolve()
    await Promise.resolve()

    child.stdout.emit('data', 'tail')
    child.emit('close', 0)

    try {
      const result = await resultPromise

      expect(appendFileMock).toHaveBeenCalledTimes(1)
      expect(previewSpy).toHaveBeenCalledTimes(1)
      expect(result).not.toContain('Output offloaded:')
      expect(result).toContain('tail')
      expect(result).toContain('Exit Code: 0')
    } finally {
      Object.defineProperty(fs.promises, 'appendFile', {
        configurable: true,
        value: originalAppendFile
      })
      previewSpy.mockRestore()
    }
  })
})
