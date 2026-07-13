import * as fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import logger from '@shared/logger'
import { buildSystemEnvPrompt } from '@/lib/agentRuntime/systemEnvPromptBuilder'

function fileError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code} mock error`), { code })
}

describe('buildSystemEnvPrompt', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.promises.readFile).mockReset()
    vi.mocked(logger.warn).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('omits instructions without warning when AGENTS.md is missing', async () => {
    vi.mocked(fs.promises.readFile).mockRejectedValue(fileError('ENOENT'))

    const prompt = await buildSystemEnvPrompt({
      workdir: '/tmp/deepchat-env-prompt-missing',
      providerId: 'provider',
      modelId: 'model',
      now: new Date('2026-06-22T00:00:00Z')
    })

    expect(prompt).toContain('Working directory: /tmp/deepchat-env-prompt-missing')
    expect(prompt).not.toContain('Instructions from:')
    expect(logger.warn).not.toHaveBeenCalledWith(
      '[SystemEnvPromptBuilder] Failed to read AGENTS.md',
      expect.anything()
    )
  })

  it('includes instructions when AGENTS.md exists', async () => {
    vi.mocked(fs.promises.readFile).mockResolvedValue('Use concise answers.\n')

    const prompt = await buildSystemEnvPrompt({
      workdir: '/tmp/deepchat-env-prompt-present',
      providerId: 'provider',
      modelId: 'model',
      now: new Date('2026-06-22T00:00:00Z')
    })

    expect(prompt).toContain('Instructions from: /tmp/deepchat-env-prompt-present/AGENTS.md')
    expect(prompt).toContain('Use concise answers.')
  })

  it('logs lightweight metadata for real AGENTS.md read errors', async () => {
    vi.mocked(fs.promises.readFile).mockRejectedValue(fileError('EISDIR'))

    const prompt = await buildSystemEnvPrompt({
      workdir: '/tmp/deepchat-env-prompt-error',
      providerId: 'provider',
      modelId: 'model',
      now: new Date('2026-06-22T00:00:00Z')
    })

    expect(prompt).not.toContain('Instructions from:')
    expect(logger.warn).toHaveBeenCalledWith('[SystemEnvPromptBuilder] Failed to read AGENTS.md', {
      sourcePath: '/tmp/deepchat-env-prompt-error/AGENTS.md',
      code: 'EISDIR',
      message: 'EISDIR mock error'
    })
  })

  it('defers slow first reads and reuses the late cached result', async () => {
    vi.useFakeTimers()
    let resolveRead: (content: string) => void = () => {}
    vi.mocked(fs.promises.readFile).mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve
      }) as ReturnType<typeof fs.promises.readFile>
    )

    const promptPromise = buildSystemEnvPrompt({
      workdir: '/tmp/deepchat-env-prompt-slow',
      providerId: 'provider',
      modelId: 'model',
      now: new Date('2026-06-22T00:00:00Z')
    })

    await vi.advanceTimersByTimeAsync(200)
    const prompt = await promptPromise

    expect(prompt).not.toContain('Instructions from:')
    expect(logger.warn).toHaveBeenCalledWith('[SystemEnvPromptBuilder] AGENTS.md read deferred', {
      sourcePath: '/tmp/deepchat-env-prompt-slow/AGENTS.md',
      budgetMs: 200
    })

    resolveRead('Late instructions.\n')
    await Promise.resolve()
    await Promise.resolve()

    const cachedPrompt = await buildSystemEnvPrompt({
      workdir: '/tmp/deepchat-env-prompt-slow',
      providerId: 'provider',
      modelId: 'model',
      now: new Date('2026-06-22T00:00:00Z')
    })

    expect(cachedPrompt).toContain('Late instructions.')
    expect(fs.promises.readFile).toHaveBeenCalledTimes(1)
  })
})
