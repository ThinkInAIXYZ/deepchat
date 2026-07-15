import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { SkillSettings } from '@/skill/settings'

describe('SkillSettings', () => {
  const values = new Map<string, unknown>()
  const store = {
    get: vi.fn((key: string) => values.get(key)),
    set: vi.fn((key: string, value: unknown) => values.set(key, value))
  }

  beforeEach(() => {
    values.clear()
    vi.clearAllMocks()
    vi.mocked(app.getPath).mockReturnValue('/home/tester')
  })

  it('returns the Skill defaults', () => {
    const settings = new SkillSettings(store as never)

    expect(settings.isEnabled()).toBe(true)
    expect(settings.isDraftSuggestionsEnabled()).toBe(false)
    expect(settings.getPath()).toBe('/home/tester/.deepchat/skills')
  })

  it('reads and writes Skill-owned settings', () => {
    const settings = new SkillSettings(store as never)
    const managementState = { version: 1 as const, skills: {} }
    const scanCache = { timestamp: '2026-07-16T00:00:00.000Z', tools: [] }

    settings.setDraftSuggestionsEnabled(true)
    settings.setManagementState(managementState)
    settings.setScanCache(scanCache)

    expect(settings.isDraftSuggestionsEnabled()).toBe(true)
    expect(settings.getManagementState()).toEqual(managementState)
    expect(settings.getScanCache()).toEqual(scanCache)
  })
})
