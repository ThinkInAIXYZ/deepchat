import { afterEach, describe, expect, it, vi } from 'vitest'
import { backgroundExecSessionManager } from '../../../../../src/main/lib/agentRuntime/backgroundExecSessionManager'
import { AgentBashHandler } from '../../../../../src/main/presenter/agentPresenter/acp/agentBashHandler'

describe('AgentBashHandler', () => {
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
        output: 'Error: rtk find does not support compound predicates or actions',
        exitCode: 2,
        timedOut: false,
        offloaded: false
      })
      .mockResolvedValueOnce({
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
      '/workspace',
      120000,
      expect.objectContaining({ env: { PATH: '/bin' } })
    )
    expect(runShellProcess).toHaveBeenNthCalledWith(
      2,
      originalCommand,
      '/workspace',
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
    expect(startSpy).toHaveBeenCalledWith('conv-1', originalCommand, '/workspace', {
      timeout: 120000,
      env: { PATH: '/bin' }
    })
    expect(result.output).toEqual({ status: 'running', sessionId: 'bg_123' })
    expect(result.rtkApplied).toBe(false)
    expect(result.rtkMode).toBe('bypass')
    expect(result.rtkFallbackReason).toBe(
      'Bypassed RTK rewrite: unsupported find compound predicates or actions'
    )
  })
})
