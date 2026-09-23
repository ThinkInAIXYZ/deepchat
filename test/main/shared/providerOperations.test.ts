import { describe, expect, it } from 'vitest'
import { checkRequiresRebuild } from '../../../src/shared/provider-operations'

describe('checkRequiresRebuild', () => {
  it('requires a rebuild when the protocol changes', () => {
    // A live instance cannot change protocol: an AI SDK provider cannot become a Workers AI provider,
    // and the reverse would keep the old protocol's routing overrides.
    expect(checkRequiresRebuild({ apiType: 'workers-ai' })).toBe(true)
  })

  it('requires a rebuild for the credential and endpoint fields', () => {
    expect(checkRequiresRebuild({ apiKey: 'sk-test' })).toBe(true)
    expect(checkRequiresRebuild({ baseUrl: 'https://example.com/v1' })).toBe(true)
    expect(checkRequiresRebuild({ enable: true })).toBe(true)
  })

  it('leaves display-only updates on the live instance', () => {
    expect(checkRequiresRebuild({ name: 'Renamed' })).toBe(false)
    expect(checkRequiresRebuild({ models: [] })).toBe(false)
  })
})
