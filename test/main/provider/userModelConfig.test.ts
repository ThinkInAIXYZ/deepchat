import { describe, expect, it } from 'vitest'
import { normalizeUserModelConfigEntry } from '@/provider/userModelConfig'

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'model',
  providerId: 'provider',
  config: {
    maxTokens: 4096,
    contextLength: 16_000,
    ...((overrides.config as Record<string, unknown> | undefined) ?? {})
  },
  ...overrides
})

describe('normalizeUserModelConfigEntry', () => {
  it('normalizes explicit user entries', () => {
    expect(normalizeUserModelConfigEntry(entry({ source: 'user' }))).toMatchObject({
      source: 'user',
      config: { isUserDefined: true }
    })
  })

  it.each([
    {
      label: 'missing source',
      value: entry({ config: { isUserDefined: true } }),
      legacyUserKey: false
    },
    {
      label: 'null source',
      value: entry({ source: null, config: { isUserDefined: true } }),
      legacyUserKey: false
    },
    { label: 'legacy metadata key', value: entry(), legacyUserKey: true }
  ])('recognizes legacy user intent from $label', ({ value, legacyUserKey }) => {
    expect(normalizeUserModelConfigEntry(value, { legacyUserKey })).toMatchObject({
      source: 'user',
      config: { isUserDefined: true }
    })
  })

  it.each([
    ['provider source', entry({ source: 'provider', config: { isUserDefined: true } })],
    ['system source', entry({ source: 'system', config: { isUserDefined: true } })],
    ['unknown legacy entry', entry()],
    ['missing config', { id: 'model', providerId: 'provider', source: 'user' }],
    ['missing model id', entry({ id: '' })],
    ['missing provider id', entry({ providerId: '' })]
  ])('rejects %s', (_label, value) => {
    expect(normalizeUserModelConfigEntry(value)).toBeUndefined()
  })
})
