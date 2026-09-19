import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentTraceSettings } from '@/agent/traceSettings'

describe('AgentTraceSettings', () => {
  const values = new Map<string, unknown>()
  const settings = {
    get: vi.fn((key: string) => values.get(key)),
    set: vi.fn((key: string, value: unknown) => values.set(key, value))
  }

  beforeEach(() => {
    values.clear()
    vi.clearAllMocks()
  })

  it('defaults to disabled and stores normalized values', () => {
    const traceSettings = new AgentTraceSettings(settings as never)

    expect(traceSettings.isEnabled()).toBe(false)

    traceSettings.setEnabled(true)

    expect(traceSettings.isEnabled()).toBe(true)
    expect(settings.set).toHaveBeenCalledWith('traceDebugEnabled', true)
  })
})
