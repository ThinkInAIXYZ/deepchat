import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backgroundExecSessionManager } from '@/agent/shared/process/backgroundExecSessionManager'
import { AgentBashHandler } from '@/tool/agentTools/agentBashHandler'
import { CommandPermissionService } from '@/tool/permission/commandPermissionService'

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

const createPermissionService = (): CommandPermissionService => {
  const service = new CommandPermissionService()
  vi.spyOn(service, 'checkPermission').mockReturnValue({
    allowed: true,
    signature: '',
    baseCommand: '',
    risk: { level: 'low', suggestion: '' },
    reason: 'whitelist'
  })
  return service
}

describe('AgentBashHandler', () => {
  const workspaceRoot = process.cwd()
  const externalRoot = path.dirname(workspaceRoot)

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to the original command after an RTK capability error', async () => {
    const originalCommand = 'find . -type f -name "*.ts" -o -name "*.vue" | grep "^./src"'
    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      createPermissionService()
    )

    vi.spyOn(handler as never, 'prepareCommand' as never).mockResolvedValue({
      originalCommand,
      command: 'rtk find . -type f -name "*.ts" -o -name "*.vue" | grep "^./src"',
      env: { PATH: '/bin' },
      rewritten: true,
      rtkApplied: true,
      rtkMode: 'rewrite'
    })

    const runShellProcess = vi
      .spyOn(handler as never, 'runShellProcess' as never)
      .mockResolvedValueOnce({
        kind: 'completed',
        output: 'Error: rtk find does not support compound predicates or actions',
        exitCode: 2,
        timedOut: false,
        offloaded: false
      })
      .mockResolvedValueOnce({
        kind: 'completed',
        output: './src/main.ts\n./src/App.vue\n',
        exitCode: 0,
        timedOut: false,
        offloaded: false
      })

    const result = await handler.executeCommand({
      command: originalCommand,
      description: 'List source files'
    })

    expect(runShellProcess).toHaveBeenCalledTimes(2)
    expect(runShellProcess).toHaveBeenNthCalledWith(
      1,
      'rtk find . -type f -name "*.ts" -o -name "*.vue" | grep "^./src"',
      workspaceRoot,
      120000,
      expect.objectContaining({ env: { PATH: '/bin' } })
    )
    expect(runShellProcess).toHaveBeenNthCalledWith(
      2,
      originalCommand,
      workspaceRoot,
      120000,
      expect.objectContaining({ env: { PATH: '/bin' } })
    )
    expect(result.rtkApplied).toBe(false)
    expect(result.rtkMode).toBe('bypass')
    expect(result.rtkFallbackReason).toBe(
      'RTK capability fallback after rewrite failure: unsupported find compound predicates or actions'
    )
    expect(result.output).toContain('./src/main.ts')
    expect(result.output).toContain('Exit Code: 0')
  })

  it('does not fall back for ordinary rewritten command failures', async () => {
    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      createPermissionService()
    )

    vi.spyOn(handler as never, 'prepareCommand' as never).mockResolvedValue({
      originalCommand: 'node scripts/check.js',
      command: 'rtk run -- node scripts/check.js',
      env: { PATH: '/bin' },
      rewritten: true,
      rtkApplied: true,
      rtkMode: 'rewrite'
    })

    const runShellProcess = vi
      .spyOn(handler as never, 'runShellProcess' as never)
      .mockResolvedValue({
        kind: 'completed',
        output: 'permission denied',
        exitCode: 2,
        timedOut: false,
        offloaded: false
      })

    const result = await handler.executeCommand({
      command: 'node scripts/check.js',
      description: 'Run project check'
    })

    expect(runShellProcess).toHaveBeenCalledTimes(1)
    expect(result.rtkApplied).toBe(true)
    expect(result.rtkMode).toBe('rewrite')
    expect(result.rtkFallbackReason).toBeUndefined()
    expect(result.output).toContain('permission denied')
    expect(result.output).toContain('Exit Code: 2')
  })

  it('creates a scoped command environment only after command approval', async () => {
    const permissionService = new CommandPermissionService()
    permissionService.approve('conv-1', 'deepchat model', false)
    const commandEnvironment = {
      createEnvironment: vi.fn(() => ({
        variables: { DEEPCHAT_CLI_AGENT_TOKEN: 'scoped-token' },
        prependPath: ['/bundled/cli'],
        preserveCommand: true
      }))
    }
    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      permissionService,
      commandEnvironment
    )
    const prepareCommand = vi.spyOn(handler as never, 'prepareCommand' as never).mockResolvedValue({
      originalCommand: 'deepchat model invoke --prompt hello',
      command: 'deepchat model invoke --prompt hello',
      env: { DEEPCHAT_CLI_AGENT_TOKEN: 'scoped-token' },
      rewritten: false,
      rtkApplied: false,
      rtkMode: 'bypass'
    })
    vi.spyOn(handler as never, 'runShellProcess' as never).mockResolvedValue({
      kind: 'completed',
      output: 'ok',
      exitCode: 0,
      timedOut: false,
      offloaded: false
    })

    await handler.executeCommand(
      {
        command: 'deepchat model invoke --prompt hello',
        description: 'Invoke model'
      },
      {
        conversationId: 'conv-1',
        env: {
          PATH: ['/controlled/bin', '/shared/bin'].join(path.delimiter),
          CONTROLLED_VALUE: 'preserved'
        }
      }
    )

    expect(commandEnvironment.createEnvironment).toHaveBeenCalledWith(
      'conv-1',
      'deepchat model invoke --prompt hello'
    )
    expect(prepareCommand).toHaveBeenCalledWith(
      'deepchat model invoke --prompt hello',
      expect.objectContaining({
        DEEPCHAT_CLI_AGENT_TOKEN: 'scoped-token',
        CONTROLLED_VALUE: 'preserved'
      }),
      true
    )
    const preparedEnvironment = prepareCommand.mock.calls[0]?.[1] as Record<string, string>
    expect(preparedEnvironment.PATH?.split(path.delimiter).slice(0, 3)).toEqual([
      '/bundled/cli',
      '/controlled/bin',
      '/shared/bin'
    ])
  })

  it('does not issue a scoped environment while command approval is pending', async () => {
    const commandEnvironment = {
      createEnvironment: vi.fn(() => ({
        variables: {},
        prependPath: [],
        preserveCommand: false
      }))
    }
    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      new CommandPermissionService(),
      commandEnvironment
    )

    await expect(
      handler.executeCommand(
        {
          command: 'deepchat model invoke --prompt hello',
          description: 'Invoke model'
        },
        { conversationId: 'conv-1' }
      )
    ).rejects.toMatchObject({ name: 'Error', message: 'Command permission required' })
    expect(commandEnvironment.createEnvironment).not.toHaveBeenCalled()
  })

  it('does not fall back when the rewritten command times out', async () => {
    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      createPermissionService()
    )

    vi.spyOn(handler as never, 'prepareCommand' as never).mockResolvedValue({
      originalCommand: 'find . -name "*.ts"',
      command: 'rtk find . -name "*.ts"',
      env: { PATH: '/bin' },
      rewritten: true,
      rtkApplied: true,
      rtkMode: 'rewrite'
    })

    const runShellProcess = vi
      .spyOn(handler as never, 'runShellProcess' as never)
      .mockResolvedValue({
        kind: 'completed',
        output: 'Error: rtk find does not support compound predicates or actions',
        exitCode: null,
        timedOut: true,
        offloaded: false
      })

    const result = await handler.executeCommand({
      command: 'find . -name "*.ts"',
      description: 'Search ts files',
      timeout: 1000
    })

    expect(runShellProcess).toHaveBeenCalledTimes(1)
    expect(result.rtkApplied).toBe(true)
    expect(result.rtkMode).toBe('rewrite')
    expect(result.output).toContain('Timed out')
  })

  it('keeps background execution on the bypass path without foreground retry', async () => {
    const originalCommand = 'find . -type f -name "*.ts" -o -name "*.vue"'
    const order: string[] = []
    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      createPermissionService()
    )

    vi.spyOn(handler as never, 'prepareCommand' as never).mockResolvedValue({
      originalCommand,
      command: originalCommand,
      env: { PATH: '/bin' },
      rewritten: false,
      rtkApplied: false,
      rtkMode: 'bypass',
      rtkFallbackReason: 'Bypassed RTK rewrite: unsupported find compound predicates or actions'
    })

    const runShellProcess = vi.spyOn(handler as never, 'runShellProcess' as never)
    const startSpy = vi
      .spyOn(backgroundExecSessionManager, 'start')
      .mockImplementation(async () => {
        order.push('spawn')
        return { sessionId: 'bg_123', status: 'running' }
      })
    const beforeExecute = vi.fn(() => order.push('commit'))

    const result = await handler.executeCommand(
      {
        command: originalCommand,
        description: 'List source files',
        background: true
      },
      {
        conversationId: 'conv-1',
        beforeExecute
      }
    )

    expect(order).toEqual(['commit', 'spawn'])
    expect(beforeExecute).toHaveBeenCalledWith({
      command: originalCommand,
      cwd: workspaceRoot,
      timeoutMs: 120000,
      background: true
    })
    expect(runShellProcess).not.toHaveBeenCalled()
    expect(startSpy).toHaveBeenCalledWith(
      'conv-1',
      originalCommand,
      workspaceRoot,
      expect.objectContaining({
        timeout: 120000,
        env: { PATH: '/bin' }
      })
    )
    expect(result.output).toEqual({ status: 'running', sessionId: 'bg_123' })
    expect(result.rtkApplied).toBe(false)
    expect(result.rtkMode).toBe('bypass')
    expect(result.rtkFallbackReason).toBe(
      'Bypassed RTK rewrite: unsupported find compound predicates or actions'
    )
  })

  it('allows an external cwd when explicitly enabled', async () => {
    const externalCwd = externalRoot
    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      createPermissionService()
    )

    vi.spyOn(handler as never, 'prepareCommand' as never).mockResolvedValue({
      originalCommand: 'pwd',
      command: 'pwd',
      env: { PATH: '/bin' },
      rewritten: false,
      rtkApplied: false,
      rtkMode: 'bypass'
    })

    const runShellProcess = vi
      .spyOn(handler as never, 'runShellProcess' as never)
      .mockResolvedValue({
        kind: 'completed',
        output: externalCwd,
        exitCode: 0,
        timedOut: false,
        offloaded: false
      })

    await handler.executeCommand(
      {
        command: 'pwd',
        description: 'Print cwd',
        cwd: externalCwd
      },
      {
        allowExternalCwd: true
      }
    )

    expect(runShellProcess).toHaveBeenCalledWith(
      'pwd',
      externalCwd,
      120000,
      expect.objectContaining({ env: { PATH: '/bin' } })
    )
  })

  it('rejects an external cwd when external access is not enabled', async () => {
    const externalCwd = externalRoot
    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      createPermissionService()
    )
    const runShellProcess = vi.spyOn(handler as never, 'runShellProcess' as never)

    await expect(
      handler.executeCommand({
        command: 'pwd',
        description: 'Print cwd',
        cwd: externalCwd
      })
    ).rejects.toThrow('Working directory is not allowed')

    expect(runShellProcess).not.toHaveBeenCalled()
  })

  it('does not commit dispatch when the resolved cwd is unusable', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      createPermissionService()
    )
    const beforeExecute = vi.fn()
    const runShellProcess = vi.spyOn(handler as never, 'runShellProcess' as never)

    await expect(
      handler.executeCommand(
        {
          command: 'pwd',
          description: 'Print working directory'
        },
        { beforeExecute }
      )
    ).rejects.toThrow('Working directory does not exist or is not accessible')

    expect(beforeExecute).not.toHaveBeenCalled()
    expect(runShellProcess).not.toHaveBeenCalled()
  })

  it('commits the prepared command before starting the shell process', async () => {
    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      createPermissionService()
    )
    const order: string[] = []
    vi.spyOn(handler as never, 'prepareCommand' as never).mockResolvedValue({
      originalCommand: 'find . -name "*.ts"',
      command: 'rtk find . -name "*.ts"',
      env: { PATH: '/bin' },
      rewritten: true,
      rtkApplied: true,
      rtkMode: 'rewrite'
    })
    vi.spyOn(handler as never, 'runShellProcess' as never).mockImplementation(async () => {
      order.push('spawn')
      return {
        kind: 'completed',
        output: '',
        exitCode: 0,
        timedOut: false,
        offloaded: false
      }
    })
    const beforeExecute = vi.fn(() => order.push('commit'))

    await handler.executeCommand(
      {
        command: 'find . -name "*.ts"',
        description: 'Find TypeScript files'
      },
      { beforeExecute }
    )

    expect(order).toEqual(['commit', 'spawn'])
    expect(beforeExecute).toHaveBeenCalledWith({
      command: 'rtk find . -name "*.ts"',
      cwd: workspaceRoot,
      timeoutMs: 120000,
      background: false,
      fallbackCommand: 'find . -name "*.ts"',
      fallbackPolicy: 'rtk_capability_error'
    })
  })

  it('returns a running session when foreground exec exceeds yieldMs', async () => {
    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      createPermissionService()
    )

    vi.spyOn(handler as never, 'prepareCommand' as never).mockResolvedValue({
      originalCommand: 'bun run dev caps gpt-4o',
      command: 'bun run dev caps gpt-4o',
      env: { PATH: '/bin' },
      rewritten: false,
      rtkApplied: false,
      rtkMode: 'bypass'
    })

    const startSpy = vi
      .spyOn(backgroundExecSessionManager, 'start')
      .mockResolvedValue({ sessionId: 'bg_yield', status: 'running' })
    const waitSpy = vi
      .spyOn(backgroundExecSessionManager, 'waitForCompletionOrYield')
      .mockResolvedValue({ kind: 'running', sessionId: 'bg_yield' })
    const writeSpy = vi.spyOn(backgroundExecSessionManager, 'write').mockImplementation(() => {})
    const removeSpy = vi.spyOn(backgroundExecSessionManager, 'remove').mockResolvedValue()

    const result = await handler.executeCommand(
      {
        command: 'bun run dev caps gpt-4o',
        description: 'Start dev server',
        yieldMs: 250
      },
      {
        conversationId: 'conv-1'
      }
    )

    expect(writeSpy).toHaveBeenCalledWith('conv-1', 'bg_yield', '', true)
    expect(startSpy).toHaveBeenCalledWith(
      'conv-1',
      'bun run dev caps gpt-4o',
      workspaceRoot,
      expect.objectContaining({
        timeout: 120000,
        env: { PATH: '/bin' }
      })
    )
    expect(waitSpy).toHaveBeenCalledWith('conv-1', 'bg_yield', 250, 12_000)
    expect(removeSpy).not.toHaveBeenCalled()
    expect(result.output).toEqual({ status: 'running', sessionId: 'bg_yield' })
  })

  it('cleans up completed foreground sessions that finish inside the yield window', async () => {
    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      createPermissionService()
    )

    vi.spyOn(handler as never, 'prepareCommand' as never).mockResolvedValue({
      originalCommand: 'pnpm test --help',
      command: 'pnpm test --help',
      env: { PATH: '/bin' },
      rewritten: false,
      rtkApplied: false,
      rtkMode: 'bypass'
    })

    vi.spyOn(backgroundExecSessionManager, 'start').mockResolvedValue({
      sessionId: 'bg_done',
      status: 'running'
    })
    const writeSpy = vi.spyOn(backgroundExecSessionManager, 'write').mockImplementation(() => {})
    vi.spyOn(backgroundExecSessionManager, 'waitForCompletionOrYield').mockResolvedValue({
      kind: 'completed',
      result: {
        status: 'done',
        output: 'usage',
        exitCode: 0,
        offloaded: false,
        timedOut: false
      }
    })
    const removeSpy = vi.spyOn(backgroundExecSessionManager, 'remove').mockResolvedValue()

    const result = await handler.executeCommand(
      {
        command: 'pnpm test --help',
        description: 'Show help'
      },
      {
        conversationId: 'conv-1'
      }
    )

    expect(writeSpy).toHaveBeenCalledWith('conv-1', 'bg_done', '', true)
    expect(removeSpy).toHaveBeenCalledWith('conv-1', 'bg_done')
    expect(result.output).toContain('usage')
    expect(result.output).toContain('Exit Code: 0')
  })

  it('keeps completed foreground sessions when output was offloaded', async () => {
    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      createPermissionService()
    )

    vi.spyOn(handler as never, 'prepareCommand' as never).mockResolvedValue({
      originalCommand: 'pnpm test --reporter=json',
      command: 'pnpm test --reporter=json',
      env: { PATH: '/bin' },
      rewritten: false,
      rtkApplied: false,
      rtkMode: 'bypass'
    })

    const startSpy = vi.spyOn(backgroundExecSessionManager, 'start').mockResolvedValue({
      sessionId: 'bg_offloaded',
      status: 'running'
    })
    const waitSpy = vi
      .spyOn(backgroundExecSessionManager, 'waitForCompletionOrYield')
      .mockResolvedValue({
        kind: 'completed',
        result: {
          status: 'done',
          output: 'last lines',
          exitCode: 0,
          offloaded: true,
          outputFilePath: '/tmp/bgexec_bg_offloaded.log',
          timedOut: false
        }
      })
    const writeSpy = vi.spyOn(backgroundExecSessionManager, 'write').mockImplementation(() => {})
    const removeSpy = vi.spyOn(backgroundExecSessionManager, 'remove').mockResolvedValue()

    const result = await handler.executeCommand(
      {
        command: 'pnpm test --reporter=json',
        description: 'Run tests'
      },
      {
        conversationId: 'conv-1',
        outputPreviewChars: 7_000
      }
    )

    expect(startSpy).toHaveBeenCalledWith(
      'conv-1',
      'pnpm test --reporter=json',
      workspaceRoot,
      expect.objectContaining({ previewChars: 7_000, offloadThresholdChars: 7_000 })
    )
    expect(waitSpy).toHaveBeenCalledWith('conv-1', 'bg_offloaded', 10_000, 7_000)
    expect(writeSpy).toHaveBeenCalledWith('conv-1', 'bg_offloaded', '', true)
    expect(removeSpy).not.toHaveBeenCalled()
    expect(result.output).toContain('last lines')
    expect(result.output).toContain('Exit Code: 0')
    expect(result.output).toContain('Output offloaded: /tmp/bgexec_bg_offloaded.log')
    expect(result.outputOffloadPath).toBe('/tmp/bgexec_bg_offloaded.log')
  })

  it('drains offloaded writes before reading a detached command preview', async () => {
    class MockStream extends EventEmitter {}
    class MockChild extends EventEmitter {
      stdout = new MockStream()
      stderr = new MockStream()
      stdin = { write: vi.fn(), end: vi.fn(), destroyed: false }
      pid = 123
    }

    const handler = new AgentBashHandler(
      [workspaceRoot],
      { get: () => undefined },
      createPermissionService()
    )
    const child = new MockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.spyOn(handler as never, 'createOutputFilePath' as never).mockReturnValue('/tmp/exec.log')
    const readPreview = vi
      .spyOn(handler as never, 'readLastCharsFromFile' as never)
      .mockReturnValue('tail')
    let finishWrite = () => {}
    const pendingWrite = new Promise<void>((resolve) => {
      finishWrite = () => resolve()
    })
    const originalAppendFile = fs.promises.appendFile
    const appendFile = vi.fn().mockReturnValue(pendingWrite)
    Object.defineProperty(fs.promises, 'appendFile', {
      configurable: true,
      value: appendFile
    })

    try {
      const resultPromise = (handler as never).runDetachedShellProcess(
        'printf abcdef',
        workspaceRoot,
        1_000,
        { outputPreviewChars: 3 }
      )
      child.stdout.emit('data', 'abcdef')
      child.emit('close', 0, null)

      await vi.waitFor(() => expect(appendFile).toHaveBeenCalledOnce())
      expect(readPreview).not.toHaveBeenCalled()
      finishWrite()

      await expect(resultPromise).resolves.toMatchObject({
        output: 'tail',
        offloaded: true
      })
      expect(readPreview).toHaveBeenCalledWith('/tmp/exec.log', 3)
    } finally {
      Object.defineProperty(fs.promises, 'appendFile', {
        configurable: true,
        value: originalAppendFile
      })
    }
  })
})
