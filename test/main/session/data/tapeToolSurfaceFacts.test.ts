import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  TOOL_EXECUTION,
  type MCPToolDefinition,
  type ToolExecutionContract
} from '@shared/types/core/mcp'
import type { DeepChatExecutionToolTargetIdentity } from '@shared/types/execution-contract'
import {
  TOOL_SEARCH_AGENT_TOOL_MAX_CALLS_PER_BATCH,
  TOOL_SEARCH_AGENT_TOOL_MAX_RESULTS,
  TOOL_SEARCH_AGENT_TOOL_SERVER_NAME
} from '@shared/agentTools'
import { buildCanonicalToolCatalog } from '@/agent/deepchat/runtime/toolSurface'
import { hashJsonData } from '@/tape/domain/canonicalJson'
import { buildExecutionToolTargetKey } from '@/tape/domain/executionContract'
import {
  MAX_TAPE_TOOL_CATALOG_PROJECTION_ENTRIES,
  MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES,
  buildProgrammaticToolSurfaceHashV1,
  buildTapeProgrammaticWorkspacePathHash,
  buildTapeToolResultPayloadHash,
  createTapeProgrammaticToolSurfaceFact,
  createTapeToolCatalogFact,
  createTapeToolSurfaceFact,
  getTapeToolSurfaceAdapterMode,
  verifyTapeToolCatalogFact,
  verifyTapeProgrammaticToolSurfaceFact,
  verifyTapeToolSurfaceFact,
  type TapeToolCatalogSourceEntry,
  type TapeToolSurfaceCandidateRejection,
  type TapeToolSurfaceActiveEntry,
  type TapeToolSurfaceSearchResultRef
} from '@/tape/domain/toolSurfaceFacts'

const TAPE_INCARNATION_ID = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333abc'

function target(name: string): DeepChatExecutionToolTargetIdentity {
  return {
    providerVisibleName: name,
    source: 'agent',
    serverName: 'agent-test',
    serverId: null,
    configGeneration: null,
    bindingHash: null,
    originalName: name
  }
}

function catalogEntry(
  name: string,
  execution: ToolExecutionContract = TOOL_EXECUTION.read.parallel
): TapeToolCatalogSourceEntry {
  const identity = target(name)
  return {
    target: identity,
    stableTargetKey: buildExecutionToolTargetKey(identity),
    canonicalToolDefinitionHash: hashJsonData({ name, definition: 1 }),
    exposure: 'user-configurable',
    execution
  }
}

function execCatalogEntry(): TapeToolCatalogSourceEntry {
  const identity: DeepChatExecutionToolTargetIdentity = {
    providerVisibleName: 'exec',
    source: 'agent',
    serverName: 'agent-filesystem',
    serverId: null,
    configGeneration: null,
    bindingHash: null,
    originalName: 'exec'
  }
  return {
    target: identity,
    stableTargetKey: buildExecutionToolTargetKey(identity),
    canonicalToolDefinitionHash: hashJsonData({ name: 'exec', definition: 1 }),
    exposure: 'user-configurable',
    execution: TOOL_EXECUTION.write
  }
}

function mcpCatalogEntry(name: string): TapeToolCatalogSourceEntry {
  const identity: DeepChatExecutionToolTargetIdentity = {
    providerVisibleName: name,
    source: 'mcp',
    serverName: `server-${name}`,
    serverId: '11111111-1111-4111-8111-111111111111',
    configGeneration: 1,
    bindingHash: 'a'.repeat(64),
    originalName: name
  }
  return {
    target: identity,
    stableTargetKey: buildExecutionToolTargetKey(identity),
    canonicalToolDefinitionHash: hashJsonData({ name }),
    exposure: 'user-configurable',
    execution: TOOL_EXECUTION.read.parallel
  }
}

function toolSearchCatalogEntry(): TapeToolCatalogSourceEntry {
  const entry = catalogEntry('tool_search')
  const identity = {
    ...entry.target,
    serverName: TOOL_SEARCH_AGENT_TOOL_SERVER_NAME
  }
  return {
    ...entry,
    target: identity,
    stableTargetKey: buildExecutionToolTargetKey(identity),
    exposure: 'system-model'
  }
}

function renamedMcpToolSearchCatalogEntry(): TapeToolCatalogSourceEntry {
  const identity: DeepChatExecutionToolTargetIdentity = {
    providerVisibleName: 'test-server_tool_search',
    source: 'mcp',
    serverName: 'test-server',
    serverId: '11111111-1111-4111-8111-111111111111',
    configGeneration: 1,
    bindingHash: 'a'.repeat(64),
    originalName: 'tool_search'
  }
  return {
    target: identity,
    stableTargetKey: buildExecutionToolTargetKey(identity),
    canonicalToolDefinitionHash: hashJsonData({ name: 'tool_search', definition: 1 }),
    exposure: 'user-configurable',
    execution: TOOL_EXECUTION.read.parallel
  }
}

function fullCatalogHash(entries: readonly TapeToolCatalogSourceEntry[]): string {
  const ordered = [...entries].sort((left, right) =>
    left.stableTargetKey < right.stableTargetKey ? -1 : 1
  )
  return hashJsonData({
    schemaVersion: 1,
    canonicalizationVersion: 'deepchat-tool-definition-v1',
    entries: ordered.map((entry) => ({
      target: entry.target,
      canonicalToolDefinitionHash: entry.canonicalToolDefinitionHash,
      exposure: entry.exposure,
      execution: entry.execution
    }))
  })
}

function createCatalog(entries: readonly TapeToolCatalogSourceEntry[]) {
  return createTapeToolCatalogFact({
    catalogSchemaVersion: 1,
    canonicalizationVersion: 'deepchat-tool-definition-v1',
    fullCatalogHash: fullCatalogHash(entries),
    entries
  })
}

function activeEntry(
  entry: TapeToolCatalogSourceEntry,
  activationOrdinal: number,
  reason: TapeToolSurfaceActiveEntry['reason'] = 'full-catalog'
): TapeToolSurfaceActiveEntry {
  return {
    ...entry,
    activationOrdinal,
    reason
  }
}

function toolResultRef(entryId: number) {
  return {
    sessionId: 'session-1',
    tapeIncarnationId: TAPE_INCARNATION_ID,
    entryId,
    payloadHashVersion: 1 as const,
    payloadHash: buildTapeToolResultPayloadHash({ entryId })
  }
}

function searchResultRef(
  entry: TapeToolCatalogSourceEntry,
  resultRank: number,
  entryId = 9
): TapeToolSurfaceSearchResultRef {
  return {
    originRequestSeq: 1,
    toolCallOrdinalWithinBatch: 0,
    resultRank,
    stableTargetKey: entry.stableTargetKey,
    canonicalToolDefinitionHash: entry.canonicalToolDefinitionHash,
    toolResult: toolResultRef(entryId)
  }
}

function mcpDefinition(name: string): MCPToolDefinition {
  return {
    type: 'function',
    source: 'mcp',
    execution: TOOL_EXECUTION.read.parallel,
    function: {
      name,
      description: `${name} description`,
      parameters: { type: 'object', properties: {} }
    },
    server: {
      name: 'test-server',
      id: '11111111-1111-4111-8111-111111111111',
      configGeneration: 1,
      bindingHash: 'a'.repeat(64),
      icons: '',
      description: 'Test server'
    },
    raw: {
      name,
      inputSchema: { type: 'object', properties: {} }
    }
  }
}

function createSurface(
  catalogFact: ReturnType<typeof createCatalog>,
  activeEntries: readonly TapeToolSurfaceActiveEntry[],
  contractBearing = true
) {
  return createTapeToolSurfaceFact({
    request: {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: RUN_ID,
      requestSeq: 1
    },
    manifestHash: hashJsonData({ manifest: 1 }),
    catalog: {
      sessionId: 'session-1',
      tapeIncarnationId: TAPE_INCARNATION_ID,
      entryId: 7,
      fullCatalogHash: catalogFact.fullCatalogHash,
      catalogFactHash: catalogFact.catalogFactHash
    },
    canonicalizationVersion: 'deepchat-tool-definition-v1',
    orderingVersion: 'activation-ordinal-v1',
    policyVersion: 'full-v1',
    adapterMode: 'direct-native',
    virtualizationTriggered: false,
    contractBearing,
    activeEntries,
    budget: {
      eligibleToolCount: activeEntries.length,
      activeToolCount: activeEntries.length,
      eligibleDefinitionTokens: activeEntries.length * 10,
      activeDefinitionTokens: activeEntries.length * 10
    }
  })
}

function createVirtualizedSurface(
  catalogFact: ReturnType<typeof createCatalog>,
  activeEntries: readonly TapeToolSurfaceActiveEntry[],
  searchResultRefs: readonly TapeToolSurfaceSearchResultRef[] = [],
  contractBearing = false,
  candidateRejections: readonly TapeToolSurfaceCandidateRejection[] = [],
  requestSeq = 2
) {
  return createTapeToolSurfaceFact({
    request: {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: RUN_ID,
      requestSeq
    },
    manifestHash: hashJsonData({ manifest: 2 }),
    catalog: {
      sessionId: 'session-1',
      tapeIncarnationId: TAPE_INCARNATION_ID,
      entryId: 7,
      fullCatalogHash: catalogFact.fullCatalogHash,
      catalogFactHash: catalogFact.catalogFactHash
    },
    canonicalizationVersion: 'deepchat-tool-definition-v1',
    orderingVersion: 'activation-ordinal-v1',
    policyVersion: 'virtualized-v1',
    adapterMode: 'native-activation',
    virtualizationTriggered: true,
    contractBearing,
    activeEntries,
    budget: {
      eligibleToolCount: activeEntries.length,
      activeToolCount: activeEntries.length,
      eligibleDefinitionTokens: activeEntries.length * 10,
      activeDefinitionTokens: activeEntries.length * 10
    },
    searchResultRefs,
    candidateRejections
  })
}

function createCliProviderSurface(
  entries: readonly TapeToolCatalogSourceEntry[],
  definitionTokens: number
) {
  const catalogFact = createCatalog(entries)
  return createTapeToolSurfaceFact({
    request: {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: RUN_ID,
      requestSeq: 1
    },
    manifestHash: hashJsonData({ manifest: 'programmatic-projection' }),
    catalog: {
      sessionId: 'session-1',
      tapeIncarnationId: TAPE_INCARNATION_ID,
      entryId: 7,
      fullCatalogHash: catalogFact.fullCatalogHash,
      catalogFactHash: catalogFact.catalogFactHash
    },
    canonicalizationVersion: 'deepchat-tool-definition-v1',
    orderingVersion: 'activation-ordinal-v1',
    policyVersion: 'cli-programmatic-v1',
    adapterMode: 'cli-programmatic',
    virtualizationTriggered: true,
    contractBearing: false,
    activeEntries: entries.map((entry, activationOrdinal) =>
      activeEntry(
        entry,
        activationOrdinal,
        entry.target.providerVisibleName === 'exec' ? 'core' : 'policy-required'
      )
    ),
    budget: {
      eligibleToolCount: entries.length,
      activeToolCount: entries.length,
      eligibleDefinitionTokens: definitionTokens,
      activeDefinitionTokens: definitionTokens
    }
  })
}

describe('Tape Tool Surface facts', () => {
  it('builds immutable, independently hash-valid catalog facts in canonical target order', () => {
    const entries = [catalogEntry('write', TOOL_EXECUTION.write), catalogEntry('read')]
    const fact = createCatalog(entries)

    expect(fact.entries.map((entry) => entry.target.providerVisibleName)).toEqual(['read', 'write'])
    expect(fact.totalEntryCount).toBe(2)
    expect(fact.retainedEntryCount).toBe(2)
    expect(fact.degradations).toEqual([])
    expect(verifyTapeToolCatalogFact(fact)).toBe(true)
    expect(Object.isFrozen(fact)).toBe(true)
    expect(Object.isFrozen(fact.entries[0].target)).toBe(true)
  })

  it('accepts the exact catalog identity produced by the canonical Tool Surface owner', () => {
    const catalog = buildCanonicalToolCatalog([
      mcpDefinition('remote_write'),
      mcpDefinition('remote_read')
    ])
    const fact = createTapeToolCatalogFact({
      catalogSchemaVersion: catalog.schemaVersion,
      canonicalizationVersion: catalog.canonicalizationVersion,
      fullCatalogHash: catalog.fullCatalogHash,
      entries: catalog.entries.map((entry) => ({
        target: entry.target,
        stableTargetKey: entry.stableTargetKey,
        canonicalToolDefinitionHash: entry.canonicalToolDefinitionHash,
        exposure: entry.exposure,
        execution: entry.execution
      }))
    })

    expect(fact.fullCatalogHash).toBe(catalog.fullCatalogHash)
    expect(verifyTapeToolCatalogFact(fact)).toBe(true)
  })

  it('accepts canonical target keys whose escaped JSON exceeds the old projection shortcut', () => {
    const identity: DeepChatExecutionToolTargetIdentity = {
      providerVisibleName: '\u0001'.repeat(1_024),
      source: 'agent',
      serverName: '\u0002'.repeat(1_024),
      serverId: null,
      configGeneration: null,
      bindingHash: null,
      originalName: '\u0003'.repeat(1_024)
    }
    const entry: TapeToolCatalogSourceEntry = {
      target: identity,
      stableTargetKey: buildExecutionToolTargetKey(identity),
      canonicalToolDefinitionHash: hashJsonData({ escaped: true }),
      exposure: 'user-configurable',
      execution: TOOL_EXECUTION.read.parallel
    }
    const catalogFact = createCatalog([entry])
    const surfaceFact = createSurface(catalogFact, [activeEntry(entry, 0)])

    expect(Buffer.byteLength(entry.stableTargetKey, 'utf8')).toBeGreaterThan(8 * 1_024)
    expect(verifyTapeToolCatalogFact(catalogFact)).toBe(true)
    expect(verifyTapeToolSurfaceFact(surfaceFact)).toBe(true)
  })

  it('rejects catalog inputs that do not match target or full-catalog identity', () => {
    const entry = catalogEntry('read')
    expect(() =>
      createTapeToolCatalogFact({
        catalogSchemaVersion: 1,
        canonicalizationVersion: 'deepchat-tool-definition-v1',
        fullCatalogHash: '0'.repeat(64),
        entries: [entry]
      })
    ).toThrow('full catalog hash')
    expect(() => createCatalog([{ ...entry, stableTargetKey: 'wrong' }])).toThrow('invalid entry')
  })

  it('retains a bounded catalog projection without claiming it reconstructs the full hash', () => {
    const entries = Array.from(
      { length: MAX_TAPE_TOOL_CATALOG_PROJECTION_ENTRIES + 3 },
      (_, index) => catalogEntry(`tool_${String(index).padStart(4, '0')}`)
    )
    const fact = createCatalog(entries)

    expect(fact.totalEntryCount).toBe(entries.length)
    expect(fact.retainedEntryCount).toBe(MAX_TAPE_TOOL_CATALOG_PROJECTION_ENTRIES)
    expect(fact.degradations).toContain('catalog-projection-count-limited')
    expect(fact.catalogProjectionHash).not.toBe(fact.fullCatalogHash)
    expect(verifyTapeToolCatalogFact(fact)).toBe(true)
  })

  it('detects catalog projection and fact-hash tampering', () => {
    const fact = createCatalog([catalogEntry('read')])
    expect(
      verifyTapeToolCatalogFact({
        ...fact,
        entries: [{ ...fact.entries[0], exposure: 'system-model' }]
      })
    ).toBe(false)
    expect(verifyTapeToolCatalogFact({ ...fact, catalogFactHash: '0'.repeat(64) })).toBe(false)
  })

  it('rejects a coherently rehashed false full-catalog claim when the projection is complete', () => {
    const fact = createCatalog([catalogEntry('read')])
    const forgedFullCatalogHash = 'f'.repeat(64)
    const forgedProjectionHash = hashJsonData({
      projectionHashVersion: fact.projectionHashVersion,
      fullCatalogHash: forgedFullCatalogHash,
      totalEntryCount: fact.totalEntryCount,
      entries: fact.entries
    })
    const { catalogFactHash: _originalFactHash, ...withoutFactHash } = {
      ...fact,
      fullCatalogHash: forgedFullCatalogHash,
      catalogProjectionHash: forgedProjectionHash
    }
    const forged = {
      ...withoutFactHash,
      catalogFactHash: hashJsonData(withoutFactHash)
    }

    expect(verifyTapeToolCatalogFact(forged)).toBe(false)
  })

  it('rejects a coherently rehashed catalog count beyond the builder source ceiling', () => {
    const fact = createCatalog(
      Array.from({ length: MAX_TAPE_TOOL_CATALOG_PROJECTION_ENTRIES + 1 }, (_, index) =>
        catalogEntry(`tool_${String(index).padStart(4, '0')}`)
      )
    )
    const totalEntryCount = 1_025
    const catalogProjectionHash = hashJsonData({
      projectionHashVersion: fact.projectionHashVersion,
      fullCatalogHash: fact.fullCatalogHash,
      totalEntryCount,
      entries: fact.entries
    })
    const { catalogFactHash: _catalogFactHash, ...withoutFactHash } = {
      ...fact,
      totalEntryCount,
      catalogProjectionHash
    }

    expect(
      verifyTapeToolCatalogFact({
        ...withoutFactHash,
        catalogFactHash: hashJsonData(withoutFactHash)
      })
    ).toBe(false)
  })

  it('rejects accessors, proxies, symbols, and hidden fields without executing attacker code', () => {
    const fact = createCatalog([catalogEntry('read')])
    let getterCalls = 0
    const accessorFact = { ...fact }
    Object.defineProperty(accessorFact, 'fullCatalogHash', {
      enumerable: true,
      get: () => {
        getterCalls += 1
        throw new Error('must not execute')
      }
    })
    expect(verifyTapeToolCatalogFact(accessorFact)).toBe(false)
    expect(getterCalls).toBe(0)

    let proxyTrapCalls = 0
    const proxyFact = new Proxy(fact, {
      ownKeys: () => {
        proxyTrapCalls += 1
        throw new Error('must not execute')
      }
    })
    expect(verifyTapeToolCatalogFact(proxyFact)).toBe(false)
    expect(proxyTrapCalls).toBe(0)

    expect(verifyTapeToolCatalogFact({ ...fact, [Symbol('hidden')]: true })).toBe(false)
    const hiddenFact = { ...fact }
    Object.defineProperty(hiddenFact, 'hidden', { enumerable: false, value: true })
    expect(verifyTapeToolCatalogFact(hiddenFact)).toBe(false)
  })

  it('rejects nested proxies, cycles, and excessive depth without throwing', () => {
    const fact = createCatalog([catalogEntry('read')])
    let proxyTrapCalls = 0
    const nestedProxy = new Proxy(fact.entries[0], {
      ownKeys: () => {
        proxyTrapCalls += 1
        throw new Error('must not execute')
      }
    })
    expect(verifyTapeToolCatalogFact({ ...fact, entries: [nestedProxy] })).toBe(false)
    expect(proxyTrapCalls).toBe(0)

    const cyclic = { ...fact, self: null as unknown }
    cyclic.self = cyclic
    expect(verifyTapeToolCatalogFact(cyclic)).toBe(false)

    let nested: Record<string, unknown> = { value: true }
    for (let depth = 0; depth < 70; depth += 1) nested = { nested }
    expect(verifyTapeToolCatalogFact({ ...fact, nested })).toBe(false)
  })

  it('builds a complete strict surface bound to one manifest and physical catalog fact', () => {
    const entries = [catalogEntry('read'), catalogEntry('write', TOOL_EXECUTION.write)]
    const catalogFact = createCatalog(entries)
    const fact = createSurface(
      catalogFact,
      entries.map((entry, index) => activeEntry(entry, index))
    )

    expect(fact.contractBearing).toBe(true)
    expect(fact.activeEntryCount).toBe(2)
    expect(fact.retainedActiveEntryCount).toBe(2)
    expect(fact.catalog.catalogFactHash).toBe(catalogFact.catalogFactHash)
    expect(verifyTapeToolSurfaceFact(fact)).toBe(true)
    expect(Object.isFrozen(fact.activeEntries[0].target)).toBe(true)
  })

  it('rejects incomplete strict surfaces and deterministically truncates oversized V4 evidence', () => {
    const entries = Array.from({ length: MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES + 1 }, (_, index) =>
      catalogEntry(`tool_${String(index).padStart(4, '0')}`)
    )
    const catalogFact = createCatalog(entries)
    const activeEntries = entries.map((entry, index) => activeEntry(entry, index))

    expect(() => createSurface(catalogFact, activeEntries)).toThrow('complete active-entry limit')
    const v4Fact = createSurface(catalogFact, activeEntries, false)
    expect(v4Fact.activeEntryCount).toBe(activeEntries.length)
    expect(v4Fact.retainedActiveEntryCount).toBe(MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES)
    expect(v4Fact.degradations).toContain('active-projection-count-limited')
    expect(verifyTapeToolSurfaceFact(v4Fact)).toBe(true)
  })

  it('rejects duplicate or out-of-order activation ordinals and detects surface tampering', () => {
    const entries = [catalogEntry('read'), catalogEntry('write')]
    const catalogFact = createCatalog(entries)
    expect(() =>
      createSurface(catalogFact, [activeEntry(entries[0], 1), activeEntry(entries[1], 1)])
    ).toThrow('duplicated or out of order')

    const fact = createSurface(catalogFact, [activeEntry(entries[0], 0)])
    expect(
      verifyTapeToolSurfaceFact({
        ...fact,
        policyVersion: 'changed-policy'
      })
    ).toBe(false)
    expect(
      verifyTapeToolSurfaceFact({
        ...fact,
        catalog: { ...fact.catalog, sessionId: 'another-session' }
      })
    ).toBe(false)
  })

  it('binds virtualized activation provenance to physical ToolSearch result facts', () => {
    const search = toolSearchCatalogEntry()
    const discovered = catalogEntry('discovered')
    const rejected = catalogEntry('rejected')
    const catalogFact = createCatalog([search, discovered, rejected])
    const acceptedRef = searchResultRef(discovered, 0)
    const fact = createTapeToolSurfaceFact({
      request: {
        sessionId: 'session-1',
        messageId: 'message-1',
        runId: RUN_ID,
        requestSeq: 2
      },
      manifestHash: hashJsonData({ manifest: 2 }),
      catalog: {
        sessionId: 'session-1',
        tapeIncarnationId: TAPE_INCARNATION_ID,
        entryId: 7,
        fullCatalogHash: catalogFact.fullCatalogHash,
        catalogFactHash: catalogFact.catalogFactHash
      },
      canonicalizationVersion: 'deepchat-tool-definition-v1',
      orderingVersion: 'activation-ordinal-v1',
      policyVersion: 'virtualized-v1',
      adapterMode: 'native-activation',
      virtualizationTriggered: true,
      contractBearing: true,
      activeEntries: [
        activeEntry(search, 0, 'tool-search'),
        activeEntry(discovered, 1, 'search-result')
      ],
      budget: {
        eligibleToolCount: 3,
        activeToolCount: 2,
        eligibleDefinitionTokens: 30,
        activeDefinitionTokens: 20
      },
      searchResultRefs: [acceptedRef],
      candidateRejections: [
        {
          ...searchResultRef(rejected, 1),
          rejectionCode: 'total-surface-count-cap'
        }
      ]
    })

    expect(fact.searchResultRefs[0].toolResult).toEqual(toolResultRef(9))
    expect(fact.candidateRejections[0].toolResult.entryId).toBe(9)
    expect(verifyTapeToolSurfaceFact(fact)).toBe(true)
    expect(
      verifyTapeToolSurfaceFact({
        ...fact,
        searchResultRefs: [
          {
            ...fact.searchResultRefs[0],
            toolResult: { ...fact.searchResultRefs[0].toolResult, entryId: 10 }
          }
        ]
      })
    ).toBe(false)
  })

  it('distinguishes CLI Programmatic provider surfaces from Native Activation', () => {
    const exec = execCatalogEntry()
    const hidden = mcpCatalogEntry('remote_search')
    const catalogFact = createCatalog([exec, hidden])
    const input = {
      request: {
        sessionId: 'session-1',
        messageId: 'message-1',
        runId: RUN_ID,
        requestSeq: 1
      },
      manifestHash: hashJsonData({ manifest: 'programmatic' }),
      catalog: {
        sessionId: 'session-1',
        tapeIncarnationId: TAPE_INCARNATION_ID,
        entryId: 7,
        fullCatalogHash: catalogFact.fullCatalogHash,
        catalogFactHash: catalogFact.catalogFactHash
      },
      canonicalizationVersion: 'deepchat-tool-definition-v1',
      orderingVersion: 'activation-ordinal-v1',
      policyVersion: 'cli-programmatic-v1',
      adapterMode: 'cli-programmatic' as const,
      virtualizationTriggered: true,
      contractBearing: true,
      activeEntries: [activeEntry(exec, 0, 'core')],
      budget: {
        eligibleToolCount: 2,
        activeToolCount: 1,
        eligibleDefinitionTokens: 20,
        activeDefinitionTokens: 10
      }
    }

    const fact = createTapeToolSurfaceFact(input)

    expect(fact.adapterMode).toBe('cli-programmatic')
    expect(verifyTapeToolSurfaceFact(fact)).toBe(true)
    expect(() => createTapeToolSurfaceFact({ ...input, adapterMode: 'native-activation' })).toThrow(
      'ToolSearch identity'
    )
    expect(() => createTapeToolSurfaceFact({ ...input, adapterMode: 'direct-native' })).toThrow(
      'invalid'
    )
    expect(verifyTapeToolSurfaceFact({ ...fact, adapterMode: 'native-activation' })).toBe(false)

    const revokedCatalog = createCatalog([hidden])
    const revoked = createTapeToolSurfaceFact({
      ...input,
      request: { ...input.request, requestSeq: 2 },
      catalog: {
        ...input.catalog,
        fullCatalogHash: revokedCatalog.fullCatalogHash,
        catalogFactHash: revokedCatalog.catalogFactHash
      },
      activeEntries: [],
      budget: {
        eligibleToolCount: 1,
        activeToolCount: 0,
        eligibleDefinitionTokens: 10,
        activeDefinitionTokens: 0
      }
    })
    expect(revoked.activeEntries).toEqual([])
    expect(verifyTapeToolSurfaceFact(revoked)).toBe(true)
  })

  it('retains the historical Tool Surface V1 hash recipe', () => {
    const entry = catalogEntry('read')
    const current = createSurface(createCatalog([entry]), [activeEntry(entry, 0)])
    const { adapterMode: _adapterMode, surfaceHash: _surfaceHash, ...currentBody } = current
    const historicalBody = {
      ...currentBody,
      schemaVersion: 1 as const,
      surfaceHashVersion: 1 as const
    }
    const historical = {
      ...historicalBody,
      surfaceHash: hashJsonData(historicalBody)
    }

    expect(verifyTapeToolSurfaceFact(historical)).toBe(true)
    expect(getTapeToolSurfaceAdapterMode(historical)).toBe('direct-native')
  })

  it('rejects spoofed Agent exec identities from CLI Programmatic surfaces', () => {
    const hidden = mcpCatalogEntry('remote_search')
    const exec = execCatalogEntry()
    const withTarget = (
      targetOverrides: Partial<DeepChatExecutionToolTargetIdentity>
    ): TapeToolCatalogSourceEntry => {
      const target = { ...exec.target, ...targetOverrides }
      return { ...exec, target, stableTargetKey: buildExecutionToolTargetKey(target) }
    }
    const spoofedEntries = [
      withTarget({ serverName: 'agent-test' }),
      withTarget({ originalName: 'shell' }),
      withTarget({
        serverId: '44444444-4444-4444-8444-444444444444',
        configGeneration: 1,
        bindingHash: 'b'.repeat(64)
      }),
      { ...exec, execution: TOOL_EXECUTION.read.parallel }
    ]

    for (const spoofedExec of spoofedEntries) {
      const catalogFact = createCatalog([spoofedExec, hidden])
      expect(() =>
        createTapeToolSurfaceFact({
          request: {
            sessionId: 'session-1',
            messageId: 'message-1',
            runId: RUN_ID,
            requestSeq: 1
          },
          manifestHash: hashJsonData({ manifest: 'spoofed-programmatic' }),
          catalog: {
            sessionId: 'session-1',
            tapeIncarnationId: TAPE_INCARNATION_ID,
            entryId: 7,
            fullCatalogHash: catalogFact.fullCatalogHash,
            catalogFactHash: catalogFact.catalogFactHash
          },
          canonicalizationVersion: 'deepchat-tool-definition-v1',
          orderingVersion: 'activation-ordinal-v1',
          policyVersion: 'cli-programmatic-v1',
          adapterMode: 'cli-programmatic',
          virtualizationTriggered: true,
          contractBearing: true,
          activeEntries: [activeEntry(spoofedExec, 0, 'core')],
          budget: {
            eligibleToolCount: 2,
            activeToolCount: 1,
            eligibleDefinitionTokens: 20,
            activeDefinitionTokens: 10
          }
        })
      ).toThrow('canonical Agent exec')
    }
  })

  it('retains tail-positioned canonical exec when a V4 CLI projection hits the count cap', () => {
    const entries = [
      ...Array.from({ length: MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES }, (_, index) =>
        mcpCatalogEntry(`pinned_${String(index).padStart(3, '0')}`)
      ),
      execCatalogEntry()
    ]

    const fact = createCliProviderSurface(entries, entries.length * 10)

    expect(fact.activeEntryCount).toBe(MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES + 1)
    expect(fact.retainedActiveEntryCount).toBe(MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES)
    expect(fact.degradations).toContain('active-projection-count-limited')
    expect(fact.activeEntries.some((entry) => entry.target.providerVisibleName === 'exec')).toBe(
      true
    )
    expect(verifyTapeToolSurfaceFact(fact)).toBe(true)
  })

  it('retains tail-positioned canonical exec when a V4 CLI projection hits the byte cap', () => {
    const entries = [
      ...Array.from({ length: MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES - 1 }, (_, index) => {
        const suffix = String(index).padStart(3, '0')
        return mcpCatalogEntry(`pinned_${suffix}_${'x'.repeat(850)}`)
      }),
      execCatalogEntry()
    ]

    const fact = createCliProviderSurface(entries, entries.length * 1_000)

    expect(fact.activeEntryCount).toBe(MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES)
    expect(fact.retainedActiveEntryCount).toBeLessThan(MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES)
    expect(fact.degradations).toContain('active-projection-byte-limited')
    expect(fact.activeEntries.some((entry) => entry.target.providerVisibleName === 'exec')).toBe(
      true
    )
    expect(verifyTapeToolSurfaceFact(fact)).toBe(true)
  })

  it('requires complete accepted ToolSearch provenance for strict surfaces', () => {
    const search = toolSearchCatalogEntry()
    const discovered = catalogEntry('discovered')
    const catalogFact = createCatalog([search, discovered])
    const activeEntries = [
      activeEntry(search, 0, 'tool-search'),
      activeEntry(discovered, 1, 'search-result')
    ]

    expect(() => createVirtualizedSurface(catalogFact, activeEntries, [], true)).toThrow(
      'missing accepted ToolSearch result provenance'
    )
    expect(() =>
      createVirtualizedSurface(
        catalogFact,
        activeEntries,
        [
          {
            ...searchResultRef(discovered, 0),
            toolResult: {
              ...toolResultRef(9),
              tapeIncarnationId: '44444444-4444-4444-8444-444444444444'
            }
          }
        ],
        true
      )
    ).toThrow('search provenance')

    const valid = createVirtualizedSurface(
      catalogFact,
      activeEntries,
      [searchResultRef(discovered, 0)],
      true
    )
    const { surfaceHash: _surfaceHash, ...withoutSurfaceHash } = {
      ...valid,
      searchResultRefCount: valid.searchResultRefCount + 1,
      degradations: ['search-refs-truncated'] as const
    }
    expect(
      verifyTapeToolSurfaceFact({
        ...withoutSurfaceHash,
        surfaceHash: hashJsonData(withoutSurfaceHash)
      })
    ).toBe(false)
  })

  it('rejects silent V4 accepted-provenance loss after coherent rehashing', () => {
    const search = toolSearchCatalogEntry()
    const discovered = catalogEntry('discovered')
    const catalogFact = createCatalog([search, discovered])
    const valid = createVirtualizedSurface(
      catalogFact,
      [activeEntry(search, 0, 'tool-search'), activeEntry(discovered, 1, 'search-result')],
      [searchResultRef(discovered, 0)]
    )
    const { surfaceHash: _surfaceHash, ...withoutSurfaceHash } = {
      ...valid,
      searchResultRefCount: 0,
      searchResultRefs: []
    }

    expect(
      verifyTapeToolSurfaceFact({
        ...withoutSurfaceHash,
        surfaceHash: hashJsonData(withoutSurfaceHash)
      })
    ).toBe(false)
  })

  it('rejects one physical ToolSearch result reused by distinct search calls', () => {
    const search = toolSearchCatalogEntry()
    const first = catalogEntry('first')
    const second = catalogEntry('second')
    const catalogFact = createCatalog([search, first, second])
    const reusedResult = toolResultRef(9)

    expect(() =>
      createVirtualizedSurface(
        catalogFact,
        [
          activeEntry(search, 0, 'tool-search'),
          activeEntry(first, 1, 'search-result'),
          activeEntry(second, 2, 'search-result')
        ],
        [
          searchResultRef(first, 0),
          {
            ...searchResultRef(second, 0),
            toolCallOrdinalWithinBatch: 1,
            toolResult: { ...reusedResult, payloadHash: 'f'.repeat(64) }
          }
        ],
        true
      )
    ).toThrow('search provenance')
  })

  it('rejects ToolSearch coordinates outside runtime-emittable batches', () => {
    const search = toolSearchCatalogEntry()
    const rejectedEntries = Array.from(
      { length: TOOL_SEARCH_AGENT_TOOL_MAX_CALLS_PER_BATCH + 1 },
      (_, index) => catalogEntry(`rejected_${index}`)
    )
    const catalogFact = createCatalog([search, ...rejectedEntries])
    const activeEntries = [activeEntry(search, 0, 'tool-search')]

    expect(() =>
      createVirtualizedSurface(catalogFact, activeEntries, [], false, [
        {
          ...searchResultRef(rejectedEntries[0], TOOL_SEARCH_AGENT_TOOL_MAX_RESULTS),
          rejectionCode: 'ineligible'
        }
      ])
    ).toThrow('rejected search provenance')

    const valid = createVirtualizedSurface(catalogFact, activeEntries, [], false, [
      {
        ...searchResultRef(rejectedEntries[0], 0, 20),
        rejectionCode: 'ineligible'
      }
    ])
    const { surfaceHash: _surfaceHash, ...withoutSurfaceHash } = {
      ...valid,
      candidateRejections: [
        {
          ...valid.candidateRejections[0],
          resultRank: TOOL_SEARCH_AGENT_TOOL_MAX_RESULTS
        }
      ]
    }
    expect(
      verifyTapeToolSurfaceFact({
        ...withoutSurfaceHash,
        surfaceHash: hashJsonData(withoutSurfaceHash)
      })
    ).toBe(false)

    expect(() =>
      createVirtualizedSurface(
        catalogFact,
        activeEntries,
        [],
        false,
        rejectedEntries.map((entry, index) => ({
          ...searchResultRef(entry, 0, 20 + index),
          toolCallOrdinalWithinBatch: index,
          rejectionCode: 'ineligible' as const
        }))
      )
    ).toThrow('rejected search provenance')

    expect(() =>
      createVirtualizedSurface(
        catalogFact,
        activeEntries,
        [],
        false,
        [
          {
            ...searchResultRef(rejectedEntries[0], 0, 20),
            originRequestSeq: 1,
            rejectionCode: 'ineligible'
          },
          {
            ...searchResultRef(rejectedEntries[1], 0, 21),
            originRequestSeq: 2,
            rejectionCode: 'ineligible'
          }
        ],
        3
      )
    ).toThrow('rejected search provenance')
  })

  it('rejects rejection batches older than retained accepted activations', () => {
    const search = toolSearchCatalogEntry()
    const discovered = catalogEntry('discovered')
    const rejected = catalogEntry('rejected')
    const catalogFact = createCatalog([search, discovered, rejected])

    expect(() =>
      createVirtualizedSurface(
        catalogFact,
        [activeEntry(search, 0, 'tool-search'), activeEntry(discovered, 1, 'search-result')],
        [{ ...searchResultRef(discovered, 0, 20), originRequestSeq: 2 }],
        false,
        [
          {
            ...searchResultRef(rejected, 0, 21),
            originRequestSeq: 1,
            rejectionCode: 'ineligible'
          }
        ],
        3
      )
    ).toThrow('rejected search provenance')
  })

  it('rejects noncanonical stable target keys in candidate rejection provenance', () => {
    const search = toolSearchCatalogEntry()
    const rejected = catalogEntry('rejected')
    const catalogFact = createCatalog([search, rejected])
    const validRejection = {
      ...searchResultRef(rejected, 0),
      rejectionCode: 'ineligible' as const
    }

    expect(() =>
      createVirtualizedSurface(catalogFact, [activeEntry(search, 0, 'tool-search')], [], false, [
        { ...validRejection, stableTargetKey: 'not-a-canonical-target' }
      ])
    ).toThrow('invalid candidate rejection')

    const valid = createVirtualizedSurface(
      catalogFact,
      [activeEntry(search, 0, 'tool-search')],
      [],
      false,
      [validRejection]
    )
    const { surfaceHash: _surfaceHash, ...withoutSurfaceHash } = {
      ...valid,
      candidateRejections: [
        { ...valid.candidateRejections[0], stableTargetKey: ` ${rejected.stableTargetKey}` }
      ]
    }
    expect(
      verifyTapeToolSurfaceFact({
        ...withoutSurfaceHash,
        surfaceHash: hashJsonData(withoutSurfaceHash)
      })
    ).toBe(false)
  })

  it('requires the complete reserved native ToolSearch identity', () => {
    const search = toolSearchCatalogEntry()
    const catalogFact = createCatalog([search])
    const wrongServerTarget = { ...search.target, serverName: 'agent-test' }
    const wrongServer = {
      ...search,
      target: wrongServerTarget,
      stableTargetKey: buildExecutionToolTargetKey(wrongServerTarget)
    }
    const sequential = {
      ...search,
      execution: TOOL_EXECUTION.read.sequential
    }
    const boundTarget = {
      ...search.target,
      serverId: '55555555-5555-4555-8555-555555555555',
      configGeneration: 1,
      bindingHash: 'b'.repeat(64)
    }
    const bound = {
      ...search,
      target: boundTarget,
      stableTargetKey: buildExecutionToolTargetKey(boundTarget)
    }

    expect(() =>
      createVirtualizedSurface(catalogFact, [activeEntry(wrongServer, 0, 'tool-search')])
    ).toThrow('ToolSearch')
    expect(() =>
      createVirtualizedSurface(catalogFact, [activeEntry(sequential, 0, 'tool-search')])
    ).toThrow('ToolSearch')
    expect(() =>
      createVirtualizedSurface(catalogFact, [activeEntry(bound, 0, 'tool-search')])
    ).toThrow('ToolSearch')

    const valid = createVirtualizedSurface(catalogFact, [activeEntry(search, 0, 'tool-search')])
    const { surfaceHash: _surfaceHash, ...withoutSurfaceHash } = {
      ...valid,
      activeEntries: [activeEntry(wrongServer, 0, 'tool-search')]
    }
    expect(
      verifyTapeToolSurfaceFact({
        ...withoutSurfaceHash,
        surfaceHash: hashJsonData(withoutSurfaceHash)
      })
    ).toBe(false)
  })

  it('does not confuse renamed MCP tools with the reserved native ToolSearch identity', () => {
    const renamed = renamedMcpToolSearchCatalogEntry()
    const fullCatalogFact = createCatalog([renamed])
    const fullSurface = createSurface(fullCatalogFact, [activeEntry(renamed, 0)], false)
    expect(verifyTapeToolSurfaceFact(fullSurface)).toBe(true)

    const search = toolSearchCatalogEntry()
    const virtualizedCatalogFact = createCatalog([search, renamed])
    const virtualizedSurface = createVirtualizedSurface(virtualizedCatalogFact, [
      activeEntry(search, 0, 'tool-search'),
      activeEntry(renamed, 1, 'core')
    ])
    expect(verifyTapeToolSurfaceFact(virtualizedSurface)).toBe(true)
  })

  it('retains ToolSearch in original order when V4 count truncation drops a later activation', () => {
    const ordinaryEntries = Array.from(
      { length: MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES - 1 },
      (_, index) => catalogEntry(`tool_${String(index).padStart(4, '0')}`)
    )
    const search = toolSearchCatalogEntry()
    const discovered = catalogEntry('discovered')
    const catalogFact = createCatalog([...ordinaryEntries, search, discovered])
    const activeEntries = [
      ...ordinaryEntries.map((entry, index) => activeEntry(entry, index, 'core')),
      activeEntry(search, ordinaryEntries.length, 'tool-search'),
      activeEntry(discovered, ordinaryEntries.length + 1, 'search-result')
    ]
    const fact = createVirtualizedSurface(catalogFact, activeEntries, [
      searchResultRef(discovered, 0)
    ])

    expect(fact.retainedActiveEntryCount).toBe(MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES)
    expect(fact.activeEntries.at(-1)?.reason).toBe('tool-search')
    expect(fact.activeEntries.at(-1)?.activationOrdinal).toBe(ordinaryEntries.length)
    expect(fact.degradations).toContain('active-projection-count-limited')
    expect(fact.degradations).toContain('search-refs-truncated')
    expect(verifyTapeToolSurfaceFact(fact)).toBe(true)
  })

  it('rejects coherently rehashed surface counts and non-canonical strict identities', () => {
    const read = catalogEntry('read')
    const catalogFact = createCatalog([read])
    const valid = createSurface(catalogFact, [activeEntry(read, 0)], false)
    const { surfaceHash: _surfaceHash, ...withoutSurfaceHash } = {
      ...valid,
      activeEntryCount: 1_025,
      budget: {
        ...valid.budget,
        eligibleToolCount: 1_025,
        activeToolCount: 1_025
      },
      degradations: ['active-projection-count-limited'] as const
    }
    expect(
      verifyTapeToolSurfaceFact({
        ...withoutSurfaceHash,
        surfaceHash: hashJsonData(withoutSurfaceHash)
      })
    ).toBe(false)

    const strict = createSurface(catalogFact, [activeEntry(read, 0)])
    const { surfaceHash: _strictHash, ...withoutStrictHash } = {
      ...strict,
      request: { ...strict.request, runId: RUN_ID.toUpperCase() }
    }
    expect(
      verifyTapeToolSurfaceFact({
        ...withoutStrictHash,
        surfaceHash: hashJsonData(withoutStrictHash)
      })
    ).toBe(false)

    const { surfaceHash: _v4Hash, ...withoutV4Hash } = {
      ...valid,
      request: { ...valid.request, sessionId: ` ${valid.request.sessionId}` },
      catalog: { ...valid.catalog, sessionId: ` ${valid.catalog.sessionId}` }
    }
    expect(
      verifyTapeToolSurfaceFact({
        ...withoutV4Hash,
        surfaceHash: hashJsonData(withoutV4Hash)
      })
    ).toBe(false)
  })

  it('retains a tail-positioned ToolSearch when V4 active evidence hits its byte limit', () => {
    const ordinaryEntries = Array.from(
      { length: MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES - 1 },
      (_, index) => catalogEntry(`tool_${String(index).padStart(4, '0')}_${'x'.repeat(900)}`)
    )
    const search = toolSearchCatalogEntry()
    const catalogFact = createCatalog([...ordinaryEntries, search])
    const activeEntries = [
      ...ordinaryEntries.map((entry, index) => activeEntry(entry, index, 'core')),
      activeEntry(search, ordinaryEntries.length, 'tool-search')
    ]
    const fact = createVirtualizedSurface(catalogFact, activeEntries)

    expect(fact.retainedActiveEntryCount).toBeLessThan(fact.activeEntryCount)
    expect(fact.activeEntries.at(-1)?.reason).toBe('tool-search')
    expect(fact.activeEntries.at(-1)?.activationOrdinal).toBe(ordinaryEntries.length)
    expect(fact.degradations).toContain('active-projection-byte-limited')
    expect(verifyTapeToolSurfaceFact(fact)).toBe(true)
  })

  it('rejects impossible full surfaces and malformed ToolSearch identities', () => {
    const read = catalogEntry('read')
    const catalogFact = createCatalog([read])
    expect(() =>
      createTapeToolSurfaceFact({
        request: { sessionId: 'session-1', messageId: 'message-1', runId: RUN_ID, requestSeq: 1 },
        manifestHash: hashJsonData({ manifest: 1 }),
        catalog: {
          sessionId: 'session-1',
          tapeIncarnationId: TAPE_INCARNATION_ID,
          entryId: 7,
          fullCatalogHash: catalogFact.fullCatalogHash,
          catalogFactHash: catalogFact.catalogFactHash
        },
        canonicalizationVersion: 'deepchat-tool-definition-v1',
        orderingVersion: 'activation-ordinal-v1',
        policyVersion: 'full-v1',
        adapterMode: 'direct-native',
        virtualizationTriggered: false,
        contractBearing: false,
        activeEntries: [activeEntry(read, 0)],
        budget: {
          eligibleToolCount: 2,
          activeToolCount: 1,
          eligibleDefinitionTokens: 20,
          activeDefinitionTokens: 10
        }
      })
    ).toThrow('non-virtualized')

    expect(() =>
      createTapeToolSurfaceFact({
        request: { sessionId: 'session-1', messageId: 'message-1', runId: RUN_ID, requestSeq: 1 },
        manifestHash: hashJsonData({ manifest: 1 }),
        catalog: {
          sessionId: 'session-1',
          tapeIncarnationId: TAPE_INCARNATION_ID,
          entryId: 7,
          fullCatalogHash: catalogFact.fullCatalogHash,
          catalogFactHash: catalogFact.catalogFactHash
        },
        canonicalizationVersion: 'deepchat-tool-definition-v1',
        orderingVersion: 'activation-ordinal-v1',
        policyVersion: 'virtualized-v1',
        adapterMode: 'native-activation',
        virtualizationTriggered: true,
        contractBearing: false,
        activeEntries: [activeEntry(read, 0, 'core')],
        budget: {
          eligibleToolCount: 1,
          activeToolCount: 1,
          eligibleDefinitionTokens: 10,
          activeDefinitionTokens: 10
        }
      })
    ).toThrow('ToolSearch')
  })

  it('byte-limits V4 active evidence but never truncates a strict active surface', () => {
    const entries = Array.from({ length: MAX_TAPE_TOOL_SURFACE_ACTIVE_ENTRIES }, (_, index) =>
      catalogEntry(`tool_${String(index).padStart(4, '0')}_${'x'.repeat(900)}`)
    )
    const catalogFact = createCatalog(entries)
    const activeEntries = entries.map((entry, index) => activeEntry(entry, index))

    const v4Fact = createSurface(catalogFact, activeEntries, false)
    expect(v4Fact.retainedActiveEntryCount).toBeLessThan(v4Fact.activeEntryCount)
    expect(v4Fact.degradations).toContain('active-projection-byte-limited')
    expect(verifyTapeToolSurfaceFact(v4Fact)).toBe(true)
    expect(() => createSurface(catalogFact, activeEntries, true)).toThrow('canonical byte limit')
  })

  function programmaticInput(entries: readonly TapeToolCatalogSourceEntry[]) {
    const orderedEntries = [...entries].sort((left, right) =>
      left.stableTargetKey < right.stableTargetKey ? -1 : 1
    )
    const catalogHash = fullCatalogHash(orderedEntries)
    return {
      capabilitySchemaVersion: 1 as const,
      capabilityHashVersion: 1 as const,
      capabilityHash: hashJsonData({ capability: entries.length }),
      programmaticSurfaceSchemaVersion: 1 as const,
      programmaticSurfaceHashVersion: 1 as const,
      programmaticSurfaceHash: buildProgrammaticToolSurfaceHashV1({
        schemaVersion: 1,
        canonicalizationVersion: 'deepchat-tool-definition-v1',
        catalogHash,
        entries: orderedEntries
      }),
      canonicalizationVersion: 'deepchat-tool-definition-v1',
      policyVersion: 'programmatic-v1',
      adapterMode: 'cli-programmatic' as const,
      request: { sessionId: 'session-1', messageId: 'message-1', runId: RUN_ID, requestSeq: 1 },
      manifestHash: hashJsonData({ manifest: 1 }),
      catalog: {
        sessionId: 'session-1',
        tapeIncarnationId: TAPE_INCARNATION_ID,
        entryId: 7,
        fullCatalogHash: catalogHash,
        catalogFactHash: hashJsonData({ catalogFact: 1 })
      },
      contractBearing: true,
      entries,
      taskContractRef: null,
      ceilings: {
        maxToolEffect: 'read' as const,
        workspace: { kind: 'runtime_default' as const },
        maxSubagentDepth: 1 as const
      },
      quotas: {
        maxChildren: 8,
        maxBatchSteps: 4,
        maxInputBytes: 1_024,
        maxOutputBytes: 2_048,
        maxDurationMs: 30_000
      }
    }
  }

  it('builds immutable hash-valid programmatic facts in canonical MCP target order', () => {
    const fact = createTapeProgrammaticToolSurfaceFact(
      programmaticInput([mcpCatalogEntry('zeta'), mcpCatalogEntry('alpha')])
    )

    expect(fact.entries.map((entry) => entry.target.providerVisibleName)).toEqual(['alpha', 'zeta'])
    expect(fact.degradations).toEqual([])
    expect(Object.isFrozen(fact.entries[0].target)).toBe(true)
    expect(verifyTapeProgrammaticToolSurfaceFact(fact)).toBe(true)
    expect(verifyTapeProgrammaticToolSurfaceFact({ ...fact, policyVersion: 'forged' })).toBe(false)
  })

  it('matches canonical runtime identity and TaskContract reference boundaries', () => {
    const entry = mcpCatalogEntry('read')
    expect(
      createTapeProgrammaticToolSurfaceFact({
        ...programmaticInput([entry]),
        policyVersion: 'p'.repeat(1_024)
      }).policyVersion
    ).toHaveLength(1_024)
    for (const policyVersion of [' padded ', 'nul\0policy', 'p'.repeat(1_025)]) {
      expect(() =>
        createTapeProgrammaticToolSurfaceFact({
          ...programmaticInput([entry]),
          policyVersion
        })
      ).toThrow('invalid')
    }
    expect(() =>
      createTapeProgrammaticToolSurfaceFact({
        ...programmaticInput([entry]),
        canonicalizationVersion: ' canonicalization-v1 '
      })
    ).toThrow('invalid')

    const oversizedSessionId = 's'.repeat(257)
    const input = programmaticInput([entry])
    expect(() =>
      createTapeProgrammaticToolSurfaceFact({
        ...input,
        request: { ...input.request, sessionId: oversizedSessionId },
        catalog: { ...input.catalog, sessionId: oversizedSessionId },
        taskContractRef: {
          schemaVersion: 1,
          sessionId: oversizedSessionId,
          tapeIdentity: 'b'.repeat(64),
          entryId: 1,
          contractHash: 'c'.repeat(64)
        }
      })
    ).toThrow('invalid')
  })

  it('deterministically count-limits programmatic evidence without claiming completeness', () => {
    const entries = Array.from({ length: 260 }, (_, index) =>
      mcpCatalogEntry(`tool-${String(index).padStart(3, '0')}`)
    )
    const fact = createTapeProgrammaticToolSurfaceFact(programmaticInput(entries.reverse()))

    expect(fact.totalEntryCount).toBe(260)
    expect(fact.retainedEntryCount).toBe(256)
    expect(fact.degradations).toContain('programmatic-projection-count-limited')
    expect(verifyTapeProgrammaticToolSurfaceFact(fact)).toBe(true)
  })

  it('deterministically byte-limits programmatic evidence without exposing the omitted suffix', () => {
    const entries = Array.from({ length: 220 }, (_, index) =>
      mcpCatalogEntry(`tool-${String(index).padStart(3, '0')}-${'x'.repeat(700)}`)
    )
    const fact = createTapeProgrammaticToolSurfaceFact(programmaticInput(entries))

    expect(fact.totalEntryCount).toBe(entries.length)
    expect(fact.retainedEntryCount).toBeLessThan(entries.length)
    expect(fact.degradations).toEqual(['programmatic-projection-byte-limited'])
    expect(verifyTapeProgrammaticToolSurfaceFact(fact)).toBe(true)
  })

  it('hashes normalized workspace paths without persisting paths', () => {
    const workspace = buildTapeProgrammaticWorkspacePathHash('/private/project')
    const fact = createTapeProgrammaticToolSurfaceFact({
      ...programmaticInput([mcpCatalogEntry('read')]),
      ceilings: {
        maxToolEffect: 'read',
        workspace: {
          kind: 'path',
          pathHashVersion: workspace.hashVersion,
          pathHash: workspace.pathHash
        },
        maxSubagentDepth: 0
      }
    })

    expect(JSON.stringify(fact)).not.toContain('/private/project')
    expect(() => buildTapeProgrammaticWorkspacePathHash('/private/../private/project')).toThrow(
      'normalized and absolute'
    )
  })

  it('rejects invalid programmatic authority, references, names, and effect ceilings', () => {
    const first = mcpCatalogEntry('first')
    const conflictTarget = { ...mcpCatalogEntry('second').target, providerVisibleName: 'first' }
    const conflict = {
      ...mcpCatalogEntry('second'),
      target: conflictTarget,
      stableTargetKey: buildExecutionToolTargetKey(conflictTarget)
    }
    expect(() =>
      createTapeProgrammaticToolSurfaceFact(programmaticInput([catalogEntry('agent')]))
    ).toThrow('MCP')
    expect(() =>
      createTapeProgrammaticToolSurfaceFact(
        programmaticInput([{ ...first, exposure: 'system-model' }])
      )
    ).toThrow('user-configurable MCP')
    expect(() => createTapeProgrammaticToolSurfaceFact(programmaticInput([first, first]))).toThrow(
      'duplicate'
    )
    expect(() =>
      createTapeProgrammaticToolSurfaceFact(programmaticInput([first, conflict]))
    ).toThrow('conflicting')
    expect(() =>
      createTapeProgrammaticToolSurfaceFact({
        ...programmaticInput([first]),
        taskContractRef: {
          schemaVersion: 1,
          sessionId: 'other-session',
          tapeIdentity: 'b'.repeat(64),
          entryId: 1,
          contractHash: 'c'.repeat(64)
        }
      })
    ).toThrow('invalid')
    expect(() =>
      createTapeProgrammaticToolSurfaceFact({
        ...programmaticInput([{ ...first, execution: TOOL_EXECUTION.write }])
      })
    ).toThrow('effect ceiling')
    expect(() =>
      createTapeProgrammaticToolSurfaceFact({
        ...programmaticInput([first]),
        unexpected: true
      } as never)
    ).toThrow('invalid')
    expect(() =>
      createTapeProgrammaticToolSurfaceFact({
        ...programmaticInput([first]),
        request: {
          sessionId: 'session-1',
          messageId: 'message-1',
          runId: 'not-a-uuid',
          requestSeq: 1
        }
      })
    ).toThrow('invalid')
    expect(() =>
      createTapeProgrammaticToolSurfaceFact({
        ...programmaticInput([first]),
        quotas: {
          maxChildren: 1,
          maxBatchSteps: 2,
          maxInputBytes: 1_024,
          maxOutputBytes: 2_048,
          maxDurationMs: 30_000
        }
      })
    ).toThrow('invalid')
  })

  it('rejects an internally rehashed impossible MCP exposure', () => {
    const fact = createTapeProgrammaticToolSurfaceFact(programmaticInput([mcpCatalogEntry('read')]))
    const impossibleEntry = { ...fact.entries[0], exposure: 'system-model' as const }
    const impossibleCatalogHash = fullCatalogHash([impossibleEntry])
    const impossibleSurfaceHash = buildProgrammaticToolSurfaceHashV1({
      schemaVersion: 1,
      canonicalizationVersion: fact.canonicalizationVersion,
      catalogHash: impossibleCatalogHash,
      entries: [impossibleEntry]
    })
    const projectionHash = hashJsonData({
      projectionHashVersion: fact.projectionHashVersion,
      capabilityHash: fact.capabilityHash,
      totalEntryCount: fact.totalEntryCount,
      entries: [impossibleEntry]
    })
    const { factHash: _factHash, ...withoutFactHash } = fact
    const forgedWithoutHash = {
      ...withoutFactHash,
      programmaticSurfaceHash: impossibleSurfaceHash,
      projectionHash,
      catalog: { ...fact.catalog, fullCatalogHash: impossibleCatalogHash },
      entries: [impossibleEntry]
    }

    expect(
      verifyTapeProgrammaticToolSurfaceFact({
        ...forgedWithoutHash,
        factHash: hashJsonData(forgedWithoutHash)
      })
    ).toBe(false)
  })
})
