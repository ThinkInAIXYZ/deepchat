import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backgroundExecSessionManager } from '../../../../../src/main/lib/agentRuntime/backgroundExecSessionManager'
import { AgentBashHandler } from '../../../../../src/main/presenter/toolPresenter/agentTools/agentBashHandler'

describe('AgentBashHandler', () => {
  const workspaceRoot = path.resolve('/workspace')

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to the original command after an RTK capability error', async () => {
    const originalCommand = 'find . -type f -name "*.ts" -o -name "*.vue" | grep "^./src"'
    const handler = new AgentBashHandler(['/workspace'])

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
    const handler = new AgentBashHandler(['/workspace'])

    vi.spyOn(handler as never, 'prepareCommand' as never).mockResolvedValue({
      originalCommand: 'rg -n "todo" src',
      command: 'rtk run -- rg -n "todo" src',
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
      command: 'rg -n "todo" src',
      description: 'Search todo lines'
    })

    expect(runShellProcess).toHaveBeenCalledTimes(1)
    expect(result.rtkApplied).toBe(true)
    expect(result.rtkMode).toBe('rewrite')
    expect(result.rtkFallbackReason).toBeUndefined()
    expect(result.output).toContain('permission denied')
    expect(result.output).toContain('Exit Code: 2')
  })

  it('does not fall back when the rewritten command times out', async () => {
    const handler = new AgentBashHandler(['/workspace'])

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
    const handler = new AgentBashHandler(['/workspace'])

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
      .mockResolvedValue({ sessionId: 'bg_123', status: 'running' })

    const result = await handler.executeCommand(
      {
        command: originalCommand,
        description: 'List source files',
        background: true
      },
      {
        conversationId: 'conv-1'
      }
    )

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

  it('returns a running session when foreground exec exceeds yieldMs', async () => {
    const handler = new AgentBashHandler(['/workspace'])

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
    expect(waitSpy).toHaveBeenCalledWith('conv-1', 'bg_yield', 250)
    expect(removeSpy).not.toHaveBeenCalled()
    expect(result.output).toEqual({ status: 'running', sessionId: 'bg_yield' })
  })

  it('cleans up completed foreground sessions that finish inside the yield window', async () => {
    const handler = new AgentBashHandler(['/workspace'])

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
    const handler = new AgentBashHandler(['/workspace'])

    vi.spyOn(handler as never, 'prepareCommand' as never).mockResolvedValue({
      originalCommand: 'pnpm test --reporter=json',
      command: 'pnpm test --reporter=json',
      env: { PATH: '/bin' },
      rewritten: false,
      rtkApplied: false,
      rtkMode: 'bypass'
    })

    vi.spyOn(backgroundExecSessionManager, 'start').mockResolvedValue({
      sessionId: 'bg_offloaded',
      status: 'running'
    })
    vi.spyOn(backgroundExecSessionManager, 'waitForCompletionOrYield').mockResolvedValue({
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
        conversationId: 'conv-1'
      }
    )

    expect(writeSpy).toHaveBeenCalledWith('conv-1', 'bg_offloaded', '', true)
    expect(removeSpy).not.toHaveBeenCalled()
    expect(result.output).toContain('last lines')
    expect(result.output).toContain('Exit Code: 0')
    expect(result.output).toContain('Output offloaded: /tmp/bgexec_bg_offloaded.log')
  })
})
