import { describe, expect, it, vi } from 'vitest'
import { parseLoadSessionCapability } from '@/presenter/agentPresenter/acp/acpProcessManager'

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/tmp')
  }
}))

describe('parseLoadSessionCapability', () => {
  it('parses boolean capability from initialize result', () => {
    expect(parseLoadSessionCapability({ agentCapabilities: { loadSession: true } })).toBe(true)
    expect(parseLoadSessionCapability({ agentCapabilities: { loadSession: false } })).toBe(false)
  })

  it('returns undefined when capability is absent', () => {
    expect(parseLoadSessionCapability({})).toBeUndefined()
    expect(parseLoadSessionCapability(null)).toBeUndefined()
  })
})
