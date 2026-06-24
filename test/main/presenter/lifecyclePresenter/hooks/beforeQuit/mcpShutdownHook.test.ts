import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LifecyclePhase } from '../../../../../../src/shared/lifecycle'

const presenterState = vi.hoisted(() => ({
  value: undefined as undefined | { mcpPresenter?: { shutdown: any } }
}))

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('@shared/logger', () => ({
  default: loggerMock
}))

vi.mock('@/presenter', () => ({
  get presenter() {
    return presenterState.value
  }
}))

import { mcpShutdownHook } from '../../../../../../src/main/presenter/lifecyclePresenter/hooks/beforeQuit/mcpShutdownHook'

function createContext() {
  return { phase: LifecyclePhase.BEFORE_QUIT } as any
}

describe('mcpShutdownHook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    presenterState.value = undefined
  })

  it('runs before presenter teardown and shuts down MCP servers', async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined)
    presenterState.value = { mcpPresenter: { shutdown } }

    await mcpShutdownHook.execute(createContext())

    expect(mcpShutdownHook.phase).toBe(LifecyclePhase.BEFORE_QUIT)
    expect(mcpShutdownHook.priority).toBeLessThan(Number.MAX_VALUE)
    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it('skips when presenter is unavailable', async () => {
    await expect(mcpShutdownHook.execute(createContext())).resolves.toBeUndefined()

    expect(loggerMock.info).toHaveBeenCalledWith(
      'mcpShutdownHook: Presenter is not available, skipping MCP shutdown'
    )
  })

  it('logs shutdown failures without blocking quit', async () => {
    const error = new Error('shutdown failed')
    const shutdown = vi.fn().mockRejectedValue(error)
    presenterState.value = { mcpPresenter: { shutdown } }

    await expect(mcpShutdownHook.execute(createContext())).resolves.toBeUndefined()

    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'mcpShutdownHook: Failed to shut down MCP servers during before-quit:',
      error
    )
  })
})
