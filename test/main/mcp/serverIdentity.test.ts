import { describe, expect, it } from 'vitest'
import {
  computeMcpBindingHash,
  normalizeMcpServerIdentity,
  sanitizeMcpAuthorizationConfig
} from '@/mcp/serverIdentity'

describe('MCP server identity', () => {
  it('preserves stable identity across display-only edits', () => {
    const current = {
      type: 'http' as const,
      baseUrl: 'https://mcp.example.com/mcp',
      command: '',
      args: [],
      env: {},
      descriptions: 'Before',
      icons: 'A',
      enabled: true,
      serverId: '83cd1680-470f-48ce-a46d-5be5f9bbd2e4',
      configGeneration: 4,
      bindingHash: 'old'
    }
    const next = {
      ...current,
      descriptions: 'After',
      icons: 'B'
    }

    expect(normalizeMcpServerIdentity(next, current)).toMatchObject({
      serverId: current.serverId,
      configGeneration: 4
    })
  })

  it('increments the generation and changes the binding when the endpoint changes', () => {
    const current = {
      type: 'http' as const,
      baseUrl: 'https://mcp.example.com/mcp',
      command: '',
      args: [],
      env: {},
      descriptions: '',
      icons: '',
      enabled: true,
      serverId: '83cd1680-470f-48ce-a46d-5be5f9bbd2e4',
      configGeneration: 4,
      bindingHash: 'old'
    }
    const next = {
      ...current,
      baseUrl: 'https://other.example.com/mcp'
    }

    const identity = normalizeMcpServerIdentity(next, current)

    expect(identity.serverId).toBe(current.serverId)
    expect(identity.configGeneration).toBe(5)
    expect(identity.bindingHash).toBe(computeMcpBindingHash(next))
    expect(identity.bindingHash).not.toBe(computeMcpBindingHash(current))
  })

  it('hashes equivalent configuration independently of object insertion order', () => {
    const first = {
      type: 'stdio' as const,
      command: 'node',
      env: { Z_VAR: 'last', A_VAR: 'first' }
    }
    const second = {
      command: 'node',
      env: { A_VAR: 'first', Z_VAR: 'last' },
      type: 'stdio' as const
    }

    expect(computeMcpBindingHash(first)).toBe(computeMcpBindingHash(second))
  })

  it('canonicalizes authorization binding material without retaining dead fields', () => {
    expect(
      sanitizeMcpAuthorizationConfig({
        mode: 'private_key_jwt',
        protectedResourceUrl: 'https://mcp.example.com',
        authorizationServerIssuer: 'https://auth.example.com',
        clientId: ' client ',
        scopes: ['write', 'read', 'write'],
        keyAlgorithm: 'RS256'
      })
    ).toEqual({
      mode: 'private_key_jwt',
      protectedResourceUrl: 'https://mcp.example.com/',
      authorizationServerIssuer: 'https://auth.example.com/',
      clientMetadataUrl: undefined,
      clientId: 'client',
      scopes: ['read', 'write'],
      identityProfileId: undefined,
      keyAlgorithm: 'RS256'
    })
  })

  it('repairs invalid persisted identities and ignores malformed scope entries', () => {
    const identity = normalizeMcpServerIdentity({
      type: 'http',
      baseUrl: 'https://mcp.example.com/mcp',
      serverId: 'legacy-name',
      authorization: {
        mode: 'interactive',
        scopes: ['read', 42, null] as unknown as string[]
      }
    })

    expect(identity.serverId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(
      sanitizeMcpAuthorizationConfig({
        mode: 'interactive',
        scopes: ['read', 42, null] as unknown as string[]
      })
    ).toMatchObject({ scopes: ['read'] })
  })
})
