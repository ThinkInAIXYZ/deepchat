import { describe, expect, it, vi } from 'vitest'
import { AgentCliTokenAuthority, AgentCliTokenCapacityError } from '@/cli/agentTokenAuthority'

function token(character: string): string {
  return character.repeat(43)
}

const TEST_SCOPES = ['system:read'] as const

describe('AgentCliTokenAuthority', () => {
  it('issues bounded in-memory claims and consumes call and byte quotas', () => {
    let now = 1_000
    const authority = new AgentCliTokenAuthority({
      now: () => now,
      createToken: () => token('a'),
      createTokenId: () => 'token-id-1234567890'
    })
    const issued = authority.issue({
      conversationId: ' conversation-1 ',
      scopes: ['models:invoke'],
      ttlMs: 1_000,
      maxCalls: 2,
      maxBytes: 5
    })

    expect(issued).toMatchObject({
      token: token('a'),
      tokenId: 'token-id-1234567890',
      conversationId: 'conversation-1',
      expiresAt: 2_000,
      scopes: ['models:invoke'],
      maxCalls: 2,
      maxBytes: 5
    })
    const first = authority.beginRequest(issued.token)
    expect(first.status).toBe('granted')
    if (first.status !== 'granted') throw new Error('Expected grant')
    expect(first.grant.consumeBytes(3)).toBe(true)
    first.grant.release()
    const second = authority.beginRequest(issued.token)
    expect(second.status).toBe('granted')
    if (second.status !== 'granted') throw new Error('Expected grant')
    expect(second.grant.consumeBytes(3)).toBe(false)
    second.grant.release()
    expect(authority.beginRequest(issued.token)).toEqual({ status: 'quota-exhausted' })

    now = 2_000
    expect(authority.beginRequest(issued.token)).toEqual({ status: 'expired' })
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })

  it('revokes every token and active grant for one conversation only', () => {
    const generatedTokens = [token('a'), token('b'), token('c')]
    const authority = new AgentCliTokenAuthority({
      createToken: () => generatedTokens.shift()!,
      createTokenId: () => `token-id-${generatedTokens.length}`.padEnd(16, '0')
    })
    const first = authority.issue({ conversationId: 'conversation-1', scopes: TEST_SCOPES })
    const second = authority.issue({ conversationId: 'conversation-1', scopes: TEST_SCOPES })
    const other = authority.issue({ conversationId: 'conversation-2', scopes: TEST_SCOPES })
    const active = authority.beginRequest(first.token)
    if (active.status !== 'granted') throw new Error('Expected grant')
    const abort = vi.fn()
    active.grant.signal.addEventListener('abort', abort)

    authority.revokeConversation('conversation-1')

    expect(abort).toHaveBeenCalledOnce()
    expect(authority.beginRequest(first.token)).toEqual({ status: 'invalid' })
    expect(authority.beginRequest(second.token)).toEqual({ status: 'invalid' })
    expect(authority.beginRequest(other.token).status).toBe('granted')
  })

  it('replaces the oldest per-conversation token but fails closed at global capacity', () => {
    const generatedTokens = [token('a'), token('b'), token('c')]
    let tokenId = 0
    const authority = new AgentCliTokenAuthority({
      createToken: () => generatedTokens.shift()!,
      createTokenId: () => `token-id-${String((tokenId += 1)).padStart(8, '0')}`,
      maxTokens: 2,
      maxTokensPerConversation: 1
    })
    const first = authority.issue({ conversationId: 'conversation-1', scopes: TEST_SCOPES })
    const replacement = authority.issue({ conversationId: 'conversation-1', scopes: TEST_SCOPES })

    expect(authority.beginRequest(first.token)).toEqual({ status: 'invalid' })
    expect(authority.beginRequest(replacement.token).status).toBe('granted')
    authority.issue({ conversationId: 'conversation-2', scopes: TEST_SCOPES })
    expect(() =>
      authority.issue({ conversationId: 'conversation-3', scopes: TEST_SCOPES })
    ).toThrow(AgentCliTokenCapacityError)
  })

  it('reclaims completed exhausted grants before enforcing global capacity', () => {
    const generatedTokens = [token('a'), token('b')]
    let tokenId = 0
    const authority = new AgentCliTokenAuthority({
      createToken: () => generatedTokens.shift()!,
      createTokenId: () => `token-id-${String((tokenId += 1)).padStart(8, '0')}`,
      maxTokens: 1
    })
    const first = authority.issue({
      conversationId: 'conversation-1',
      scopes: TEST_SCOPES,
      maxCalls: 1
    })
    const active = authority.beginRequest(first.token)
    if (active.status !== 'granted') throw new Error('Expected grant')

    expect(() =>
      authority.issue({ conversationId: 'conversation-2', scopes: TEST_SCOPES })
    ).toThrow(AgentCliTokenCapacityError)
    active.grant.release()
    const second = authority.issue({ conversationId: 'conversation-2', scopes: TEST_SCOPES })

    expect(authority.beginRequest(first.token)).toEqual({ status: 'invalid' })
    expect(authority.beginRequest(second.token).status).toBe('granted')
  })

  it('never stores an invalid or duplicate generated token', () => {
    const authority = new AgentCliTokenAuthority({
      createToken: () => 'not a token',
      createTokenId: () => 'token-id-1234567890'
    })

    expect(() =>
      authority.issue({ conversationId: 'conversation-1', scopes: TEST_SCOPES })
    ).toThrow()
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })

  it('requires every issued token to carry an explicit nonempty scope set', () => {
    const authority = new AgentCliTokenAuthority()

    expect(() => authority.issue({ conversationId: 'conversation-1', scopes: [] })).toThrow(
      'scopes must contain at least one capability'
    )
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })

  it('does not revoke an existing token when replacement allocation fails', () => {
    const generatedTokens = [token('a'), 'not a token']
    let tokenId = 0
    const authority = new AgentCliTokenAuthority({
      createToken: () => generatedTokens.shift()!,
      createTokenId: () => `token-id-${String((tokenId += 1)).padStart(8, '0')}`,
      maxTokensPerConversation: 1
    })
    const existing = authority.issue({ conversationId: 'conversation-1', scopes: TEST_SCOPES })

    expect(() =>
      authority.issue({ conversationId: 'conversation-1', scopes: TEST_SCOPES })
    ).toThrow()
    expect(authority.beginRequest(existing.token).status).toBe('granted')
  })

  it('bounds custom lifetime, call, and byte limits', () => {
    const authority = new AgentCliTokenAuthority()

    expect(() =>
      authority.issue({
        conversationId: 'conversation-1',
        scopes: TEST_SCOPES,
        ttlMs: 60 * 60_000 + 1
      })
    ).toThrow('ttlMs exceeds')
    expect(() =>
      authority.issue({ conversationId: 'conversation-1', scopes: TEST_SCOPES, maxCalls: 1025 })
    ).toThrow('maxCalls exceeds')
    expect(() =>
      authority.issue({
        conversationId: 'conversation-1',
        scopes: TEST_SCOPES,
        maxBytes: 1024 * 1024 * 1024 + 1
      })
    ).toThrow('maxBytes exceeds')
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })
})
