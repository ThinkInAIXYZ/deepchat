import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION,
  AgentCliTokenAuthority,
  AgentCliTokenCapacityError,
  buildAgentCliProgrammaticInvocationHash,
  parseAgentCliProgrammaticExecInvocation,
  type AgentCliOuterDispatchReceipt,
  type AgentCliProgrammaticOperationBinding
} from '@/cli/agentTokenAuthority'
import { LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION } from '@shared/contracts/localControl'

function token(character: string): string {
  return character.repeat(43)
}

const TEST_SCOPES = ['system:read'] as const
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

function programmaticBinding(
  overrides: Partial<AgentCliProgrammaticOperationBinding> = {}
): AgentCliProgrammaticOperationBinding {
  return {
    schemaVersion: AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION,
    surfaceVersion: LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION,
    operation: {
      sessionId: 'conversation-1',
      messageId: 'message-1',
      runId: 'run-1',
      requestSeq: 2,
      providerToolCallId: 'provider-call-1'
    },
    command: { domain: 'tool', verb: 'call' },
    route: 'tool.call',
    canonicalInvocationHash: HASH_A,
    adapterMode: 'cli-programmatic',
    capabilityHash: HASH_B,
    programmaticSurfaceHash: HASH_C,
    quotas: {
      maxChildren: 8,
      maxBatchSteps: 8,
      maxInputBytes: 4_096,
      maxOutputBytes: 8_192,
      maxDurationMs: 30_000
    },
    ...overrides
  }
}

function outerDispatchReceipt(
  preparedTokenId = 'programmatic-token-1',
  overrides: Partial<AgentCliOuterDispatchReceipt> = {}
): AgentCliOuterDispatchReceipt {
  return {
    sessionId: 'conversation-1',
    entryId: 17,
    created: true,
    preparedTokenId,
    operation: programmaticBinding().operation,
    ...overrides
  }
}

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
    expect(first.grant.consumeInputBytes(3)).toBe(true)
    first.grant.release()
    const second = authority.beginRequest(issued.token)
    expect(second.status).toBe('granted')
    if (second.status !== 'granted') throw new Error('Expected grant')
    expect(second.grant.consumeOutputBytes(3)).toBe(false)
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

  it('fails closed instead of replacing an active per-conversation grant', () => {
    const generatedTokens = [token('a'), token('b')]
    let tokenId = 0
    const authority = new AgentCliTokenAuthority({
      createToken: () => generatedTokens.shift()!,
      createTokenId: () => `token-id-${String((tokenId += 1)).padStart(8, '0')}`,
      maxTokensPerConversation: 1
    })
    const existing = authority.issue({ conversationId: 'conversation-1', scopes: TEST_SCOPES })
    const active = authority.beginRequest(existing.token)
    if (active.status !== 'granted') throw new Error('Expected grant')
    const abort = vi.fn()
    active.grant.signal.addEventListener('abort', abort)

    expect(() =>
      authority.issue({ conversationId: 'conversation-1', scopes: TEST_SCOPES })
    ).toThrow(AgentCliTokenCapacityError)
    expect(abort).not.toHaveBeenCalled()

    active.grant.release()
    expect(authority.beginRequest(existing.token).status).toBe('granted')
  })

  it('fails closed instead of replacing an exact Programmatic grant', () => {
    const generatedTokens = [token('a'), token('b'), token('c')]
    let tokenId = 0
    const authority = new AgentCliTokenAuthority({
      createToken: () => generatedTokens.shift()!,
      createTokenId: () => `programmatic-token-${String((tokenId += 1)).padStart(4, '0')}`,
      maxTokensPerConversation: 1
    })
    const prepared = authority.prepareProgrammaticOperation({
      binding: programmaticBinding(),
      assertAuthorityActive: () => {}
    })

    expect(() =>
      authority.issue({ conversationId: 'conversation-1', scopes: TEST_SCOPES })
    ).toThrow(AgentCliTokenCapacityError)

    const armed = prepared.arm(outerDispatchReceipt(prepared.tokenId))
    expect(() =>
      authority.issue({ conversationId: 'conversation-1', scopes: TEST_SCOPES })
    ).toThrow(AgentCliTokenCapacityError)
    expect(authority.beginRequest(armed.token).status).toBe('granted')
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

  it('keeps an exact Programmatic operation token inert until a new outer T1 arms it', () => {
    const agentToken = token('p')
    const params = { target: 'remote_search', arguments: {} }
    const canonicalInvocationHash = buildAgentCliProgrammaticInvocationHash({
      command: { domain: 'tool', verb: 'call' },
      route: 'tool.call',
      params
    })
    const authority = new AgentCliTokenAuthority({
      now: () => 1_000,
      createToken: () => agentToken,
      createTokenId: () => 'programmatic-token-1'
    })
    const assertAuthorityActive = vi.fn()
    const prepared = authority.prepareProgrammaticOperation({
      binding: programmaticBinding({ canonicalInvocationHash }),
      ttlMs: 10_000,
      assertAuthorityActive
    })

    expect(prepared).not.toHaveProperty('token')
    expect(prepared.operation).toEqual(programmaticBinding().operation)
    expect(authority.beginRequest(agentToken)).toEqual({ status: 'invalid' })
    expect(authority.consumeBytes(prepared.tokenId, 1)).toBe(false)

    const armed = prepared.arm(outerDispatchReceipt())
    expect(authority.consumeBytes(prepared.tokenId, 1)).toBe(false)

    expect(armed).toMatchObject({
      token: agentToken,
      scopes: [],
      maxCalls: 1,
      programmaticOperation: {
        route: 'tool.call',
        canonicalInvocationHash,
        capabilityHash: HASH_B,
        programmaticSurfaceHash: HASH_C,
        outerDispatchReceipt: { sessionId: 'conversation-1', entryId: 17 }
      }
    })
    const request = authority.beginRequest(agentToken)
    expect(request.status).toBe('granted')
    if (request.status !== 'granted') throw new Error('Expected armed Programmatic grant')
    expect(request.grant.claims.programmaticOperation).toBe(armed.programmaticOperation)
    expect(authority.consumeBytes(prepared.tokenId, 1)).toBe(false)
    expect(request.grant.consumeInputBytes(1)).toBe(true)
    expect(request.grant.admitProgrammaticInvocation?.({ route: 'tool.call', params })).toBe(true)
    expect(authority.consumeBytes(prepared.tokenId, 1)).toBe(true)
    request.grant.release()
    expect(authority.beginRequest(agentToken)).toEqual({ status: 'invalid' })
    expect(assertAuthorityActive).toHaveBeenCalledTimes(4)
  })

  it('burns an exact Programmatic token when its canonical request changes', () => {
    const agentToken = token('q')
    const expectedParams = { target: 'remote_search', arguments: { query: 'weather' } }
    const authority = new AgentCliTokenAuthority({
      createToken: () => agentToken,
      createTokenId: () => 'programmatic-token-mismatch'
    })
    const prepared = authority.prepareProgrammaticOperation({
      binding: programmaticBinding({
        canonicalInvocationHash: buildAgentCliProgrammaticInvocationHash({
          command: { domain: 'tool', verb: 'call' },
          route: 'tool.call',
          params: expectedParams
        })
      }),
      assertAuthorityActive: () => undefined
    })
    prepared.arm(outerDispatchReceipt(prepared.tokenId))

    const request = authority.beginRequest(agentToken)
    if (request.status !== 'granted') throw new Error('Expected armed Programmatic grant')
    expect(
      request.grant.admitProgrammaticInvocation?.({
        route: 'tool.call',
        params: { ...expectedParams, arguments: { query: 'changed' } }
      })
    ).toBe(false)
    request.grant.release()

    expect(request.grant.signal.aborted).toBe(true)
    expect(authority.beginRequest(agentToken)).toEqual({ status: 'invalid' })
  })

  it('serializes exact admission and keeps an admitted request live when replayed', () => {
    const agentToken = token('1')
    const params = { target: 'remote_search', arguments: {} }
    const authority = new AgentCliTokenAuthority({
      createToken: () => agentToken,
      createTokenId: () => 'programmatic-token-serialized'
    })
    const prepared = authority.prepareProgrammaticOperation({
      binding: programmaticBinding({
        canonicalInvocationHash: buildAgentCliProgrammaticInvocationHash({
          command: { domain: 'tool', verb: 'call' },
          route: 'tool.call',
          params
        })
      }),
      assertAuthorityActive: () => undefined
    })
    prepared.arm(outerDispatchReceipt(prepared.tokenId))

    const first = authority.beginRequest(agentToken)
    if (first.status !== 'granted') throw new Error('Expected exact admission grant')
    expect(authority.beginRequest(agentToken)).toEqual({ status: 'invalid' })
    expect(first.grant.signal.aborted).toBe(false)
    expect(first.grant.admitProgrammaticInvocation?.({ route: 'tool.call', params })).toBe(true)
    expect(authority.beginRequest(agentToken)).toEqual({ status: 'invalid' })
    expect(first.grant.signal.aborted).toBe(false)
    first.grant.release()
    expect(authority.beginRequest(agentToken)).toEqual({ status: 'invalid' })
  })

  it('binds exact call and batch commands to canonical owned stdin', () => {
    const first = parseAgentCliProgrammaticExecInvocation({
      command: 'deepchat tool call',
      stdin: '{"arguments":{"limit":2,"query":"weather"},"target":"remote_search"}'
    })
    const reordered = parseAgentCliProgrammaticExecInvocation({
      command: 'deepchat tool call',
      stdin: '{ "target": "remote_search", "arguments": { "query": "weather", "limit": 2 } }'
    })
    const changed = parseAgentCliProgrammaticExecInvocation({
      command: 'deepchat tool call',
      stdin: '{"arguments":{"limit":3,"query":"weather"},"target":"remote_search"}'
    })
    const batch = parseAgentCliProgrammaticExecInvocation({
      command: 'deepchat tool batch',
      stdin: '{"steps":[{"target":"remote_search","arguments":{}}]}'
    })

    expect(first).toMatchObject({
      command: { domain: 'tool', verb: 'call' },
      route: 'tool.call'
    })
    expect(first.canonicalInvocationHash).toBe(reordered.canonicalInvocationHash)
    expect(first.canonicalInvocationHash).not.toBe(changed.canonicalInvocationHash)
    expect(first.canonicalInvocationHash).not.toBe(batch.canonicalInvocationHash)
    expect(first.canonicalInvocationHash).toBe(
      buildAgentCliProgrammaticInvocationHash({
        command: { domain: 'tool', verb: 'call' },
        route: 'tool.call',
        params: {
          target: 'remote_search',
          arguments: { query: 'weather', limit: 2 }
        }
      })
    )
  })

  it('binds canonical search and describe scalar arguments without general shell parsing', () => {
    const search = parseAgentCliProgrammaticExecInvocation({
      command: 'deepchat tool search --query "calendar mail" --limit 4'
    })
    const describe = parseAgentCliProgrammaticExecInvocation({
      command: 'deepchat tool describe --target calendar_search'
    })
    const quotedDescribe = parseAgentCliProgrammaticExecInvocation({
      command: 'deepchat tool describe --target "calendar_search"'
    })

    expect(search).toMatchObject({
      command: { domain: 'tool', verb: 'search' },
      route: 'tool.search'
    })
    expect(search.canonicalInvocationHash).toBe(
      buildAgentCliProgrammaticInvocationHash({
        command: { domain: 'tool', verb: 'search' },
        route: 'tool.search',
        params: { query: 'calendar mail', limit: 4 }
      })
    )
    expect(describe.canonicalInvocationHash).toBe(
      buildAgentCliProgrammaticInvocationHash({
        command: { domain: 'tool', verb: 'describe' },
        route: 'tool.describe',
        params: { target: 'calendar_search' }
      })
    )
    expect(quotedDescribe).toEqual(describe)
  })

  it.each([
    { command: 'deepchat tool search', stdin: '{}' },
    { command: 'deepchat tool search --query calendar mail' },
    { command: 'deepchat tool search --query ""' },
    { command: 'deepchat tool search --query " calendar"' },
    { command: 'deepchat tool search --query "calendar  mail"' },
    { command: 'deepchat tool search --query "calendar mail "' },
    { command: 'deepchat tool search --query "calendar mail' },
    { command: 'deepchat tool search --query "calendar $HOME"' },
    { command: 'deepchat tool search --query "calendar $(whoami)"' },
    { command: 'deepchat tool search --query "calendar `whoami`"' },
    { command: 'deepchat tool search --query "calendar; mail"' },
    { command: 'deepchat tool search --query "calendar\\ mail"' },
    { command: 'deepchat tool search --query "calendar mail" extra' },
    { command: 'deepchat tool search --query calendar --limit 2 --limit 3' },
    { command: 'deepchat tool search --limit 2 --query calendar' },
    { command: 'deepchat tool search --query calendar --limit 0x4' },
    { command: 'deepchat tool search --query calendar --limit +4' },
    { command: 'deepchat tool search --query calendar | cat' },
    { command: 'deepchat tool describe --target $TARGET' },
    { command: "deepchat tool describe --target 'calendar_search'" },
    { command: 'deepchat tool describe --target ""' },
    { command: 'deepchat tool describe --target "calendar_search' },
    { command: 'deepchat tool describe --target calendar_search"' },
    { command: 'deepchat tool describe --target "calendar search"' },
    { command: 'deepchat tool describe --target "calendar_search" extra' },
    { command: 'deepchat tool describe --target "calendar_$TARGET"' },
    { command: 'deepchat tool describe --target "calendar_$(whoami)"' },
    { command: 'deepchat tool describe --target "calendar_\\"search"' },
    { command: 'deepchat tool call' },
    { command: 'deepchat tool batch' },
    { command: 'deepchat tool call --target remote', stdin: '{}' },
    { command: 'deepchat tool call', stdin: '' },
    { command: 'deepchat tool call', stdin: '[]' },
    { command: 'deepchat tool batch', stdin: '{' },
    { command: 'deepchat tool call', stdin: '{"target":"remote","arguments":{},"forEach":[]}' },
    {
      command: 'deepchat tool call',
      stdin: `${'{"nested":'.repeat(66)}null${'}'.repeat(66)}`
    }
  ])('rejects non-exact Programmatic exec invocation %#', (input) => {
    expect(() => parseAgentCliProgrammaticExecInvocation(input)).toThrow()
  })

  it('cannot reuse one outer T1 receipt to arm another prepared grant', () => {
    const generatedTokens = [token('v'), token('w')]
    let tokenId = 0
    const authority = new AgentCliTokenAuthority({
      createToken: () => generatedTokens.shift()!,
      createTokenId: () => `programmatic-replay-${(tokenId += 1)}`
    })
    const prepare = () =>
      authority.prepareProgrammaticOperation({
        binding: programmaticBinding(),
        assertAuthorityActive: () => undefined
      })
    const first = prepare()
    const second = prepare()
    const receipt = outerDispatchReceipt(first.tokenId)

    first.arm(receipt)

    expect(() => second.arm(receipt)).toThrow('newly committed outer dispatch receipt')
    expect(authority.beginRequest(token('w'))).toEqual({ status: 'invalid' })
  })

  it('rejects route confusion and quotas above Programmatic hard limits', () => {
    const authority = new AgentCliTokenAuthority()
    const prepare = (binding: AgentCliProgrammaticOperationBinding) =>
      authority.prepareProgrammaticOperation({
        binding,
        assertAuthorityActive: () => undefined
      })

    expect(() => prepare(programmaticBinding({ route: 'tool.batch' }))).toThrow(
      'route does not match its command'
    )
    expect(() =>
      prepare(
        programmaticBinding({
          operation: { ...programmaticBinding().operation, sessionId: 'conversation-1\0hidden' }
        })
      )
    ).toThrow('conversationId must contain 1 to 128 characters')
    expect(() =>
      prepare(
        programmaticBinding({
          quotas: {
            ...programmaticBinding().quotas,
            maxInputBytes: 4 * 1024 * 1024 + 1
          }
        })
      )
    ).toThrow('maxInputBytes exceeds its supported maximum')
    expect(() =>
      prepare(
        programmaticBinding({
          quotas: {
            ...programmaticBinding().quotas,
            maxChildren: 65,
            maxBatchSteps: 65
          }
        })
      )
    ).toThrow('maxChildren exceeds its supported maximum')
    expect(() =>
      prepare(
        programmaticBinding({
          quotas: {
            ...programmaticBinding().quotas,
            maxChildren: 1,
            maxBatchSteps: 2
          }
        })
      )
    ).toThrow('maxBatchSteps must not exceed maxChildren')
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })

  it.each([
    outerDispatchReceipt('programmatic-token-2', { sessionId: 'other-conversation' }),
    outerDispatchReceipt('programmatic-token-2', { entryId: 0 }),
    outerDispatchReceipt('programmatic-token-2', { created: false }),
    outerDispatchReceipt('programmatic-token-2', { preparedTokenId: 'other-token-id' }),
    outerDispatchReceipt('programmatic-token-2', {
      operation: { ...programmaticBinding().operation, providerToolCallId: 'other-provider-call' }
    })
  ])('revokes a prepared grant when its outer T1 receipt is invalid: %j', (receipt) => {
    const agentToken = token('q')
    const authority = new AgentCliTokenAuthority({
      createToken: () => agentToken,
      createTokenId: () => 'programmatic-token-2'
    })
    const prepared = authority.prepareProgrammaticOperation({
      binding: programmaticBinding(),
      assertAuthorityActive: () => undefined
    })

    expect(() => prepared.arm(receipt)).toThrow('newly committed outer dispatch receipt')
    expect(authority.beginRequest(agentToken)).toEqual({ status: 'invalid' })
    expect(() =>
      prepared.arm(outerDispatchReceipt('programmatic-token-2', { entryId: 18 }))
    ).toThrow('no longer pending')
  })

  it('revokes a prepared or armed grant when its process-live View authority expires', () => {
    const generatedTokens = [token('r'), token('s')]
    const authority = new AgentCliTokenAuthority({
      createToken: () => generatedTokens.shift()!,
      createTokenId: () => `programmatic-token-${generatedTokens.length}`
    })
    let active = true
    const assertAuthorityActive = () => {
      if (!active) throw new Error('View revoked')
    }
    const prepared = authority.prepareProgrammaticOperation({
      binding: programmaticBinding(),
      assertAuthorityActive
    })
    active = false

    expect(() => prepared.arm(outerDispatchReceipt('programmatic-token-1'))).toThrow('View revoked')
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })

    active = true
    const armed = authority
      .prepareProgrammaticOperation({
        binding: programmaticBinding(),
        assertAuthorityActive
      })
      .arm(outerDispatchReceipt('programmatic-token-0', { entryId: 18 }))
    active = false

    expect(authority.beginRequest(armed.token)).toEqual({ status: 'invalid' })
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })

  it('does not arm a logically expired grant while its timer callback is delayed', () => {
    let now = 1_000
    const agentToken = token('x')
    const authority = new AgentCliTokenAuthority({
      now: () => now,
      createToken: () => agentToken,
      createTokenId: () => 'programmatic-expired-1'
    })
    const prepared = authority.prepareProgrammaticOperation({
      binding: programmaticBinding(),
      ttlMs: 1_000,
      assertAuthorityActive: () => undefined
    })
    now = 2_000

    expect(() => prepared.arm(outerDispatchReceipt(prepared.tokenId))).toThrow(
      'expired before outer dispatch'
    )
    expect(authority.beginRequest(agentToken)).toEqual({ status: 'invalid' })
  })

  it('rechecks record liveness and rejects admission reentry from a View assertion', () => {
    const generatedTokens = [token('y'), token('z'), token('0')]
    let tokenId = 0
    const authority = new AgentCliTokenAuthority({
      createToken: () => generatedTokens.shift()!,
      createTokenId: () => `programmatic-reentrant-${(tokenId += 1)}`
    })
    let prepared: ReturnType<AgentCliTokenAuthority['prepareProgrammaticOperation']>
    let revokeDuringAssertion = false
    const assertAuthorityActive = () => {
      if (revokeDuringAssertion) prepared.revoke()
    }
    prepared = authority.prepareProgrammaticOperation({
      binding: programmaticBinding(),
      assertAuthorityActive
    })
    revokeDuringAssertion = true

    expect(() => prepared.arm(outerDispatchReceipt(prepared.tokenId))).toThrow('no longer pending')
    expect(authority.beginRequest(token('y'))).toEqual({ status: 'invalid' })

    revokeDuringAssertion = false
    let revokeDuringBegin = false
    const armedPrepared = authority.prepareProgrammaticOperation({
      binding: programmaticBinding(),
      assertAuthorityActive: () => {
        if (revokeDuringBegin) authority.revokeConversation('conversation-1')
      }
    })
    const armed = armedPrepared.arm(outerDispatchReceipt(armedPrepared.tokenId))
    revokeDuringBegin = true

    expect(authority.beginRequest(armed.token)).toEqual({ status: 'invalid' })

    let reenterBegin = false
    let recursiveResult: ReturnType<AgentCliTokenAuthority['beginRequest']> | undefined
    let reentrantToken = ''
    const reentrantPrepared = authority.prepareProgrammaticOperation({
      binding: programmaticBinding(),
      assertAuthorityActive: () => {
        if (reenterBegin) recursiveResult = authority.beginRequest(reentrantToken)
      }
    })
    const reentrantArmed = reentrantPrepared.arm(
      outerDispatchReceipt(reentrantPrepared.tokenId, { entryId: 19 })
    )
    reentrantToken = reentrantArmed.token
    reenterBegin = true

    const admitted = authority.beginRequest(reentrantArmed.token)

    expect(recursiveResult).toEqual({ status: 'invalid' })
    expect(admitted.status).toBe('granted')
  })

  it('lets the owner revoke an inert grant without ever exposing its bearer token', () => {
    const agentToken = token('t')
    const authority = new AgentCliTokenAuthority({
      createToken: () => agentToken,
      createTokenId: () => 'programmatic-token-3'
    })
    const prepared = authority.prepareProgrammaticOperation({
      binding: programmaticBinding(),
      assertAuthorityActive: () => undefined
    })

    prepared.revoke()
    prepared.revoke()

    expect(authority.beginRequest(agentToken)).toEqual({ status: 'invalid' })
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })

  it('lets the owner revoke an armed grant before a shell process can use it', () => {
    const agentToken = token('u')
    const authority = new AgentCliTokenAuthority({
      createToken: () => agentToken,
      createTokenId: () => 'programmatic-token-4'
    })
    const prepared = authority.prepareProgrammaticOperation({
      binding: programmaticBinding(),
      assertAuthorityActive: () => undefined
    })
    prepared.arm(outerDispatchReceipt('programmatic-token-4'))

    prepared.revoke()
    prepared.revoke()

    expect(authority.beginRequest(agentToken)).toEqual({ status: 'invalid' })
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })
})
