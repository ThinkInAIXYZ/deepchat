import { describe, expect, it } from 'vitest'
import { parseKnowledgeConfigs } from '../../../src/renderer/settings/lib/useExternalKnowledgeConfigs'

const isConfig = (value: unknown): value is { name: string } =>
  typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string'

describe('parseKnowledgeConfigs', () => {
  it('accepts validated object and JSON payloads', () => {
    expect(parseKnowledgeConfigs({ configs: [{ name: 'docs' }] }, isConfig)).toEqual([
      { name: 'docs' }
    ])
    expect(parseKnowledgeConfigs('{"configs":[{"name":"docs"}]}', isConfig)).toEqual([
      { name: 'docs' }
    ])
  })

  it('rejects the entire payload when any configuration is malformed', () => {
    expect(() =>
      parseKnowledgeConfigs({ configs: [{ name: 'docs' }, { name: 42 }] }, isConfig)
    ).toThrow('Knowledge configuration payload is invalid')
  })
})
