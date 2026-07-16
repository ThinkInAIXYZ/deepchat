import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrivacySettings } from '@/app/privacy'

describe('PrivacySettings', () => {
  const values = new Map<string, unknown>()
  const store = {
    get: vi.fn((key: string) => values.get(key)),
    set: vi.fn((key: string, value: unknown) => values.set(key, value))
  }

  beforeEach(() => {
    values.clear()
    vi.clearAllMocks()
  })

  it('defaults to disabled and stores normalized values', () => {
    const settings = new PrivacySettings(store as never)

    expect(settings.isEnabled()).toBe(false)

    settings.setEnabled(true)

    expect(settings.isEnabled()).toBe(true)
    expect(store.set).toHaveBeenCalledWith('privacyModeEnabled', true)
  })
})
