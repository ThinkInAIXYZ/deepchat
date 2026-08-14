import { describe, expect, it, vi } from 'vitest'
import {
  TAPE_TOOL_NAMES,
  TOOL_SEARCH_AGENT_TOOL_NAME,
  TOOL_SEARCH_AGENT_TOOL_SERVER_NAME
} from '@shared/agentTools'
import {
  TOOL_EXECUTION,
  type MCPToolDefinition,
  type MCPToolDefinitionBase
} from '@shared/types/core/mcp'
import {
  MAX_TOOL_SURFACE_ACTIVATION_CANDIDATES,
  MAX_TOOL_SURFACE_CANDIDATE_BATCHES,
  MAX_TOOL_SURFACE_DEFERRED_DISPATCHES,
  MAX_TOOL_SURFACE_DEFINITION_BYTES,
  MAX_TOOL_SURFACE_DEFINITION_DEPTH,
  MAX_TOOL_SURFACE_OVERLAP_IDENTITIES,
  MAX_TOOL_SURFACE_SEARCH_CALLS_PER_BATCH,
  MAX_TOOL_SURFACE_SELECTION_HINTS,
  MAX_TOOL_SURFACE_TOTAL_INPUT_BYTES,
  ToolSurfaceError,
  appendToolSurfaceActivationBatch,
  assertActiveToolSurfaceExecutionContext,
  assertIssuedToolSurfaceExecutionContext,
  assertToolSurfaceDeferredDispatchAllowsDispatch,
  assertToolSurfaceAllowsDispatch,
  buildCanonicalToolCatalog,
  buildToolSurfaceDeferredDispatchBinding,
  buildToolSurfaceRunCeiling,
  claimToolSurfaceExecution,
  computeToolSurfaceShadowDecision,
  computeToolSurfaceStaticDefinitionOverlap,
  createFullToolSurfaceRunController,
  createPolicySelectedToolSurfaceRun,
  createProviderOrderedToolSurfaceActivationLedger,
  createToolSurfaceActivationLedger,
  createToolSurfaceExecutionBatch,
  getToolSurfaceDeferredDispatch,
  createToolSurfaceSnapshot,
  mergeToolSurfaceActivationCandidates,
  mergeToolSurfaceActivationEvidence,
  projectToolSurfaceActiveEntries,
  projectToolSurfaceTapeProvenance,
  registerToolSurfaceDeferredDispatch,
  revokeToolSurfaceDeferredDispatchesForSession,
  revokeToolSurfaceExecutionEligibility,
  type ToolSurfaceActivationCandidate,
  type ToolSurfaceActivationEvidence,
  type ToolSurfaceDefinitionIdentity,
  type ToolSurfaceShadowPolicy
} from '@/agent/deepchat/runtime/toolSurface'
import { buildProviderVisibleToolDefinitionsHash } from '@/tape/domain/executionContract'
import {
  TAPE_TOOL_RESULT_PAYLOAD_HASH_VERSION,
  createTapeToolSurfaceFact
} from '@/tape/domain/toolSurfaceFacts'

const SERVER_ID = '22222222-2222-4222-8222-222222222222'
const BINDING_HASH = 'a'.repeat(64)

function agentTool(
  name: string,
  overrides: Partial<MCPToolDefinitionBase> = {}
): MCPToolDefinition {
  return {
    source: 'agent',
    execution: TOOL_EXECUTION.read.parallel,
    type: 'function',
    function: {
      name,
      description: `${name} description`,
      parameters: { type: 'object', properties: {} }
    },
    server: {
      name:
        name === TOOL_SEARCH_AGENT_TOOL_NAME
          ? TOOL_SEARCH_AGENT_TOOL_SERVER_NAME
          : 'agent-tools',
      icons: '',
      description: 'Agent tools'
    },
    ...overrides
  }
}

function mcpTool(
  visibleName: string,
  overrides: {
    originalName?: string
    serverId?: string
    description?: string
    rawMeta?: Record<string, unknown>
    execution?: MCPToolDefinition['execution']
  } = {}
): MCPToolDefinition {
  return {
    source: 'mcp',
    execution: overrides.execution ?? TOOL_EXECUTION.write,
    type: 'function',
    function: {
      name: visibleName,
      description: overrides.description ?? `${visibleName} description`,
      parameters: { type: 'object', properties: {} }
    },
    server: {
      name: 'remote',
      icons: '',
      description: 'Remote tools',
      id: overrides.serverId ?? SERVER_ID,
      configGeneration: 3,
      bindingHash: BINDING_HASH
    },
    raw: {
      name: overrides.originalName ?? visibleName,
      inputSchema: { type: 'object', properties: {} },
      ...(overrides.rawMeta ? { _meta: overrides.rawMeta } : {})
    }
  }
}

function expectSurfaceError(run: () => unknown, code: ToolSurfaceError['code']): void {
  try {
    run()
    throw new Error('Expected ToolSurfaceError.')
  } catch (error) {
    expect(error).toBeInstanceOf(ToolSurfaceError)
    expect((error as ToolSurfaceError).code).toBe(code)
  }
}

const SHADOW_POLICY: ToolSurfaceShadowPolicy = {
  policyVersion: 'shadow-test-v1',
  enterToolCount: 4,
  exitToolCount: 2,
  enterEstimatedInputTokens: 10_000,
  exitEstimatedInputTokens: 8_000,
  maxInitialToolCount: 4,
  maxInitialDefinitionTokens: 10_000,
  activationReserveToolCount: 1,
  activationReserveDefinitionTokens: 100,
  maxActivationCandidatesPerBatch: 4,
  maxActivationCandidateDefinitionTokensPerBatch: 1_000,
  maxActivationBatchesPerRun: 4,
  maxAppendedTargetsPerRun: 4,
  toolSearchDefinitionTokens: 50,
  toolSearchPromptTokens: 25
}

const candidateScope = {
  sessionId: 'session-1',
  messageId: 'message-1',
  runId: '11111111-1111-4111-8111-111111111111'
}

function definitionIdentity(
  stableTargetKey: string,
  canonicalToolDefinitionHash = 'a'.repeat(64)
): ToolSurfaceDefinitionIdentity {
  return { stableTargetKey, canonicalToolDefinitionHash }
}

function activationCandidate(
  stableTargetKey: string,
  overrides: Partial<ToolSurfaceActivationCandidate> = {}
): ToolSurfaceActivationCandidate {
  return {
    ...candidateScope,
    requestSeq: 1,
    toolCallOrdinalWithinBatch: 0,
    resultRank: 0,
    ...definitionIdentity(stableTargetKey),
    ...overrides
  }
}

function activationEvidence(
  candidate: ToolSurfaceActivationCandidate,
  toolResult: ToolSurfaceActivationEvidence['toolResult'] = {
    sessionId: candidate.sessionId,
    tapeIncarnationId: '00000000-0000-4000-8000-000000000001',
    entryId: candidate.requestSeq * 100 + candidate.toolCallOrdinalWithinBatch + 1,
    payloadHashVersion: TAPE_TOOL_RESULT_PAYLOAD_HASH_VERSION,
    payloadHash: 'f'.repeat(64)
  }
): ToolSurfaceActivationEvidence {
  return { ...candidate, toolResult }
}

describe('canonical Tool Surface catalog', () => {
  it('has a deterministic full hash and entry order across enumeration order', () => {
    const read = agentTool('read')
    const remote = mcpTool('remote_search', { originalName: 'search' })

    const left = buildCanonicalToolCatalog([remote, read])
    const right = buildCanonicalToolCatalog([read, remote])

    expect(left.fullCatalogHash).toBe(right.fullCatalogHash)
    expect(left.entries.map((entry) => entry.stableTargetKey)).toEqual(
      right.entries.map((entry) => entry.stableTargetKey)
    )
    expect(Object.isFrozen(left)).toBe(true)
    expect(Object.isFrozen(left.entries)).toBe(true)
    expect(Object.isFrozen(left.entries[0].target)).toBe(true)
  })

  it('deduplicates an identical target without double-counting bytes or tokens', () => {
    const definition = mcpTool('remote_search')
    const single = buildCanonicalToolCatalog([definition])
    const duplicate = buildCanonicalToolCatalog([definition, structuredClone(definition)])

    expect(duplicate.entries).toHaveLength(1)
    expect(duplicate.canonicalDefinitionBytes).toBe(single.canonicalDefinitionBytes)
    expect(duplicate.definitionTokens).toBe(single.definitionTokens)
    expect(duplicate.fullCatalogHash).toBe(single.fullCatalogHash)
  })

  it('derives from one detached snapshot without invoking caller accessors', () => {
    const topLevel = agentTool('accessor') as MCPToolDefinition & Record<string, unknown>
    const nested = agentTool('nested_accessor')
    let getterCalls = 0
    Object.defineProperty(topLevel, 'function', {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return {
          name: 'accessor',
          description: 'Accessor',
          parameters: { type: 'object', properties: {} }
        }
      }
    })
    const metadata = {} as Record<string, unknown>
    Object.defineProperty(metadata, 'secret', {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return 'do-not-read'
      }
    })
    nested.raw = {
      name: 'nested_accessor',
      inputSchema: { type: 'object', properties: {} },
      _meta: metadata
    }

    expectSurfaceError(() => buildCanonicalToolCatalog([topLevel]), 'invalid_definition')
    expectSurfaceError(() => buildCanonicalToolCatalog([nested]), 'invalid_definition')
    expect(getterCalls).toBe(0)
  })

  it('does not mutate or freeze caller definitions and accepts shared acyclic data', () => {
    const shared = { type: 'string' }
    const definition = agentTool('shared_schema', {
      function: {
        name: 'shared_schema',
        description: 'Shared schema',
        parameters: { type: 'object', properties: { left: shared, right: shared } }
      }
    })

    buildCanonicalToolCatalog([definition])

    expect(Object.isFrozen(definition)).toBe(false)
    expect(Object.isFrozen(definition.function)).toBe(false)
    expect(Object.isFrozen(shared)).toBe(false)
  })

  it('hashes canonical definition metadata but excludes the execution policy', () => {
    const base = mcpTool('remote_search')
    const executionChanged = mcpTool('remote_search', {
      execution: TOOL_EXECUTION.read.parallel
    })
    const descriptionChanged = mcpTool('remote_search', { description: 'Changed' })
    const metadataChanged = mcpTool('remote_search', { rawMeta: { revision: 2 } })

    const baseEntry = buildCanonicalToolCatalog([base]).entries[0]
    expect(baseEntry.canonicalToolDefinitionHash).toBe(
      buildProviderVisibleToolDefinitionsHash([base])
    )
    expect(
      buildCanonicalToolCatalog([executionChanged]).entries[0].canonicalToolDefinitionHash
    ).toBe(baseEntry.canonicalToolDefinitionHash)
    expect(
      buildCanonicalToolCatalog([descriptionChanged]).entries[0].canonicalToolDefinitionHash
    ).not.toBe(baseEntry.canonicalToolDefinitionHash)
    expect(
      buildCanonicalToolCatalog([metadataChanged]).entries[0].canonicalToolDefinitionHash
    ).not.toBe(baseEntry.canonicalToolDefinitionHash)
  })

  it('rejects one provider-visible name that resolves to different stable targets', () => {
    expectSurfaceError(
      () =>
        buildCanonicalToolCatalog([
          mcpTool('remote_search'),
          mcpTool('remote_search', {
            serverId: '33333333-3333-4333-8333-333333333333'
          })
        ]),
      'conflicting_tool'
    )
  })

  it('rejects exact target duplicates with conflicting definitions or effects', () => {
    expectSurfaceError(
      () =>
        buildCanonicalToolCatalog([
          mcpTool('remote_search'),
          mcpTool('remote_search', { description: 'Conflicting description' })
        ]),
      'conflicting_tool'
    )
    expectSurfaceError(
      () =>
        buildCanonicalToolCatalog([
          mcpTool('remote_search'),
          mcpTool('remote_search', { execution: TOOL_EXECUTION.read.parallel })
        ]),
      'conflicting_tool'
    )
    expectSurfaceError(
      () =>
        buildCanonicalToolCatalog([
          mcpTool('remote_search', { execution: TOOL_EXECUTION.read.parallel }),
          mcpTool('remote_search', { execution: TOOL_EXECUTION.read.sequential })
        ]),
      'conflicting_tool'
    )
  })

  it('preserves reviewed model exposure and rejects non-model Agent tools', () => {
    expect(buildCanonicalToolCatalog([agentTool(TAPE_TOOL_NAMES.search)]).entries[0].exposure).toBe(
      'system-model'
    )
    expectSurfaceError(
      () => buildCanonicalToolCatalog([agentTool(TAPE_TOOL_NAMES.info)]),
      'ineligible_exposure'
    )
    expectSurfaceError(
      () => buildCanonicalToolCatalog([agentTool(TAPE_TOOL_NAMES.handoff)]),
      'ineligible_exposure'
    )
  })

  it('rejects canonical definitions over the byte limit', () => {
    expectSurfaceError(
      () =>
        buildCanonicalToolCatalog([
          agentTool('oversized', {
            function: {
              name: 'oversized',
              description: 'x'.repeat(MAX_TOOL_SURFACE_DEFINITION_BYTES + 1),
              parameters: { type: 'object', properties: {} }
            }
          })
        ]),
      'limit_exceeded'
    )
  })

  it('accounts for JSON escaping before recursive canonicalization', () => {
    expectSurfaceError(
      () =>
        buildCanonicalToolCatalog([
          agentTool('escaped', {
            function: {
              name: 'escaped',
              description: '\u0000'.repeat(Math.ceil(MAX_TOOL_SURFACE_DEFINITION_BYTES / 6)),
              parameters: { type: 'object', properties: {} }
            }
          })
        ]),
      'limit_exceeded'
    )
  })

  it('bounds aggregate validation work even for duplicate definitions', () => {
    const description = 'x'.repeat(Math.floor(MAX_TOOL_SURFACE_DEFINITION_BYTES / 2))
    const definitions = Array.from(
      { length: Math.ceil(MAX_TOOL_SURFACE_TOTAL_INPUT_BYTES / description.length) + 2 },
      () =>
        agentTool('duplicate_large', {
          function: {
            name: 'duplicate_large',
            description,
            parameters: { type: 'object', properties: {} }
          }
        })
    )

    expectSurfaceError(() => buildCanonicalToolCatalog(definitions), 'limit_exceeded')
  })

  it('rejects adversarial nesting before canonical recursive hashing', () => {
    let nested: Record<string, unknown> = {}
    for (let depth = 0; depth <= MAX_TOOL_SURFACE_DEFINITION_DEPTH; depth += 1) {
      nested = { nested }
    }

    expectSurfaceError(
      () =>
        buildCanonicalToolCatalog([
          agentTool('deep_schema', {
            function: {
              name: 'deep_schema',
              description: 'Deep schema',
              parameters: { type: 'object', properties: nested }
            }
          })
        ]),
      'limit_exceeded'
    )
  })

  it('rejects circular schemas and undefined array elements', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expectSurfaceError(
      () =>
        buildCanonicalToolCatalog([
          agentTool('circular', {
            function: {
              name: 'circular',
              description: 'Circular schema',
              parameters: { type: 'object', properties: circular }
            }
          })
        ]),
      'invalid_definition'
    )

    expectSurfaceError(
      () =>
        buildCanonicalToolCatalog([
          mcpTool('undefined_array', { rawMeta: { values: [undefined] } })
        ]),
      'invalid_definition'
    )
  })

  it('rejects Proxy definitions before property traversal', () => {
    let trapCalls = 0
    const definition = new Proxy(agentTool('proxied'), {
      ownKeys: (target) => {
        trapCalls += 1
        return Reflect.ownKeys(target)
      }
    })

    expectSurfaceError(() => buildCanonicalToolCatalog([definition]), 'invalid_definition')
    expect(trapCalls).toBe(0)
  })

  it('normalizes object key order before token estimation', () => {
    const leftProperties = { alpha: { type: 'string' }, beta: { type: 'number' } }
    const rightProperties = { beta: { type: 'number' }, alpha: { type: 'string' } }
    const left = agentTool('ordered', {
      function: {
        name: 'ordered',
        description: 'Ordered',
        parameters: { type: 'object', properties: leftProperties }
      }
    })
    const right = agentTool('ordered', {
      function: {
        name: 'ordered',
        description: 'Ordered',
        parameters: { type: 'object', properties: rightProperties }
      }
    })

    expect(buildCanonicalToolCatalog([left]).definitionTokens).toBe(
      buildCanonicalToolCatalog([right]).definitionTokens
    )
  })
})

describe('Tool Surface provider ordering', () => {
  it('preserves initial and deterministic candidate-merge order across activation batches', () => {
    const initial = createToolSurfaceActivationLedger([
      definitionIdentity('target-b'),
      definitionIdentity('target-a')
    ])
    const appended = appendToolSurfaceActivationBatch(initial, [
      definitionIdentity('target-d'),
      definitionIdentity('target-b'),
      definitionIdentity('target-c')
    ])

    expect(appended.entries).toEqual([
      { ...definitionIdentity('target-b'), activationOrdinal: 0 },
      { ...definitionIdentity('target-a'), activationOrdinal: 1 },
      { ...definitionIdentity('target-d'), activationOrdinal: 2 },
      { ...definitionIdentity('target-c'), activationOrdinal: 3 }
    ])
    expect(initial.entries).toHaveLength(2)
    expect(Object.isFrozen(appended)).toBe(true)
    expect(Object.isFrozen(appended.entries)).toBe(true)
    expect(appended.entries.every((entry) => Object.isFrozen(entry))).toBe(true)
    expectSurfaceError(
      () =>
        createToolSurfaceActivationLedger([
          definitionIdentity('target-a'),
          definitionIdentity('target-a')
        ]),
      'conflicting_tool'
    )
  })

  it('filters revoked targets and restores their original ordinals on re-enablement', () => {
    const ledger = appendToolSurfaceActivationBatch(
      createToolSurfaceActivationLedger([
        definitionIdentity('target-b'),
        definitionIdentity('target-a')
      ]),
      [definitionIdentity('target-d'), definitionIdentity('target-c')]
    )

    expect(
      projectToolSurfaceActiveEntries(ledger, [
        definitionIdentity('target-d'),
        definitionIdentity('target-a')
      ]).map((entry) => [entry.stableTargetKey, entry.activationOrdinal])
    ).toEqual([
      ['target-a', 1],
      ['target-d', 2]
    ])
    expect(
      projectToolSurfaceActiveEntries(ledger, [
        definitionIdentity('target-c'),
        definitionIdentity('target-b'),
        definitionIdentity('target-d'),
        definitionIdentity('target-a')
      ]).map((entry) => [entry.stableTargetKey, entry.activationOrdinal])
    ).toEqual([
      ['target-b', 0],
      ['target-a', 1],
      ['target-d', 2],
      ['target-c', 3]
    ])
  })

  it('retains revoked ledger entries while appending and later restoring authority', () => {
    const initial = createToolSurfaceActivationLedger([
      definitionIdentity('target-a'),
      definitionIdentity('target-b'),
      definitionIdentity('target-c')
    ])
    expect(
      projectToolSurfaceActiveEntries(initial, [
        definitionIdentity('target-a'),
        definitionIdentity('target-b')
      ]).map((entry) => entry.stableTargetKey)
    ).toEqual(['target-a', 'target-b'])

    const appended = appendToolSurfaceActivationBatch(initial, [definitionIdentity('target-d')])
    expect(
      projectToolSurfaceActiveEntries(appended, [
        definitionIdentity('target-a'),
        definitionIdentity('target-b'),
        definitionIdentity('target-d')
      ]).map((entry) => [entry.stableTargetKey, entry.activationOrdinal])
    ).toEqual([
      ['target-a', 0],
      ['target-b', 1],
      ['target-d', 3]
    ])
    expect(
      projectToolSurfaceActiveEntries(appended, [
        definitionIdentity('target-d'),
        definitionIdentity('target-c'),
        definitionIdentity('target-b'),
        definitionIdentity('target-a')
      ]).map((entry) => [entry.stableTargetKey, entry.activationOrdinal])
    ).toEqual([
      ['target-a', 0],
      ['target-b', 1],
      ['target-c', 2],
      ['target-d', 3]
    ])
  })

  it('rejects definition drift and malformed activation ledgers', () => {
    const ledger = createToolSurfaceActivationLedger([definitionIdentity('target-a')])
    expectSurfaceError(
      () =>
        appendToolSurfaceActivationBatch(ledger, [
          definitionIdentity('target-a', 'b'.repeat(64))
        ]),
      'conflicting_tool'
    )
    expectSurfaceError(
      () =>
        projectToolSurfaceActiveEntries(ledger, [
          definitionIdentity('target-a', 'b'.repeat(64))
        ]),
      'conflicting_tool'
    )
    expectSurfaceError(
      () =>
        appendToolSurfaceActivationBatch(
          {
            orderingVersion: 'activation-ordinal-v1',
            entries: [{ ...definitionIdentity('target-a'), activationOrdinal: 1 }]
          },
          []
        ),
      'invalid_definition'
    )
    expectSurfaceError(
      () => createToolSurfaceActivationLedger([definitionIdentity('target-a', 'not-a-hash')]),
      'invalid_definition'
    )
  })
})

describe('Run Tool Ceiling and Tool Surface snapshots', () => {
  it('detaches and deeply freezes the bounded Run ceiling', () => {
    const original = agentTool('read', {
      function: {
        name: 'read',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path']
        }
      }
    })

    const ceiling = buildToolSurfaceRunCeiling([original])
    const frozenDefinition = ceiling.entries[0].definition
    original.function.description = 'mutated after freeze'
    ;(original.function.parameters.properties.path as { type: string }).type = 'number'

    expect(frozenDefinition.function.description).toBe('Read a file')
    expect(frozenDefinition.function.parameters.properties.path).toEqual({ type: 'string' })
    expect(Object.isFrozen(ceiling)).toBe(true)
    expect(Object.isFrozen(ceiling.entries)).toBe(true)
    expect(Object.isFrozen(frozenDefinition)).toBe(true)
    expect(Object.isFrozen(frozenDefinition.function)).toBe(true)
    expect(Object.isFrozen(frozenDefinition.function.parameters.properties.path)).toBe(true)
  })

  it('preserves provider order while projecting current revocation into an immutable View', () => {
    const write = agentTool('write')
    const read = agentTool('read')
    const search = agentTool('search')
    const ceiling = buildToolSurfaceRunCeiling([read, search, write])
    const ledger = createProviderOrderedToolSurfaceActivationLedger([write, read, search])

    const revoked = createToolSurfaceSnapshot({
      request: { sessionId: 's1', messageId: 'm1', runId: 'r1', requestSeq: 1 },
      policyVersion: 'full-v1',
      virtualizationTriggered: false,
      ceiling,
      eligibleDefinitions: [read, write],
      activationLedger: ledger
    })
    const restored = createToolSurfaceSnapshot({
      request: { sessionId: 's1', messageId: 'm1', runId: 'r1', requestSeq: 2 },
      policyVersion: 'full-v1',
      virtualizationTriggered: false,
      ceiling,
      eligibleDefinitions: [search, write, read],
      activationLedger: ledger
    })

    expect(revoked.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'write',
      'read'
    ])
    expect(revoked.activeEntries.map((entry) => entry.activationOrdinal)).toEqual([0, 1])
    expect(restored.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'write',
      'read',
      'search'
    ])
    expect(restored.activeEntries.map((entry) => entry.activationOrdinal)).toEqual([0, 1, 2])
    expect(Object.isFrozen(restored)).toBe(true)
    expect(Object.isFrozen(restored.request)).toBe(true)
    expect(Object.isFrozen(restored.activeEntries)).toBe(true)
    expect(Object.isFrozen(restored.toolDefinitions)).toBe(true)
    expect(Object.isFrozen(restored.toolDefinitions[0].function.parameters)).toBe(true)
  })

  it('commits append order only when a full Tool Surface View is admitted', () => {
    const read = agentTool('read')
    const write = agentTool('write')
    const search = agentTool('search')
    const controller = createFullToolSurfaceRunController({
      ceilingDefinitions: [read, write, search],
      initialActiveDefinitions: [write, read],
      policyVersion: 'full-v1'
    })
    const request = (requestSeq: number) => ({
      sessionId: 's1',
      messageId: 'm1',
      runId: 'r1',
      requestSeq
    })

    const initial = controller.build({
      request: request(1),
      eligibleDefinitions: [read, write]
    })
    expect(initial.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'write',
      'read'
    ])
    controller.admit(initial)

    const expanded = controller.build({
      request: request(2),
      eligibleDefinitions: [search, read, write]
    })
    expect(expanded.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'write',
      'read',
      'search'
    ])
    controller.admit(expanded)
    expectSurfaceError(
      () => assertToolSurfaceAllowsDispatch(initial, request(1), 'read', read),
      'invalid_definition'
    )

    const revoked = controller.build({
      request: request(3),
      eligibleDefinitions: [search, write]
    })
    expect(revoked.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'write',
      'search'
    ])
    controller.admit(revoked)

    const restored = controller.build({
      request: request(4),
      eligibleDefinitions: [read, search, write]
    })
    expect(restored.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'write',
      'read',
      'search'
    ])
    expect(restored.activeEntries.map((entry) => entry.activationOrdinal)).toEqual([0, 1, 2])
  })

  it('rejects stale or foreign admission without mutating the committed ledger', () => {
    const read = agentTool('read')
    const write = agentTool('write')
    const search = agentTool('search')
    const controller = createFullToolSurfaceRunController({
      ceilingDefinitions: [read, write, search],
      initialActiveDefinitions: [read],
      policyVersion: 'full-v1'
    })
    const request = (requestSeq: number) => ({
      sessionId: 's1',
      messageId: 'm1',
      runId: 'r1',
      requestSeq
    })
    const firstProposal = controller.build({
      request: request(1),
      eligibleDefinitions: [read, write]
    })
    const competingProposal = controller.build({
      request: request(2),
      eligibleDefinitions: [read, search]
    })

    controller.admit(firstProposal)
    expect(() => controller.admit(firstProposal)).not.toThrow()
    expectSurfaceError(() => controller.admit(competingProposal), 'conflicting_tool')

    const afterAdmission = controller.build({
      request: request(3),
      eligibleDefinitions: [read, search, write]
    })
    expect(afterAdmission.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'read',
      'write',
      'search'
    ])

    const otherController = createFullToolSurfaceRunController({
      ceilingDefinitions: [read],
      initialActiveDefinitions: [read],
      policyVersion: 'full-v1'
    })
    const foreign = otherController.build({
      request: request(4),
      eligibleDefinitions: [read]
    })
    expectSurfaceError(() => controller.admit(foreign), 'invalid_definition')
  })

  it('rejects full Run state outside its frozen ceiling or with definition drift', () => {
    const read = agentTool('read')
    const write = agentTool('write')

    expectSurfaceError(
      () =>
        createFullToolSurfaceRunController({
          ceilingDefinitions: [read],
          initialActiveDefinitions: [write],
          policyVersion: 'full-v1'
        }),
      'conflicting_tool'
    )
    expectSurfaceError(
      () =>
        createFullToolSurfaceRunController({
          ceilingDefinitions: [read],
          initialActiveDefinitions: [{ ...read, execution: TOOL_EXECUTION.write }],
          policyVersion: 'full-v1'
        }),
      'conflicting_tool'
    )

    const controller = createFullToolSurfaceRunController({
      ceilingDefinitions: [read],
      initialActiveDefinitions: [read],
      policyVersion: 'full-v1'
    })
    expectSurfaceError(
      () =>
        controller.build({
          request: { sessionId: 's1', messageId: 'm1', runId: 'r1', requestSeq: 1 },
          eligibleDefinitions: [
            agentTool('read', { function: { ...read.function, description: 'drifted' } })
          ]
        }),
      'conflicting_tool'
    )
  })

  it('keeps catalog identity canonical while provider activation order follows each input', () => {
    const read = agentTool('read')
    const write = agentTool('write')
    const firstCeiling = buildToolSurfaceRunCeiling([write, read])
    const secondCeiling = buildToolSurfaceRunCeiling([read, write])
    const firstLedger = createProviderOrderedToolSurfaceActivationLedger([write, read, read])
    const secondLedger = createProviderOrderedToolSurfaceActivationLedger([read, write])

    expect(firstCeiling.catalog.fullCatalogHash).toBe(
      buildCanonicalToolCatalog([read, write]).fullCatalogHash
    )
    expect(firstCeiling.catalog.fullCatalogHash).toBe(secondCeiling.catalog.fullCatalogHash)
    expect(firstLedger.entries.map((entry) => entry.stableTargetKey)).toEqual([
      firstCeiling.catalog.entries.find((entry) => entry.target.providerVisibleName === 'write')!
        .stableTargetKey,
      firstCeiling.catalog.entries.find((entry) => entry.target.providerVisibleName === 'read')!
        .stableTargetKey
    ])
    expect(secondLedger.entries.map((entry) => entry.stableTargetKey)).toEqual([
      secondCeiling.catalog.entries.find((entry) => entry.target.providerVisibleName === 'read')!
        .stableTargetKey,
      secondCeiling.catalog.entries.find((entry) => entry.target.providerVisibleName === 'write')!
        .stableTargetKey
    ])
  })

  it('supports a virtualized subset with explicit stable selection reasons', () => {
    const definitions = [agentTool('read'), agentTool('write')]
    const ceiling = buildToolSurfaceRunCeiling(definitions)
    const readEntry = ceiling.catalog.entries.find(
      (entry) => entry.target.providerVisibleName === 'read'
    )!
    const ledger = createToolSurfaceActivationLedger([readEntry])

    const snapshot = createToolSurfaceSnapshot({
      request: { sessionId: 's1', messageId: 'm1', runId: 'r1', requestSeq: 1 },
      policyVersion: 'virtual-v1',
      virtualizationTriggered: true,
      ceiling,
      eligibleDefinitions: definitions,
      activationLedger: ledger,
      selectionReasons: [{ stableTargetKey: readEntry.stableTargetKey, reason: 'core' }]
    })

    expect(snapshot.activeEntries).toHaveLength(1)
    expect(snapshot.activeEntries[0]).toMatchObject({ reason: 'core', activationOrdinal: 0 })
    expect(snapshot.toolDefinitions[0].function.name).toBe('read')
  })

  it('binds dispatch to an admitted View and its exact active definition hash', () => {
    const read = agentTool('read')
    const write = agentTool('write')
    const controller = createFullToolSurfaceRunController({
      ceilingDefinitions: [read, write],
      initialActiveDefinitions: [read],
      policyVersion: 'full-test'
    })
    const dispatchRequest = {
      sessionId: 's1',
      messageId: 'm1',
      runId: 'r1',
      requestSeq: 1
    }
    const snapshot = controller.build({
      request: dispatchRequest,
      eligibleDefinitions: [read]
    })

    expectSurfaceError(
      () => assertToolSurfaceAllowsDispatch(snapshot, dispatchRequest, 'read', read),
      'invalid_definition'
    )
    controller.admit(snapshot)
    expect(() =>
      assertToolSurfaceAllowsDispatch(snapshot, dispatchRequest, 'read', read)
    ).not.toThrow()
    expect(() =>
      assertToolSurfaceAllowsDispatch(snapshot, dispatchRequest, 'write', write)
    ).toThrow('Tool is not available in the current session: write')
    expect(() =>
      assertToolSurfaceAllowsDispatch(snapshot, dispatchRequest, 'write', undefined)
    ).toThrow('Tool is not available in the current session: write')
    expectSurfaceError(
      () =>
        assertToolSurfaceAllowsDispatch(
          snapshot,
          dispatchRequest,
          'read',
          agentTool('read', {
            function: { ...read.function, description: 'drifted after assembly' }
          })
        ),
      'conflicting_tool'
    )
    expectSurfaceError(
      () => assertToolSurfaceAllowsDispatch(snapshot, dispatchRequest, 'read', undefined),
      'conflicting_tool'
    )
    expectSurfaceError(
      () =>
        assertToolSurfaceAllowsDispatch(
          snapshot,
          dispatchRequest,
          'read',
          agentTool('read', { execution: TOOL_EXECUTION.write })
        ),
      'conflicting_tool'
    )
    expectSurfaceError(
      () =>
        assertToolSurfaceAllowsDispatch(
          snapshot,
          { ...dispatchRequest, requestSeq: 2 },
          'read',
          read
        ),
      'invalid_definition'
    )
    revokeToolSurfaceExecutionEligibility(snapshot)
    expectSurfaceError(
      () => assertToolSurfaceAllowsDispatch(snapshot, dispatchRequest, 'read', read),
      'invalid_definition'
    )
  })

  it('allows one execution settlement claim per admitted full View', () => {
    const read = agentTool('read')
    const controller = createFullToolSurfaceRunController({
      ceilingDefinitions: [read],
      initialActiveDefinitions: [read],
      policyVersion: 'full-test'
    })
    const snapshot = controller.build({
      request: { sessionId: 's1', messageId: 'm1', runId: 'r1', requestSeq: 1 },
      eligibleDefinitions: [read]
    })
    controller.admit(snapshot)

    expect(() => claimToolSurfaceExecution(snapshot)).not.toThrow()
    expectSurfaceError(() => claimToolSurfaceExecution(snapshot), 'invalid_definition')
  })

  it('binds a paused approval to one process-live tool call after its View is revoked', () => {
    const read = agentTool('read')
    const controller = createFullToolSurfaceRunController({
      ceilingDefinitions: [read],
      initialActiveDefinitions: [read],
      policyVersion: 'full-test'
    })
    const snapshot = controller.build({
      request: { sessionId: 's1', messageId: 'm1', runId: 'r1', requestSeq: 1 },
      eligibleDefinitions: [read]
    })
    controller.admit(snapshot)
    const capability = registerToolSurfaceDeferredDispatch({
      snapshot,
      toolCallId: 'call-1',
      toolName: 'read',
      binding: buildToolSurfaceDeferredDispatchBinding({
        snapshot,
        toolCallId: 'call-1',
        toolName: 'read',
        contractBearing: false
      })
    })!
    revokeToolSurfaceExecutionEligibility(snapshot)

    expectSurfaceError(
      () => assertToolSurfaceAllowsDispatch(snapshot, snapshot.request, 'read', read),
      'invalid_definition'
    )
    expect(() =>
      assertToolSurfaceDeferredDispatchAllowsDispatch(
        capability,
        { sessionId: 's1', messageId: 'm1', toolCallId: 'call-1', toolName: 'read' },
        read
      )
    ).not.toThrow()
    expect(getToolSurfaceDeferredDispatch('s1', 'm1', 'call-1')).toBe(capability)
    expectSurfaceError(
      () =>
        assertToolSurfaceDeferredDispatchAllowsDispatch(
          capability,
          { sessionId: 's1', messageId: 'm1', toolCallId: 'call-2', toolName: 'read' },
          read
        ),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        assertToolSurfaceDeferredDispatchAllowsDispatch(
          capability,
          { sessionId: 's1', messageId: 'm1', toolCallId: 'call-1', toolName: 'read' },
          agentTool('read', { execution: TOOL_EXECUTION.write })
        ),
      'conflicting_tool'
    )
    revokeToolSurfaceDeferredDispatchesForSession('s1')
  })

  it('fails closed without evicting deferred dispatch authority when capacity is exhausted', () => {
    const read = agentTool('read')
    const controller = createFullToolSurfaceRunController({
      ceilingDefinitions: [read],
      initialActiveDefinitions: [read],
      policyVersion: 'full-test'
    })
    const snapshot = controller.build({
      request: {
        sessionId: 'capacity-session',
        messageId: 'capacity-message',
        runId: 'capacity-run',
        requestSeq: 1
      },
      eligibleDefinitions: [read]
    })
    controller.admit(snapshot)

    try {
      for (let index = 0; index < MAX_TOOL_SURFACE_DEFERRED_DISPATCHES; index += 1) {
        const toolCallId = `capacity-call-${index}`
        registerToolSurfaceDeferredDispatch({
          snapshot,
          toolCallId,
          toolName: 'read',
          binding: buildToolSurfaceDeferredDispatchBinding({
            snapshot,
            toolCallId,
            toolName: 'read',
            contractBearing: false
          })
        })
      }

      expectSurfaceError(
        () =>
          registerToolSurfaceDeferredDispatch({
            snapshot,
            toolCallId: 'capacity-overflow',
            toolName: 'read',
            binding: buildToolSurfaceDeferredDispatchBinding({
              snapshot,
              toolCallId: 'capacity-overflow',
              toolName: 'read',
              contractBearing: false
            })
          }),
        'limit_exceeded'
      )
      expect(
        getToolSurfaceDeferredDispatch(
          snapshot.request.sessionId,
          snapshot.request.messageId,
          'capacity-call-0'
        )
      ).not.toBeNull()
    } finally {
      revokeToolSurfaceDeferredDispatchesForSession(snapshot.request.sessionId)
    }
  })

  it('projects bounded catalog, active, budget, and search provenance for Tape', () => {
    const definitions = [agentTool('read'), agentTool('write')]
    const ceiling = buildToolSurfaceRunCeiling(definitions)
    const readEntry = ceiling.catalog.entries.find(
      (entry) => entry.target.providerVisibleName === 'read'
    )!
    const writeEntry = ceiling.catalog.entries.find(
      (entry) => entry.target.providerVisibleName === 'write'
    )!
    const candidate = activationEvidence({
      sessionId: 's1',
      messageId: 'm1',
      runId: 'r1',
      requestSeq: 1,
      stableTargetKey: readEntry.stableTargetKey,
      canonicalToolDefinitionHash: readEntry.canonicalToolDefinitionHash,
      toolCallOrdinalWithinBatch: 0,
      resultRank: 0
    })
    const rejectedCandidate = activationEvidence(
      {
        ...candidate,
        stableTargetKey: writeEntry.stableTargetKey,
        canonicalToolDefinitionHash: writeEntry.canonicalToolDefinitionHash,
        resultRank: 1
      },
      candidate.toolResult
    )
    const snapshot = createToolSurfaceSnapshot({
      request: { sessionId: 's1', messageId: 'm1', runId: 'r1', requestSeq: 2 },
      policyVersion: 'virtual-v1',
      virtualizationTriggered: true,
      ceiling,
      eligibleDefinitions: definitions,
      activationLedger: createToolSurfaceActivationLedger([readEntry]),
      selectionReasons: [
        { stableTargetKey: readEntry.stableTargetKey, reason: 'search-result' }
      ],
      activation: {
        originRequestSeq: 1,
        decisions: [
          { ...candidate, accepted: true },
          {
            ...rejectedCandidate,
            accepted: false,
            rejectionCode: 'per-batch-count-cap'
          }
        ]
      }
    })

    const projection = projectToolSurfaceTapeProvenance(snapshot, false)

    expect(projection.catalog).toMatchObject({
      catalogSchemaVersion: 1,
      canonicalizationVersion: snapshot.canonicalizationVersion,
      fullCatalogHash: snapshot.eligibleCatalog.fullCatalogHash
    })
    expect(projection.catalog.entries).toHaveLength(2)
    expect(projection.surface).toMatchObject({
      request: snapshot.request,
      policyVersion: 'virtual-v1',
      virtualizationTriggered: true,
      contractBearing: false,
      budget: {
        eligibleToolCount: 2,
        activeToolCount: 1,
        eligibleDefinitionTokens: snapshot.eligibleCatalog.definitionTokens,
        activeDefinitionTokens: readEntry.definitionTokens
      }
    })
    expect(projection.surface.activeEntries).toEqual([
      expect.objectContaining({
        stableTargetKey: readEntry.stableTargetKey,
        activationOrdinal: 0,
        reason: 'search-result'
      })
    ])
    expect(projection.surface.searchResultRefs).toEqual([
      expect.objectContaining({
        originRequestSeq: 1,
        stableTargetKey: readEntry.stableTargetKey,
        toolResult: candidate.toolResult
      })
    ])
    expect(projection.surface.candidateRejections).toEqual([
      expect.objectContaining({
        originRequestSeq: 1,
        stableTargetKey: writeEntry.stableTargetKey,
        rejectionCode: 'per-batch-count-cap',
        toolResult: candidate.toolResult
      })
    ])
  })

  it('rejects expansion, definition drift, and an incomplete full surface', () => {
    const read = agentTool('read')
    const write = agentTool('write')
    const ceiling = buildToolSurfaceRunCeiling([read])
    const ledger = createProviderOrderedToolSurfaceActivationLedger([read])
    const request = { sessionId: 's1', messageId: 'm1', runId: 'r1', requestSeq: 1 }

    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          request,
          policyVersion: 'full-v1',
          virtualizationTriggered: false,
          ceiling,
          eligibleDefinitions: [read, write],
          activationLedger: ledger
        }),
      'conflicting_tool'
    )
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          request,
          policyVersion: 'full-v1',
          virtualizationTriggered: false,
          ceiling,
          eligibleDefinitions: [agentTool('read', { function: { ...read.function, description: 'drift' } })],
          activationLedger: ledger
        }),
      'conflicting_tool'
    )
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          request,
          policyVersion: 'full-v1',
          virtualizationTriggered: false,
          ceiling: buildToolSurfaceRunCeiling([read, write]),
          eligibleDefinitions: [read, write],
          activationLedger: ledger
        }),
      'invalid_definition'
    )
  })

  it('rejects mutable ceilings and selection provenance outside the active View', () => {
    const definitions = [agentTool('read'), agentTool('write')]
    const ceiling = buildToolSurfaceRunCeiling(definitions)
    const readEntry = ceiling.catalog.entries.find(
      (entry) => entry.target.providerVisibleName === 'read'
    )!
    const ledger = createToolSurfaceActivationLedger([readEntry])
    const baseInput = {
      request: { sessionId: 's1', messageId: 'm1', runId: 'r1', requestSeq: 1 },
      policyVersion: 'virtual-v1',
      virtualizationTriggered: true,
      ceiling,
      eligibleDefinitions: definitions,
      activationLedger: ledger
    } as const

    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...baseInput,
          ceiling: { catalog: ceiling.catalog, entries: [...ceiling.entries] },
          selectionReasons: [{ stableTargetKey: readEntry.stableTargetKey, reason: 'core' }]
        }),
      'invalid_definition'
    )
    const writeEntry = ceiling.catalog.entries.find(
      (entry) => entry.target.providerVisibleName === 'write'
    )!
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...baseInput,
          selectionReasons: [{ stableTargetKey: writeEntry.stableTargetKey, reason: 'recent' }]
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () => createToolSurfaceSnapshot({ ...baseInput, selectionReasons: [] }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...baseInput,
          virtualizationTriggered: 'yes' as unknown as boolean,
          selectionReasons: [{ stableTargetKey: readEntry.stableTargetKey, reason: 'core' }]
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...baseInput,
          selectionReasons: [
            {
              stableTargetKey: readEntry.stableTargetKey,
              reason: 'unknown' as 'core'
            }
          ]
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...baseInput,
          selectionReasons: [
            { stableTargetKey: readEntry.stableTargetKey, reason: 'tool-search' }
          ]
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...baseInput,
          request: { ...baseInput.request, requestSeq: 2 },
          selectionReasons: [{ stableTargetKey: readEntry.stableTargetKey, reason: 'core' }],
          activation: {
            originRequestSeq: 1,
            decisions: [
              {
                ...baseInput.request,
                stableTargetKey: readEntry.stableTargetKey,
                canonicalToolDefinitionHash: readEntry.canonicalToolDefinitionHash,
                toolCallOrdinalWithinBatch: 0,
                resultRank: 0,
                accepted: true
              }
            ]
          }
        }),
      'invalid_definition'
    )
    const activationBaseInput = {
      ...baseInput,
      request: { ...baseInput.request, requestSeq: 2 },
      selectionReasons: [
        { stableTargetKey: readEntry.stableTargetKey, reason: 'search-result' as const }
      ]
    }
    expectSurfaceError(
      () => createToolSurfaceSnapshot(activationBaseInput),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...activationBaseInput,
          activation: {
            originRequestSeq: 1,
            decisions: [
              {
                ...baseInput.request,
                stableTargetKey: readEntry.stableTargetKey,
                canonicalToolDefinitionHash: readEntry.canonicalToolDefinitionHash,
                toolCallOrdinalWithinBatch: 0,
                resultRank: 0,
                accepted: 'yes' as unknown as boolean
              }
            ]
          }
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...activationBaseInput,
          activation: {
            originRequestSeq: 1,
            decisions: [
              {
                ...baseInput.request,
                stableTargetKey: readEntry.stableTargetKey,
                canonicalToolDefinitionHash: readEntry.canonicalToolDefinitionHash,
                toolCallOrdinalWithinBatch: 0,
                resultRank: 0,
                accepted: false,
                rejectionCode: 'ineligible'
              }
            ]
          }
        }),
      'invalid_definition'
    )
    let decisionGetterReads = 0
    const accessorDecision = {
      ...baseInput.request,
      stableTargetKey: readEntry.stableTargetKey,
      canonicalToolDefinitionHash: readEntry.canonicalToolDefinitionHash,
      toolCallOrdinalWithinBatch: 0,
      resultRank: 0
    } as ToolSurfaceActivationCandidate & { accepted: boolean }
    Object.defineProperty(accessorDecision, 'accepted', {
      enumerable: true,
      get: () => {
        decisionGetterReads += 1
        return true
      }
    })
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...activationBaseInput,
          activation: { originRequestSeq: 1, decisions: [accessorDecision] }
        }),
      'invalid_definition'
    )
    expect(decisionGetterReads).toBe(0)
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...activationBaseInput,
          activation: {
            originRequestSeq: 1,
            decisions: [
              {
                ...baseInput.request,
                stableTargetKey: writeEntry.stableTargetKey,
                canonicalToolDefinitionHash: writeEntry.canonicalToolDefinitionHash,
                toolCallOrdinalWithinBatch: 0,
                resultRank: 1,
                accepted: false,
                rejectionCode: 'ineligible'
              },
              {
                ...baseInput.request,
                stableTargetKey: readEntry.stableTargetKey,
                canonicalToolDefinitionHash: readEntry.canonicalToolDefinitionHash,
                toolCallOrdinalWithinBatch: 0,
                resultRank: 0,
                accepted: true
              }
            ]
          }
        }),
      'invalid_definition'
    )
    const proxyActivation = new Proxy(
      { originRequestSeq: 1, decisions: [] },
      {
        get: (target, property, receiver) => {
          decisionGetterReads += 1
          return Reflect.get(target, property, receiver)
        }
      }
    )
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...activationBaseInput,
          activation: proxyActivation
        }),
      'invalid_definition'
    )
    expect(decisionGetterReads).toBe(0)
  })

  it('rejects malformed runtime shapes and frozen structural ceiling forgeries', () => {
    const read = agentTool('read')
    const ceiling = buildToolSurfaceRunCeiling([read])
    const ledger = createProviderOrderedToolSurfaceActivationLedger([read])
    const validInput = {
      request: { sessionId: 's1', messageId: 'm1', runId: 'r1', requestSeq: 1 },
      policyVersion: 'full-v1',
      virtualizationTriggered: false,
      ceiling,
      eligibleDefinitions: [read],
      activationLedger: ledger
    }
    const cyclicForgery: Record<string, unknown> = {
      catalog: ceiling.catalog,
      entries: ceiling.entries
    }
    cyclicForgery.self = cyclicForgery
    Object.freeze(cyclicForgery)

    expectSurfaceError(
      () => createToolSurfaceSnapshot(undefined as never),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...validInput,
          request: { ...validInput.request, sessionId: 42 as unknown as string }
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...validInput,
          selectionReasons: {} as never
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createToolSurfaceSnapshot({
          ...validInput,
          ceiling: cyclicForgery as unknown as typeof ceiling
        }),
      'invalid_definition'
    )
  })
})

describe('Tool Surface activation candidate merge', () => {
  it('orders by request, batch ordinal, result rank, and stable target before deduplication', () => {
    const merged = mergeToolSurfaceActivationCandidates(candidateScope, [
      [
        activationCandidate('target-b', { toolCallOrdinalWithinBatch: 1 }),
        activationCandidate('target-z', { requestSeq: 2 }),
        activationCandidate('target-a', { resultRank: 1 })
      ],
      [
        activationCandidate('target-c'),
        activationCandidate('target-c', {
          requestSeq: 2,
          toolCallOrdinalWithinBatch: 99,
          resultRank: 99
        })
      ]
    ])

    expect(merged.map((candidate) => candidate.stableTargetKey)).toEqual([
      'target-c',
      'target-a',
      'target-b',
      'target-z'
    ])
    expect(
      appendToolSurfaceActivationBatch(createToolSurfaceActivationLedger([]), merged).entries.map(
        (entry) => entry.stableTargetKey
      )
    ).toEqual(['target-c', 'target-a', 'target-b', 'target-z'])
    expect(merged.find((candidate) => candidate.stableTargetKey === 'target-c')).toMatchObject({
      requestSeq: 1,
      toolCallOrdinalWithinBatch: 0,
      resultRank: 0
    })
    expect(
      mergeToolSurfaceActivationCandidates(candidateScope, [
        [activationCandidate('target-c')],
        [
          activationCandidate('target-b', { toolCallOrdinalWithinBatch: 1 }),
          activationCandidate('target-a', { resultRank: 1 })
        ],
        [activationCandidate('target-z', { requestSeq: 2 })]
      ])
    ).toEqual(merged)
    expect(Object.isFrozen(merged)).toBe(true)
    expect(merged.every((candidate) => Object.isFrozen(candidate))).toBe(true)
  })

  it('uses stable target order rather than opaque operation identity for exact ties', () => {
    const merged = mergeToolSurfaceActivationCandidates(candidateScope, [
      [activationCandidate('target-z'), activationCandidate('target-a')]
    ])

    expect(merged.map((candidate) => candidate.stableTargetKey)).toEqual([
      'target-a',
      'target-z'
    ])
  })

  it('retains the earliest durable ToolSearch result reference and rejects conflicting receipts', () => {
    const earliest = activationEvidence(activationCandidate('target-a'))
    const later = activationEvidence(
      activationCandidate('target-a', { toolCallOrdinalWithinBatch: 1 }),
      { ...earliest.toolResult, entryId: earliest.toolResult.entryId + 1 }
    )

    expect(mergeToolSurfaceActivationEvidence(candidateScope, [[later, earliest]])).toEqual([
      earliest
    ])
    expectSurfaceError(
      () =>
        mergeToolSurfaceActivationEvidence(candidateScope, [
          [
            earliest,
            {
              ...earliest,
              toolResult: { ...earliest.toolResult, payloadHash: 'e'.repeat(64) }
            }
          ]
        ]),
      'conflicting_tool'
    )
    expectSurfaceError(
      () =>
        mergeToolSurfaceActivationEvidence(candidateScope, [
          [
            earliest,
            activationEvidence(activationCandidate('target-b'), {
              ...earliest.toolResult,
              tapeIncarnationId: '00000000-0000-4000-8000-000000000002'
            })
          ]
        ]),
      'conflicting_tool'
    )
    expectSurfaceError(
      () =>
        mergeToolSurfaceActivationEvidence(candidateScope, [
          [
            earliest,
            activationEvidence(
              activationCandidate('target-b', { resultRank: 1 }),
              { ...earliest.toolResult, entryId: earliest.toolResult.entryId + 1 }
            )
          ]
        ]),
      'conflicting_tool'
    )
    expectSurfaceError(
      () =>
        mergeToolSurfaceActivationEvidence(candidateScope, [
          [
            earliest,
            activationEvidence(
              activationCandidate('target-b', { toolCallOrdinalWithinBatch: 1 }),
              earliest.toolResult
            )
          ]
        ]),
      'conflicting_tool'
    )

    let propertyReads = 0
    const proxiedToolResult = new Proxy(earliest.toolResult, {
      get: (target, property, receiver) => {
        propertyReads += 1
        return Reflect.get(target, property, receiver)
      }
    })
    expectSurfaceError(
      () =>
        mergeToolSurfaceActivationEvidence(candidateScope, [
          [{ ...earliest, toolResult: proxiedToolResult }]
        ]),
      'invalid_definition'
    )
    expect(propertyReads).toBe(0)
  })

  it('does not retain unbounded search or provider metadata', () => {
    const candidate = {
      ...activationCandidate('target-a'),
      query: 'sensitive raw query',
      toolCallId: 'opaque-provider-id',
      resultBody: { unbounded: true }
    } as ToolSurfaceActivationCandidate

    expect(mergeToolSurfaceActivationCandidates(candidateScope, [[candidate]])).toEqual([
      activationCandidate('target-a')
    ])
  })

  it('rejects accessor and Proxy candidates without executing user code', () => {
    let propertyReads = 0
    const accessorCandidate = activationCandidate('target-a')
    Object.defineProperty(accessorCandidate, 'stableTargetKey', {
      enumerable: true,
      get: () => {
        propertyReads += 1
        return 'target-a'
      }
    })
    const proxyCandidate = new Proxy(activationCandidate('target-b'), {
      get: (target, property, receiver) => {
        propertyReads += 1
        return Reflect.get(target, property, receiver)
      }
    })

    expectSurfaceError(
      () => mergeToolSurfaceActivationCandidates(candidateScope, [[accessorCandidate]]),
      'invalid_definition'
    )
    expectSurfaceError(
      () => mergeToolSurfaceActivationCandidates(candidateScope, [[proxyCandidate]]),
      'invalid_definition'
    )
    expect(propertyReads).toBe(0)
  })

  it('rejects mixed scopes, invalid ordinals, and conflicting definition identities', () => {
    expectSurfaceError(
      () =>
        mergeToolSurfaceActivationCandidates(candidateScope, [
          [activationCandidate('target-a', { runId: 'another-run' })]
        ]),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        mergeToolSurfaceActivationCandidates(candidateScope, [
          [activationCandidate('target-a', { toolCallOrdinalWithinBatch: -1 })]
        ]),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        mergeToolSurfaceActivationCandidates(candidateScope, [
          [
            activationCandidate('target-a'),
            activationCandidate('target-a', { canonicalToolDefinitionHash: 'b'.repeat(64) })
          ]
        ]),
      'conflicting_tool'
    )
  })

  it('bounds candidate batches and aggregate candidate work', () => {
    expect(
      mergeToolSurfaceActivationCandidates(candidateScope, [
        Array.from({ length: MAX_TOOL_SURFACE_ACTIVATION_CANDIDATES }, () =>
          activationCandidate('target-a')
        )
      ])
    ).toHaveLength(1)
    expectSurfaceError(
      () =>
        mergeToolSurfaceActivationCandidates(
          candidateScope,
          Array.from({ length: MAX_TOOL_SURFACE_CANDIDATE_BATCHES + 1 }, () => [])
        ),
      'limit_exceeded'
    )
    expectSurfaceError(
      () =>
        mergeToolSurfaceActivationCandidates(candidateScope, [
          Array.from({ length: MAX_TOOL_SURFACE_ACTIVATION_CANDIDATES + 1 }, (_, index) =>
            activationCandidate(`target-${index}`)
          )
        ]),
      'limit_exceeded'
    )
  })
})

describe('Tool Surface shadow selection', () => {
  it('keeps a small catalog fully active without adding ToolSearch', () => {
    const catalog = buildCanonicalToolCatalog([agentTool('read'), agentTool('write')])

    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog: catalog,
      eligibleCatalog: catalog,
      policy: SHADOW_POLICY
    })

    expect(decision).toMatchObject({
      virtualizationTriggered: false,
      triggerReason: 'none',
      ceilingToolCount: 2,
      eligibleToolCount: 2,
      hypotheticalActiveToolCount: 2,
      estimatedNetInputTokenReduction: 0,
      toolSearchIncluded: false,
      initialBudgetFits: true,
      degradationCodes: []
    })
    expect(decision.selectedEntries.every((entry) => entry.reason === 'full-catalog')).toBe(true)
    expect(Object.isFrozen(decision)).toBe(true)
    expect(Object.isFrozen(decision.selectedEntries)).toBe(true)
  })

  it('reports an unavailable mandatory target even when virtualization is not triggered', () => {
    const catalog = buildCanonicalToolCatalog([agentTool('read')])

    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog: catalog,
      eligibleCatalog: catalog,
      policy: SHADOW_POLICY,
      activeSkillRequiredStableTargetKeys: ['missing-target']
    })

    expect(decision.virtualizationTriggered).toBe(false)
    expect(decision.initialBudgetFits).toBe(false)
    expect(decision.degradationCodes).toEqual(['mandatory-target-missing'])
  })

  it('triggers from the Run ceiling but selects only from current eligibility', () => {
    const definitions = [
      agentTool('alpha'),
      agentTool('beta'),
      agentTool('gamma'),
      agentTool('delta')
    ]
    const ceilingCatalog = buildCanonicalToolCatalog(definitions)
    const eligibleCatalog = buildCanonicalToolCatalog([definitions[0]])

    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog,
      eligibleCatalog,
      policy: SHADOW_POLICY,
      coreStableTargetKeys: [eligibleCatalog.entries[0].stableTargetKey]
    })

    expect(decision).toMatchObject({
      virtualizationTriggered: true,
      triggerReason: 'tool-count',
      ceilingToolCount: 4,
      eligibleToolCount: 1,
      hypotheticalActiveToolCount: 2
    })
    expect(decision.selectedEntries.map((entry) => entry.stableTargetKey)).toEqual([
      eligibleCatalog.entries[0].stableTargetKey
    ])
  })

  it('orders policy, core, active Skill, and definition-bound recent selections', () => {
    const catalog = buildCanonicalToolCatalog([
      agentTool('recent'),
      agentTool('skill_required'),
      agentTool('core'),
      agentTool('policy_required')
    ])
    const byName = new Map(
      catalog.entries.map((entry) => [entry.target.providerVisibleName, entry])
    )

    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog: catalog,
      eligibleCatalog: catalog,
      policy: {
        ...SHADOW_POLICY,
        maxInitialToolCount: 6,
        activationReserveToolCount: 1
      },
      policyRequiredStableTargetKeys: [byName.get('policy_required')!.stableTargetKey],
      coreStableTargetKeys: [byName.get('core')!.stableTargetKey],
      activeSkillRequiredStableTargetKeys: [byName.get('skill_required')!.stableTargetKey],
      recentHints: [
        {
          stableTargetKey: byName.get('recent')!.stableTargetKey,
          canonicalToolDefinitionHash: byName.get('recent')!.canonicalToolDefinitionHash
        }
      ]
    })

    expect(decision).toMatchObject({
      virtualizationTriggered: true,
      triggerReason: 'tool-count',
      hypotheticalActiveToolCount: 5,
      toolSearchIncluded: true,
      initialBudgetFits: true,
      degradationCodes: []
    })
    expect(decision.selectedEntries.map((entry) => entry.reason)).toEqual([
      'policy-required',
      'core',
      'active-skill',
      'recent'
    ])
    expect(decision.eligibleDefinitionTokens - decision.hypotheticalActiveDefinitionTokens).toBe(
      decision.estimatedNetInputTokenReduction + SHADOW_POLICY.toolSearchPromptTokens
    )
  })

  it('accounts for ToolSearch overhead at threshold boundaries', () => {
    const catalog = buildCanonicalToolCatalog([agentTool('read')])
    const policy = {
      ...SHADOW_POLICY,
      enterToolCount: 1,
      exitToolCount: 0,
      enterEstimatedInputTokens: Number.MAX_SAFE_INTEGER,
      exitEstimatedInputTokens: Number.MAX_SAFE_INTEGER - 1
    }

    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog: catalog,
      eligibleCatalog: catalog,
      policy
    })

    expect(decision.virtualizationTriggered).toBe(true)
    expect(decision.triggerReason).toBe('tool-count')
  })

  it('holds the virtualized mode inside the cross-Run exit band', () => {
    const catalog = buildCanonicalToolCatalog([agentTool('read'), agentTool('write')])

    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog: catalog,
      eligibleCatalog: catalog,
      policy: { ...SHADOW_POLICY, enterToolCount: 10, exitToolCount: 2 },
      previouslyVirtualized: true
    })

    expect(decision.virtualizationTriggered).toBe(true)
    expect(decision.triggerReason).toBe('hysteresis')
  })

  it('reports missing or over-budget mandatory targets without silently dropping them', () => {
    const catalog = buildCanonicalToolCatalog([agentTool('skill_required')])
    const mandatoryKey = catalog.entries[0].stableTargetKey

    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog: catalog,
      eligibleCatalog: catalog,
      policy: {
        ...SHADOW_POLICY,
        enterToolCount: 1,
        exitToolCount: 0,
        maxInitialToolCount: 2,
        activationReserveToolCount: 0,
        activationReserveDefinitionTokens: 0,
        maxInitialDefinitionTokens: SHADOW_POLICY.toolSearchDefinitionTokens
      },
      activeSkillRequiredStableTargetKeys: [mandatoryKey, 'missing-target']
    })

    expect(decision.initialBudgetFits).toBe(false)
    expect(decision.selectedEntries).toEqual([
      expect.objectContaining({ stableTargetKey: mandatoryKey, reason: 'active-skill' })
    ])
    expect(decision.degradationCodes).toEqual([
      'mandatory-budget-exceeded',
      'mandatory-target-missing'
    ])
  })

  it('fails open to a full hypothetical surface when shadow policy is invalid', () => {
    const catalog = buildCanonicalToolCatalog([agentTool('read'), agentTool('write')])

    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog: catalog,
      eligibleCatalog: catalog,
      policy: { ...SHADOW_POLICY, exitToolCount: SHADOW_POLICY.enterToolCount }
    })

    expect(decision).toMatchObject({
      virtualizationTriggered: false,
      toolSearchIncluded: false,
      initialBudgetFits: false,
      degradationCodes: ['invalid-policy']
    })
    expect(decision.selectedEntries).toHaveLength(2)
  })

  it.each([
    {
      name: 'ToolSearch plus count reserve',
      policy: { ...SHADOW_POLICY, maxInitialToolCount: 1, activationReserveToolCount: 1 }
    },
    {
      name: 'ToolSearch plus token reserve',
      policy: {
        ...SHADOW_POLICY,
        maxInitialDefinitionTokens: 100,
        toolSearchDefinitionTokens: 50,
        activationReserveDefinitionTokens: 51
      }
    },
    {
      name: 'safe-integer overflow',
      policy: {
        ...SHADOW_POLICY,
        maxInitialDefinitionTokens: Number.MAX_SAFE_INTEGER,
        toolSearchDefinitionTokens: Number.MAX_SAFE_INTEGER,
        activationReserveDefinitionTokens: 1
      }
    },
    {
      name: 'activation batch registry overflow',
      policy: {
        ...SHADOW_POLICY,
        maxActivationBatchesPerRun: MAX_TOOL_SURFACE_CANDIDATE_BATCHES + 1
      }
    }
  ])('rejects an impossible $name policy', ({ policy }) => {
    const catalog = buildCanonicalToolCatalog([agentTool('read')])

    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog: catalog,
      eligibleCatalog: catalog,
      policy
    })

    expect(decision.degradationCodes).toEqual(['invalid-policy'])
    expect(decision.initialBudgetFits).toBe(false)
  })

  it('does not carry a recent hint across definition drift', () => {
    const priorCatalog = buildCanonicalToolCatalog([agentTool('recent')])
    const currentCatalog = buildCanonicalToolCatalog([
      agentTool('recent', {
        function: {
          name: 'recent',
          description: 'Definition changed',
          parameters: { type: 'object', properties: {} }
        }
      })
    ])
    const prior = priorCatalog.entries[0]

    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog: currentCatalog,
      eligibleCatalog: currentCatalog,
      policy: { ...SHADOW_POLICY, enterToolCount: 1, exitToolCount: 0 },
      recentHints: [
        {
          stableTargetKey: prior.stableTargetKey,
          canonicalToolDefinitionHash: prior.canonicalToolDefinitionHash
        }
      ]
    })

    expect(decision.selectedEntries).toEqual([])
    expect(decision.hypotheticalActiveToolCount).toBe(1)
  })

  it('preserves newest-first recent hint priority when the initial budget is constrained', () => {
    const catalog = buildCanonicalToolCatalog([
      agentTool('alphabetically_first'),
      agentTool('newest')
    ])
    const byName = new Map(
      catalog.entries.map((entry) => [entry.target.providerVisibleName, entry])
    )

    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog: catalog,
      eligibleCatalog: catalog,
      policy: {
        ...SHADOW_POLICY,
        enterToolCount: 1,
        exitToolCount: 0,
        maxInitialToolCount: 2,
        activationReserveToolCount: 0,
        maxInitialDefinitionTokens: 10_000,
        activationReserveDefinitionTokens: 0
      },
      recentHints: [
        {
          stableTargetKey: byName.get('newest')!.stableTargetKey,
          canonicalToolDefinitionHash: byName.get('newest')!.canonicalToolDefinitionHash
        },
        {
          stableTargetKey: byName.get('alphabetically_first')!.stableTargetKey,
          canonicalToolDefinitionHash:
            byName.get('alphabetically_first')!.canonicalToolDefinitionHash
        }
      ]
    })

    expect(decision.selectedEntries).toEqual([
      expect.objectContaining({
        stableTargetKey: byName.get('newest')!.stableTargetKey,
        reason: 'recent'
      })
    ])
  })

  it('fails open when current eligibility is not a definition-bound ceiling subset', () => {
    const ceilingCatalog = buildCanonicalToolCatalog([agentTool('read')])
    const eligibleCatalog = buildCanonicalToolCatalog([agentTool('write')])

    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog,
      eligibleCatalog,
      policy: SHADOW_POLICY
    })

    expect(decision.degradationCodes).toEqual(['eligible-catalog-invalid'])
    expect(decision.virtualizationTriggered).toBe(false)
    expect(decision.selectedEntries[0].stableTargetKey).toBe(
      eligibleCatalog.entries[0].stableTargetKey
    )
  })

  it('reports a signed estimate when ToolSearch overhead exceeds schema reduction', () => {
    const catalog = buildCanonicalToolCatalog([agentTool('read')])

    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog: catalog,
      eligibleCatalog: catalog,
      policy: { ...SHADOW_POLICY, enterToolCount: 1, exitToolCount: 0 }
    })

    expect(decision.estimatedNetInputTokenReduction).toBeLessThan(0)
    expect(decision.hypotheticalAdditionalPromptTokens).toBe(SHADOW_POLICY.toolSearchPromptTokens)
  })

  it('computes bounded overlap from definition-bound identities', () => {
    expect(
      computeToolSurfaceStaticDefinitionOverlap(
        [
          { stableTargetKey: 'a', canonicalToolDefinitionHash: '1' },
          { stableTargetKey: 'a', canonicalToolDefinitionHash: '1' },
          { stableTargetKey: 'b', canonicalToolDefinitionHash: '1' }
        ],
        [
          { stableTargetKey: 'b', canonicalToolDefinitionHash: '2' },
          { stableTargetKey: 'c', canonicalToolDefinitionHash: '1' }
        ]
      )
    ).toEqual({
      previousCount: 2,
      currentCount: 2,
      retainedCount: 0,
      unionCount: 4,
      jaccardRatio: 0
    })
    expect(computeToolSurfaceStaticDefinitionOverlap([], []).jaccardRatio).toBe(1)
  })

  it('bounds selection hints and overlap work', () => {
    const catalog = buildCanonicalToolCatalog([
      agentTool('alpha'),
      agentTool('beta'),
      agentTool('gamma'),
      agentTool('delta')
    ])
    const decision = computeToolSurfaceShadowDecision({
      ceilingCatalog: catalog,
      eligibleCatalog: catalog,
      policy: SHADOW_POLICY,
      coreStableTargetKeys: Array.from(
        { length: MAX_TOOL_SURFACE_SELECTION_HINTS + 1 },
        (_, index) => String(index)
      )
    })

    expect(decision.degradationCodes).toEqual(['selection-input-limit-exceeded'])
    expect(
      computeToolSurfaceShadowDecision({
        ceilingCatalog: catalog,
        eligibleCatalog: catalog,
        policy: SHADOW_POLICY,
        coreStableTargetKeys: ['x'.repeat(MAX_TOOL_SURFACE_DEFINITION_BYTES + 1)]
      }).degradationCodes
    ).toEqual(['selection-input-limit-exceeded'])
    expectSurfaceError(
      () =>
        computeToolSurfaceStaticDefinitionOverlap(
          Array.from({ length: MAX_TOOL_SURFACE_OVERLAP_IDENTITIES + 1 }, (_, index) => ({
            stableTargetKey: String(index),
            canonicalToolDefinitionHash: 'hash'
          })),
          []
        ),
      'limit_exceeded'
    )
  })
})

describe('Tool Surface production selection', () => {
  const productionPolicy: ToolSurfaceShadowPolicy = {
    ...SHADOW_POLICY,
    policyVersion: 'canary-test-v1',
    toolSearchDefinitionTokens: 1_000
  }
  const request = (requestSeq: number) => ({
    sessionId: 's1',
    messageId: 'm1',
    runId: 'r1',
    requestSeq
  })
  const createActivationHarness = (
    hiddenNames: readonly string[],
    policyOverrides: Partial<ToolSurfaceShadowPolicy> = {}
  ) => {
    const definitions = [agentTool('core'), ...hiddenNames.map((name) => agentTool(name))]
    const catalog = buildCanonicalToolCatalog(definitions)
    const byName = new Map(
      catalog.entries.map((entry) => [entry.target.providerVisibleName, entry])
    )
    const selected = createPolicySelectedToolSurfaceRun({
      ceilingDefinitions: definitions,
      initialEligibleDefinitions: definitions,
      toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME),
      policy: {
        ...productionPolicy,
        enterToolCount: 1,
        exitToolCount: 0,
        maxInitialToolCount: 8,
        ...policyOverrides
      },
      coreStableTargetKeys: [byName.get('core')!.stableTargetKey]
    })
    const build = (requestSeq: number, eligibleDefinitions = definitions) =>
      selected.controller.build({
        request: request(requestSeq),
        eligibleDefinitions,
        toolSearchAvailable: true
      })
    const candidate = (
      name: string,
      originRequestSeq: number,
      toolCallOrdinalWithinBatch = 0,
      resultRank = 0
    ): ToolSurfaceActivationEvidence => {
      const entry = byName.get(name)!
      return activationEvidence({
        ...request(originRequestSeq),
        ...definitionIdentity(entry.stableTargetKey, entry.canonicalToolDefinitionHash),
        toolCallOrdinalWithinBatch,
        resultRank
      })
    }
    const initial = build(1)
    selected.controller.admit(initial)
    return { definitions, byName, selected, build, candidate, initial }
  }

  it('keeps a small catalog fully active without adding ToolSearch', () => {
    const read = agentTool('read')
    const write = agentTool('write')
    const selected = createPolicySelectedToolSurfaceRun({
      ceilingDefinitions: [read, write],
      initialEligibleDefinitions: [write, read],
      toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME),
      policy: productionPolicy
    })
    const snapshot = selected.controller.build({
      request: request(1),
      eligibleDefinitions: [write, read]
    })

    expect(selected.decision.virtualizationTriggered).toBe(false)
    expect(selected.controller.virtualizationTriggered).toBe(false)
    expect(snapshot.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'write',
      'read'
    ])
    expect(snapshot.eligibleCatalog.entries).toHaveLength(2)
  })

  it('selects a bounded initial surface and adds ToolSearch only above the threshold', () => {
    const definitions = ['policy', 'skill', 'core', 'recent', 'hidden'].map((name) =>
      agentTool(name)
    )
    const catalog = buildCanonicalToolCatalog(definitions)
    const byName = new Map(
      catalog.entries.map((entry) => [entry.target.providerVisibleName, entry])
    )
    const selected = createPolicySelectedToolSurfaceRun({
      ceilingDefinitions: definitions,
      initialEligibleDefinitions: definitions,
      toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME),
      policy: { ...productionPolicy, maxInitialToolCount: 6 },
      policyRequiredStableTargetKeys: [byName.get('policy')!.stableTargetKey],
      activeSkillRequiredStableTargetKeys: [byName.get('skill')!.stableTargetKey],
      coreStableTargetKeys: [byName.get('core')!.stableTargetKey],
      recentHints: [byName.get('recent')!]
    })
    const snapshot = selected.controller.build({
      request: request(1),
      eligibleDefinitions: definitions,
      toolSearchAvailable: true
    })

    expect(selected.decision.virtualizationTriggered).toBe(true)
    expect(selected.controller.virtualizationTriggered).toBe(true)
    expect(snapshot.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'policy',
      'core',
      'skill',
      'recent',
      TOOL_SEARCH_AGENT_TOOL_NAME
    ])
    expect(snapshot.activeEntries.map((entry) => entry.reason)).toEqual([
      'policy-required',
      'core',
      'active-skill',
      'recent',
      'tool-search'
    ])
    expect(snapshot.toolDefinitions.some((definition) => definition.function.name === 'hidden')).toBe(
      false
    )
  })

  it('fails closed instead of restoring a large full catalog when mandatory selection cannot fit', () => {
    const definitions = [agentTool('required'), agentTool('hidden')]
    const catalog = buildCanonicalToolCatalog(definitions)

    expectSurfaceError(
      () =>
        createPolicySelectedToolSurfaceRun({
          ceilingDefinitions: definitions,
          initialEligibleDefinitions: definitions,
          toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME),
          policy: {
            ...productionPolicy,
            enterToolCount: 1,
            exitToolCount: 0,
            maxInitialToolCount: 1,
            activationReserveToolCount: 0
          },
          activeSkillRequiredStableTargetKeys: [catalog.entries[0].stableTargetKey]
        }),
      'limit_exceeded'
    )

    expectSurfaceError(
      () =>
        createPolicySelectedToolSurfaceRun({
          ceilingDefinitions: definitions,
          initialEligibleDefinitions: definitions,
          toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME),
          policy: {
            ...productionPolicy,
            enterToolCount: 1,
            exitToolCount: 0,
            maxInitialDefinitionTokens: productionPolicy.toolSearchDefinitionTokens,
            activationReserveDefinitionTokens: 0
          },
          activeSkillRequiredStableTargetKeys: [catalog.entries[0].stableTargetKey]
        }),
      'limit_exceeded'
    )
  })

  it('fails closed when the policy underestimates the real ToolSearch definition', () => {
    const definitions = [agentTool('read'), agentTool('write')]

    expectSurfaceError(
      () =>
        createPolicySelectedToolSurfaceRun({
          ceilingDefinitions: definitions,
          initialEligibleDefinitions: definitions,
          toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME),
          policy: {
            ...productionPolicy,
            enterToolCount: 1,
            exitToolCount: 0,
            toolSearchDefinitionTokens: 1
          }
        }),
      'invalid_definition'
    )
  })

  it('rejects definitions that impersonate the reserved ToolSearch capability', () => {
    const definitions = [agentTool('read'), agentTool('write')]
    const policy = { ...productionPolicy, enterToolCount: 1, exitToolCount: 0 }

    expectSurfaceError(
      () =>
        createPolicySelectedToolSurfaceRun({
          ceilingDefinitions: definitions,
          initialEligibleDefinitions: definitions,
          toolSearchDefinition: agentTool('not_tool_search'),
          policy
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createPolicySelectedToolSurfaceRun({
          ceilingDefinitions: definitions,
          initialEligibleDefinitions: definitions,
          toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME, {
            server: {
              name: 'agent-tools',
              icons: '',
              description: 'Wrong ToolSearch owner'
            }
          }),
          policy
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createPolicySelectedToolSurfaceRun({
          ceilingDefinitions: definitions,
          initialEligibleDefinitions: definitions,
          toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME, {
            server: {
              name: TOOL_SEARCH_AGENT_TOOL_SERVER_NAME,
              icons: '',
              description: 'Bound ToolSearch impostor',
              id: SERVER_ID,
              configGeneration: 1,
              bindingHash: BINDING_HASH
            }
          }),
          policy
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createPolicySelectedToolSurfaceRun({
          ceilingDefinitions: definitions,
          initialEligibleDefinitions: definitions,
          toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME, {
            execution: TOOL_EXECUTION.read.sequential
          }),
          policy
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createPolicySelectedToolSurfaceRun({
          ceilingDefinitions: definitions,
          initialEligibleDefinitions: definitions,
          toolSearchDefinition: mcpTool(TOOL_SEARCH_AGENT_TOOL_NAME),
          policy
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        createPolicySelectedToolSurfaceRun({
          ceilingDefinitions: definitions,
          initialEligibleDefinitions: definitions,
          toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME, {
            execution: TOOL_EXECUTION.write
          }),
          policy
        }),
      'invalid_definition'
    )
  })

  it('uses the frozen Run-owned ToolSearch definition and requires current authority', () => {
    const definitions = [agentTool('read'), agentTool('write')]
    const toolSearchDefinition = agentTool(TOOL_SEARCH_AGENT_TOOL_NAME)
    const selected = createPolicySelectedToolSurfaceRun({
      ceilingDefinitions: definitions,
      initialEligibleDefinitions: definitions,
      toolSearchDefinition,
      policy: { ...productionPolicy, enterToolCount: 1, exitToolCount: 0 }
    })
    toolSearchDefinition.function.description = 'mutated after Run creation'

    expectSurfaceError(
      () =>
        selected.controller.build({
          request: request(1),
          eligibleDefinitions: definitions,
          toolSearchAvailable: false
        }),
      'invalid_definition'
    )
    const snapshot = selected.controller.build({
      request: request(2),
      eligibleDefinitions: definitions,
      toolSearchAvailable: true
    })
    expect(
      snapshot.toolDefinitions.find(
        (definition) => definition.function.name === TOOL_SEARCH_AGENT_TOOL_NAME
      )?.function.description
    ).toBe(`${TOOL_SEARCH_AGENT_TOOL_NAME} description`)
  })

  it('preserves activation order across revocation and rejects stale competing admission', () => {
    const read = agentTool('read')
    const write = agentTool('write')
    const catalog = buildCanonicalToolCatalog([read, write])
    const readKey = catalog.entries.find(
      (entry) => entry.target.providerVisibleName === 'read'
    )!.stableTargetKey
    const selected = createPolicySelectedToolSurfaceRun({
      ceilingDefinitions: [read, write],
      initialEligibleDefinitions: [read, write],
      toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME),
      policy: { ...productionPolicy, enterToolCount: 1, exitToolCount: 0 },
      coreStableTargetKeys: [readKey]
    })
    const build = (requestSeq: number, eligibleDefinitions: MCPToolDefinition[]) =>
      selected.controller.build({
        request: request(requestSeq),
        eligibleDefinitions,
        toolSearchAvailable: true
      })
    const first = build(1, [read, write])
    const competing = build(2, [read, write])

    selected.controller.admit(first)
    expectSurfaceError(() => selected.controller.admit(competing), 'conflicting_tool')
    const revoked = build(3, [write])
    selected.controller.admit(revoked)
    const restored = build(4, [read, write])

    expect(revoked.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      TOOL_SEARCH_AGENT_TOOL_NAME
    ])
    expect(restored.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'read',
      TOOL_SEARCH_AGENT_TOOL_NAME
    ])
    expect(restored.activeEntries.map((entry) => entry.activationOrdinal)).toEqual([0, 1])
  })

  it('prepares Skill-required tools without mutation and appends them only when applied', () => {
    const harness = createActivationHarness(['skill_required', 'outside'])
    const required = harness.byName.get('skill_required')!
    const prepare = harness.selected.controller.prepareSkillActivation!

    const preparation = prepare({
      requiredStableTargetKeys: [required.stableTargetKey],
      eligibleDefinitions: [...harness.definitions, agentTool('new_after_run')]
    })

    expect(preparation.kind).toBe('prepared')
    if (preparation.kind !== 'prepared') throw new Error('Expected prepared Skill activation.')
    expect(Object.isFrozen(preparation)).toBe(true)
    expect(Object.isFrozen(preparation.eligibleDefinitions)).toBe(true)
    expect(Object.isFrozen(preparation.providerActiveDefinitions)).toBe(true)
    expect(
      preparation.eligibleDefinitions.map((definition) => definition.function.name)
    ).not.toContain('new_after_run')
    expect(
      preparation.providerActiveDefinitions.map((definition) => definition.function.name)
    ).toEqual(['core', TOOL_SEARCH_AGENT_TOOL_NAME, 'skill_required'])
    expect(harness.build(2).toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'core',
      TOOL_SEARCH_AGENT_TOOL_NAME
    ])

    preparation.apply()
    preparation.apply()
    const activated = harness.build(3, [...preparation.eligibleDefinitions])
    expect(activated.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'core',
      TOOL_SEARCH_AGENT_TOOL_NAME,
      'skill_required'
    ])
    expect(
      activated.activeEntries.find(
        (entry) => entry.definition.function.name === 'skill_required'
      )
    ).toMatchObject({ reason: 'active-skill', activationOrdinal: 2 })
  })

  it('omits a search candidate when the same batch activates it through a Skill', () => {
    const harness = createActivationHarness(['shared'])
    const shared = harness.byName.get('shared')!
    const candidate = harness.candidate('shared', 1)
    const preparation = harness.selected.controller.prepareSkillActivation!({
      requiredStableTargetKeys: [shared.stableTargetKey],
      eligibleDefinitions: harness.definitions
    })
    expect(preparation.kind).toBe('prepared')
    if (preparation.kind !== 'prepared') throw new Error('Expected prepared Skill activation.')

    preparation.apply()
    expect(() =>
      harness.selected.controller.stageActivationBatch([candidate])
    ).not.toThrow()
    const nextView = harness.build(2)

    expect(nextView.activation.decisions).toEqual([])
    expect(
      nextView.activeEntries.find((entry) => entry.definition.function.name === 'shared')
    ).toMatchObject({ reason: 'active-skill' })
    const projection = projectToolSurfaceTapeProvenance(nextView, false)
    expect(projection.surface.candidateRejections).toEqual([])
    expect(() =>
      createTapeToolSurfaceFact({
        ...projection.surface,
        manifestHash: 'd'.repeat(64),
        catalog: {
          sessionId: 's1',
          tapeIncarnationId: candidate.toolResult.tapeIncarnationId,
          entryId: 1,
          fullCatalogHash: projection.catalog.fullCatalogHash,
          catalogFactHash: 'e'.repeat(64)
        }
      })
    ).not.toThrow()
  })

  it('rejects Skill activation before the originating View is admitted', () => {
    const definitions = [agentTool('core'), agentTool('skill_required')]
    const catalog = buildCanonicalToolCatalog(definitions)
    const required = catalog.entries.find(
      (entry) => entry.target.providerVisibleName === 'skill_required'
    )!
    const selected = createPolicySelectedToolSurfaceRun({
      ceilingDefinitions: definitions,
      initialEligibleDefinitions: definitions,
      toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME),
      policy: { ...productionPolicy, enterToolCount: 1, exitToolCount: 0 },
      coreStableTargetKeys: [
        catalog.entries.find((entry) => entry.target.providerVisibleName === 'core')!.stableTargetKey
      ]
    })

    expect(
      selected.controller.prepareSkillActivation?.({
        requiredStableTargetKeys: [required.stableTargetKey],
        eligibleDefinitions: definitions
      })
    ).toEqual({ kind: 'rejected', rejectionCode: 'required-target-unavailable' })
  })

  it('rejects unavailable, drifted, and over-budget Skill requirements without changing the ledger', () => {
    const harness = createActivationHarness(['skill_required'], { maxAppendedTargetsPerRun: 0 })
    const required = harness.byName.get('skill_required')!
    const prepare = harness.selected.controller.prepareSkillActivation!

    expect(
      prepare({
        requiredStableTargetKeys: ['missing'],
        eligibleDefinitions: harness.definitions
      })
    ).toEqual({ kind: 'rejected', rejectionCode: 'required-target-unavailable' })
    expect(
      prepare({
        requiredStableTargetKeys: [required.stableTargetKey],
        eligibleDefinitions: [
          agentTool('core'),
          agentTool('skill_required', {
            function: {
              ...harness.definitions.find(
                (definition) => definition.function.name === 'skill_required'
              )!.function,
              description: 'drifted after Run creation'
            }
          })
        ]
      })
    ).toEqual({ kind: 'rejected', rejectionCode: 'definition-drift' })
    expect(
      prepare({
        requiredStableTargetKeys: [required.stableTargetKey],
        eligibleDefinitions: harness.definitions
      })
    ).toEqual({ kind: 'rejected', rejectionCode: 'per-run-target-cap' })
    expect(harness.build(2).toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'core',
      TOOL_SEARCH_AGENT_TOOL_NAME
    ])
  })

  it('stages immutable activation provenance and commits it only on the next admitted View', () => {
    const read = agentTool('read')
    const hidden = agentTool('hidden')
    const other = agentTool('other')
    const definitions = [read, hidden, other]
    const catalog = buildCanonicalToolCatalog(definitions)
    const byName = new Map(
      catalog.entries.map((entry) => [entry.target.providerVisibleName, entry])
    )
    const selected = createPolicySelectedToolSurfaceRun({
      ceilingDefinitions: definitions,
      initialEligibleDefinitions: definitions,
      toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME),
      policy: {
        ...productionPolicy,
        enterToolCount: 1,
        exitToolCount: 0,
        maxInitialToolCount: 5
      },
      coreStableTargetKeys: [byName.get('read')!.stableTargetKey]
    })
    const build = (requestSeq: number, eligibleDefinitions = definitions) =>
      selected.controller.build({
        request: request(requestSeq),
        eligibleDefinitions,
        toolSearchAvailable: true
      })
    const initial = build(1)
    selected.controller.admit(initial)
    const hiddenEntry = byName.get('hidden')!
    const candidate = activationEvidence({
      ...request(1),
      stableTargetKey: hiddenEntry.stableTargetKey,
      canonicalToolDefinitionHash: hiddenEntry.canonicalToolDefinitionHash,
      toolCallOrdinalWithinBatch: 0,
      resultRank: 0
    })

    selected.controller.stageActivationBatch([candidate])
    expect(() => selected.controller.stageActivationBatch([structuredClone(candidate)])).not.toThrow()
    expectSurfaceError(
      () =>
        selected.controller.stageActivationBatch([
          { ...candidate, resultRank: 1 }
        ]),
      'conflicting_tool'
    )
    expectSurfaceError(() => build(1), 'invalid_definition')

    const drifted = build(2, [
      read,
      agentTool('hidden', {
        function: { ...hidden.function, description: 'live drift' }
      }),
      other
    ])
    expect(drifted.activation.decisions[0]).toMatchObject({
      accepted: false,
      rejectionCode: 'definition-drift'
    })
    expect(drifted.toolDefinitions.map((definition) => definition.function.name)).not.toContain(
      'hidden'
    )

    const proposal = build(2)
    const competing = build(3)
    expect(proposal.toolDefinitions.map((definition) => definition.function.name)).toContain('hidden')
    expect(proposal.activation).toEqual({
      originRequestSeq: 1,
      decisions: [
        {
          ...candidate,
          accepted: true
        }
      ]
    })
    expect(Object.isFrozen(proposal.activation)).toBe(true)
    expect(Object.isFrozen(proposal.activation.decisions)).toBe(true)
    expect(Object.isFrozen(proposal.activation.decisions[0])).toBe(true)
    expect(proposal.acceptedSearchEvidence).toEqual([candidate])
    expect(Object.isFrozen(proposal.acceptedSearchEvidence)).toBe(true)
    expect(Object.isFrozen(proposal.acceptedSearchEvidence[0])).toBe(true)
    expect(build(4).activation).toEqual(proposal.activation)

    selected.controller.admit(proposal)
    expectSurfaceError(() => selected.controller.admit(competing), 'conflicting_tool')
    expect(() => selected.controller.stageActivationBatch([structuredClone(candidate)])).not.toThrow()
    expectSurfaceError(
      () => selected.controller.stageActivationBatch([{ ...candidate, resultRank: 1 }]),
      'conflicting_tool'
    )
    const replayed = build(4)
    expect(replayed.activation).toEqual({ originRequestSeq: null, decisions: [] })
    expect(
      replayed.activeEntries.find((entry) => entry.definition.function.name === 'hidden')
    ).toMatchObject({ reason: 'search-result', activationOrdinal: 2 })
    expect(replayed.acceptedSearchEvidence).toEqual([candidate])
    expect(projectToolSurfaceTapeProvenance(replayed, false).surface.searchResultRefs).toEqual([
      expect.objectContaining({
        originRequestSeq: 1,
        stableTargetKey: hiddenEntry.stableTargetKey,
        toolResult: candidate.toolResult
      })
    ])
    const revoked = build(5, [read, other])
    expect(revoked.acceptedSearchEvidence).toEqual([])
    expect(projectToolSurfaceTapeProvenance(revoked, false).surface.searchResultRefs).toEqual([])
    selected.controller.admit(revoked)
    const restored = build(6)
    expect(restored.activeEntries.find((entry) => entry.definition.function.name === 'hidden')).toMatchObject({
      reason: 'search-result',
      activationOrdinal: 2
    })
    expect(restored.acceptedSearchEvidence).toEqual([candidate])
    const restoredProjection = projectToolSurfaceTapeProvenance(restored, false)
    expect(restoredProjection.surface.searchResultRefs).toEqual([
      expect.objectContaining({
        originRequestSeq: 1,
        stableTargetKey: hiddenEntry.stableTargetKey,
        toolResult: candidate.toolResult
      })
    ])
    expect(() =>
      createTapeToolSurfaceFact({
        ...restoredProjection.surface,
        manifestHash: 'd'.repeat(64),
        catalog: {
          sessionId: 's1',
          tapeIncarnationId: candidate.toolResult.tapeIncarnationId,
          entryId: 1,
          fullCatalogHash: restoredProjection.catalog.fullCatalogHash,
          catalogFactHash: 'e'.repeat(64)
        }
      })
    ).not.toThrow()
    expectSurfaceError(
      () =>
        selected.controller.build({
          request: { ...request(7), runId: 'wrong-run' },
          eligibleDefinitions: definitions,
          toolSearchAvailable: true
        }),
      'invalid_definition'
    )
  })

  it('keeps active targets and pending candidates across a preflight recovery View', () => {
    const harness = createActivationHarness(['active', 'pending'])
    const activeCandidate = harness.candidate('active', 1)
    harness.selected.controller.stageActivationBatch([activeCandidate])
    const activeView = harness.build(2)
    harness.selected.controller.admit(activeView)
    const pendingCandidate = harness.candidate('pending', 2)
    harness.selected.controller.stageActivationBatch([pendingCandidate])

    const recoveryView = harness.selected.controller.build({
      request: request(3),
      eligibleDefinitions: harness.definitions,
      toolSearchAvailable: true,
      deferActivationCandidates: true
    })
    expect(recoveryView.activation).toEqual({ originRequestSeq: null, decisions: [] })
    expect(recoveryView.toolDefinitions.map((definition) => definition.function.name)).toContain('active')
    expect(recoveryView.toolDefinitions.map((definition) => definition.function.name)).not.toContain('pending')
    harness.selected.controller.admit(recoveryView)
    expect(() =>
      assertToolSurfaceAllowsDispatch(
        recoveryView,
        request(3),
        'active',
        harness.definitions.find((definition) => definition.function.name === 'active')
      )
    ).not.toThrow()

    const laterView = harness.build(4)
    expect(laterView.activation).toEqual({
      originRequestSeq: 2,
      decisions: [{ ...pendingCandidate, accepted: true }]
    })
    expect(laterView.toolDefinitions.map((definition) => definition.function.name)).toEqual(
      expect.arrayContaining(['active', 'pending'])
    )
    harness.selected.controller.admit(laterView)
    expect(harness.build(5).activation).toEqual({ originRequestSeq: null, decisions: [] })
  })

  it('queues a later search release behind candidates deferred by recovery', () => {
    const harness = createActivationHarness(['first', 'second'])
    const first = harness.candidate('first', 1)
    const second = harness.candidate('second', 2)
    harness.selected.controller.stageActivationBatch([first])

    const recoveryView = harness.selected.controller.build({
      request: request(2),
      eligibleDefinitions: harness.definitions,
      toolSearchAvailable: true,
      deferActivationCandidates: true
    })
    harness.selected.controller.admit(recoveryView)
    expect(() => harness.selected.controller.stageActivationBatch([second])).not.toThrow()
    expect(() =>
      harness.selected.controller.stageActivationBatch([structuredClone(first)])
    ).not.toThrow()

    const firstLaterView = harness.build(3)
    expect(firstLaterView.activation).toEqual({
      originRequestSeq: 1,
      decisions: [{ ...first, accepted: true }]
    })
    harness.selected.controller.admit(firstLaterView)

    const secondLaterView = harness.build(4)
    expect(secondLaterView.activation).toEqual({
      originRequestSeq: 2,
      decisions: [{ ...second, accepted: true }]
    })
    harness.selected.controller.admit(secondLaterView)
    expect(harness.build(5).activation).toEqual({ originRequestSeq: null, decisions: [] })
  })

  it('omits an unrelated drifted definition without failing candidate activation', () => {
    const harness = createActivationHarness(['hidden', 'drifted'])
    harness.selected.controller.stageActivationBatch([harness.candidate('hidden', 1)])
    const drifted = harness.definitions.find(
      (definition) => definition.function.name === 'drifted'
    )!

    const nextView = harness.build(2, [
      ...harness.definitions.filter((definition) => definition.function.name !== 'drifted'),
      agentTool('drifted', {
        function: { ...drifted.function, description: 'changed after Run creation' }
      })
    ])

    expect(nextView.activation.decisions).toEqual([
      expect.objectContaining({
        accepted: true,
        stableTargetKey: harness.byName.get('hidden')!.stableTargetKey
      })
    ])
    expect(nextView.toolDefinitions.map((definition) => definition.function.name)).not.toContain(
      'drifted'
    )
  })

  it('does not reconstruct an unadmitted activation after its Run controller is recreated', () => {
    const interrupted = createActivationHarness(['hidden'])
    interrupted.selected.controller.stageActivationBatch([interrupted.candidate('hidden', 1)])
    const unadmitted = interrupted.build(2)

    expect(interrupted.initial.toolDefinitions.map((definition) => definition.function.name)).not.toContain(
      'hidden'
    )
    expect(unadmitted.toolDefinitions.map((definition) => definition.function.name)).toContain(
      'hidden'
    )

    const recreated = createActivationHarness(['hidden'])
    const recreatedNextView = recreated.build(2)

    expect(recreated.initial.toolDefinitions.map((definition) => definition.function.name)).not.toContain(
      'hidden'
    )
    expect(recreatedNextView.toolDefinitions.map((definition) => definition.function.name)).not.toContain(
      'hidden'
    )
    expect(recreatedNextView.activation).toEqual({ originRequestSeq: null, decisions: [] })
    expect(recreatedNextView.acceptedSearchEvidence).toEqual([])
  })

  it('rejects staging on a full controller and rejects invalid activation authority', () => {
    const read = agentTool('read')
    const full = createFullToolSurfaceRunController({
      ceilingDefinitions: [read],
      initialActiveDefinitions: [read],
      policyVersion: 'full-test'
    })
    expect(() => full.stageActivationBatch([])).not.toThrow()
    expectSurfaceError(
      () =>
        full.stageActivationBatch([
          activationEvidence({
            ...request(1),
            ...definitionIdentity('outside'),
            toolCallOrdinalWithinBatch: 0,
            resultRank: 0
          })
        ]),
      'invalid_definition'
    )

    const hidden = agentTool('hidden')
    const catalog = buildCanonicalToolCatalog([read, hidden])
    const selected = createPolicySelectedToolSurfaceRun({
      ceilingDefinitions: [read, hidden],
      initialEligibleDefinitions: [read, hidden],
      toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME),
      policy: { ...productionPolicy, enterToolCount: 1, exitToolCount: 0 }
    })
    expect(() => selected.controller.stageActivationBatch([])).not.toThrow()
    const initial = selected.controller.build({
      request: request(1),
      eligibleDefinitions: [read, hidden],
      toolSearchAvailable: true
    })
    selected.controller.admit(initial)
    const hiddenEntry = catalog.entries.find(
      (entry) => entry.target.providerVisibleName === 'hidden'
    )!
    expectSurfaceError(
      () =>
        selected.controller.stageActivationBatch([
          activationEvidence({
            ...request(1),
            runId: 'wrong-run',
            ...definitionIdentity(hiddenEntry.stableTargetKey, hiddenEntry.canonicalToolDefinitionHash),
            toolCallOrdinalWithinBatch: 0,
            resultRank: 0
          })
        ]),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        selected.controller.stageActivationBatch([
          activationEvidence({
            ...request(1),
            ...definitionIdentity(hiddenEntry.stableTargetKey, 'b'.repeat(64)),
            toolCallOrdinalWithinBatch: 0,
            resultRank: 0
          })
        ]),
      'conflicting_tool'
    )
    expectSurfaceError(
      () =>
        selected.controller.stageActivationBatch([
          activationEvidence({
            ...request(2),
            ...definitionIdentity(
              hiddenEntry.stableTargetKey,
              hiddenEntry.canonicalToolDefinitionHash
            ),
            toolCallOrdinalWithinBatch: 0,
            resultRank: 0
          })
        ]),
      'invalid_definition'
    )
    const outsideEntry = buildCanonicalToolCatalog([agentTool('outside')]).entries[0]
    expectSurfaceError(
      () =>
        selected.controller.stageActivationBatch([
          activationEvidence({
            ...request(1),
            ...definitionIdentity(
              outsideEntry.stableTargetKey,
              outsideEntry.canonicalToolDefinitionHash
            ),
            toolCallOrdinalWithinBatch: 0,
            resultRank: 0
          })
        ]),
      'conflicting_tool'
    )
  })

  it('issues immutable request-scoped execution contexts only for virtualized ToolSearch Views', () => {
    const harness = createActivationHarness(['hidden'])
    const snapshot = harness.build(2)
    expectSurfaceError(
      () => createToolSurfaceExecutionBatch({ snapshot }),
      'invalid_definition'
    )
    harness.selected.controller.admit(snapshot)
    const batch = createToolSurfaceExecutionBatch({ snapshot })
    expectSurfaceError(
      () => createToolSurfaceExecutionBatch({ snapshot }),
      'invalid_definition'
    )
    expectSurfaceError(() => batch.createContext(-1), 'invalid_definition')
    batch
      .createContext(0)
      .submitActivationCandidates([harness.candidate('hidden', 2, 0)])
    const context = batch.createContext(3)

    expect(context.snapshot).toBe(snapshot)
    expect(context.toolCallOrdinalWithinBatch).toBe(3)
    expect(batch.snapshot).toBe(snapshot)
    expect(Object.isFrozen(batch)).toBe(true)
    expect(Object.isFrozen(context)).toBe(true)
    expect(() => assertIssuedToolSurfaceExecutionContext(context)).not.toThrow()
    expect(() => assertActiveToolSurfaceExecutionContext(context, snapshot.request)).not.toThrow()
    expect(() => assertIssuedToolSurfaceExecutionContext({ ...context })).toThrow(
      /request-scoped builder/
    )
    const candidate = harness.candidate('hidden', 2, 3)
    context.submitActivationCandidates([candidate])
    batch.acceptToolCallCandidates(3)
    expect(batch.seal()).toEqual([
      expect.objectContaining({
        stableTargetKey: candidate.stableTargetKey,
        requestSeq: 2,
        toolCallOrdinalWithinBatch: 3
      })
    ])
    expect(() => assertActiveToolSurfaceExecutionContext(context, snapshot.request)).toThrow(
      /no longer active|stale/
    )
    expectSurfaceError(
      () => context.submitActivationCandidates([{ ...candidate, toolCallOrdinalWithinBatch: 2 }]),
      'invalid_definition'
    )

    const boundedSnapshot = harness.build(3)
    harness.selected.controller.admit(boundedSnapshot)
    const boundedBatch = createToolSurfaceExecutionBatch({ snapshot: boundedSnapshot })
    const boundedContext = boundedBatch.createContext(0)
    const boundedCandidate = harness.candidate('hidden', 3, 0)
    for (let index = 0; index < MAX_TOOL_SURFACE_CANDIDATE_BATCHES; index += 1) {
      boundedContext.submitActivationCandidates([
        { ...boundedCandidate, resultRank: index }
      ])
    }
    expectSurfaceError(
      () =>
        boundedContext.submitActivationCandidates([
          {
            ...boundedCandidate,
            resultRank: MAX_TOOL_SURFACE_CANDIDATE_BATCHES
          }
        ]),
      'limit_exceeded'
    )
    boundedBatch.discard()

    const searchBoundedSnapshot = harness.build(4)
    harness.selected.controller.admit(searchBoundedSnapshot)
    const searchBoundedBatch = createToolSurfaceExecutionBatch({
      snapshot: searchBoundedSnapshot
    })
    for (let index = 0; index < MAX_TOOL_SURFACE_SEARCH_CALLS_PER_BATCH; index += 1) {
      searchBoundedBatch.createContext(index)
    }
    expectSurfaceError(
      () => searchBoundedBatch.createContext(MAX_TOOL_SURFACE_SEARCH_CALLS_PER_BATCH),
      'limit_exceeded'
    )
    searchBoundedBatch.discard()

    const abandonedSnapshot = harness.build(5)
    harness.selected.controller.admit(abandonedSnapshot)
    const replacementSnapshot = harness.build(6)
    harness.selected.controller.admit(replacementSnapshot)
    expectSurfaceError(
      () => createToolSurfaceExecutionBatch({ snapshot: abandonedSnapshot }),
      'invalid_definition'
    )
    createToolSurfaceExecutionBatch({ snapshot: replacementSnapshot }).discard()

    const activeSnapshot = harness.build(7)
    harness.selected.controller.admit(activeSnapshot)
    const activeBatch = createToolSurfaceExecutionBatch({ snapshot: activeSnapshot })
    const activeContext = activeBatch.createContext(0)
    const nextSnapshot = harness.build(8)
    harness.selected.controller.admit(nextSnapshot)
    expect(() => activeContext.submitActivationCandidates([])).toThrow(/no longer active/)
    expect(() =>
      assertActiveToolSurfaceExecutionContext(activeContext, activeSnapshot.request)
    ).toThrow(/stale|no longer active/)
    activeBatch.discard()

    const fullController = createFullToolSurfaceRunController({
      ceilingDefinitions: harness.definitions,
      initialActiveDefinitions: harness.definitions,
      policyVersion: 'full-test'
    })
    const full = fullController.build({
      request: request(1),
      eligibleDefinitions: harness.definitions
    })
    fullController.admit(full)
    expectSurfaceError(
      () => createToolSurfaceExecutionBatch({ snapshot: full }),
      'invalid_definition'
    )
  })

  it('applies per-batch count and eligibility limits without evicting active tools', () => {
    const harness = createActivationHarness(['first', 'second', 'ineligible'], {
      maxActivationCandidatesPerBatch: 1
    })
    harness.selected.controller.stageActivationBatch([
      harness.candidate('first', 1, 0, 0),
      harness.candidate('second', 1, 0, 1),
      harness.candidate('ineligible', 1, 0, 2)
    ])
    const proposal = harness.build(
      2,
      harness.definitions.filter(
        (definition) => definition.function.name !== 'ineligible'
      )
    )

    expect(proposal.activation.decisions.map((decision) => decision.rejectionCode ?? 'accepted')).toEqual([
      'accepted',
      'per-batch-count-cap',
      'ineligible'
    ])
    expect(proposal.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'core',
      TOOL_SEARCH_AGENT_TOOL_NAME,
      'first'
    ])
  })

  it('applies per-batch and total-surface token limits', () => {
    const batchHarness = createActivationHarness(['first', 'second'])
    const firstTokens = batchHarness.byName.get('first')!.definitionTokens
    const batchLimited = createActivationHarness(['first', 'second'], {
      maxActivationCandidateDefinitionTokensPerBatch: firstTokens
    })
    batchLimited.selected.controller.stageActivationBatch([
      batchLimited.candidate('first', 1, 0, 0),
      batchLimited.candidate('second', 1, 0, 1)
    ])
    expect(batchLimited.build(2).activation.decisions.map((decision) => decision.rejectionCode)).toEqual([
      undefined,
      'per-batch-token-cap'
    ])

    const searchTokens = buildCanonicalToolCatalog([
      agentTool(TOOL_SEARCH_AGENT_TOOL_NAME)
    ]).definitionTokens
    const coreTokens = batchHarness.byName.get('core')!.definitionTokens
    const totalLimited = createActivationHarness(['first'], {
      toolSearchDefinitionTokens: searchTokens,
      activationReserveDefinitionTokens: 0,
      maxInitialDefinitionTokens: coreTokens + searchTokens + firstTokens - 1
    })
    totalLimited.selected.controller.stageActivationBatch([
      totalLimited.candidate('first', 1)
    ])
    expect(totalLimited.build(2).activation.decisions[0].rejectionCode).toBe(
      'total-surface-token-cap'
    )
  })

  it('applies per-Run target, batch, and total-surface count limits', () => {
    const targetLimited = createActivationHarness(['first', 'second'], {
      maxAppendedTargetsPerRun: 1
    })
    targetLimited.selected.controller.stageActivationBatch([
      targetLimited.candidate('first', 1, 0, 0),
      targetLimited.candidate('second', 1, 0, 1)
    ])
    expect(targetLimited.build(2).activation.decisions.map((decision) => decision.rejectionCode)).toEqual([
      undefined,
      'per-run-target-cap'
    ])

    const batchLimited = createActivationHarness(['first', 'second'], {
      maxActivationBatchesPerRun: 1
    })
    batchLimited.selected.controller.stageActivationBatch([batchLimited.candidate('first', 1)])
    const firstProposal = batchLimited.build(2)
    batchLimited.selected.controller.admit(firstProposal)
    batchLimited.selected.controller.stageActivationBatch([batchLimited.candidate('second', 2)])
    expect(batchLimited.build(3).activation.decisions[0].rejectionCode).toBe(
      'per-run-batch-cap'
    )

    const surfaceLimited = createActivationHarness(['first', 'second'], {
      maxInitialToolCount: 3
    })
    surfaceLimited.selected.controller.stageActivationBatch([
      surfaceLimited.candidate('first', 1, 0, 0),
      surfaceLimited.candidate('second', 1, 0, 1)
    ])
    expect(surfaceLimited.build(2).activation.decisions.map((decision) => decision.rejectionCode)).toEqual([
      undefined,
      'total-surface-count-cap'
    ])
  })

  it('consumes and replays an all-rejected release without expanding the surface', () => {
    const harness = createActivationHarness(['hidden'], { maxActivationBatchesPerRun: 1 })
    const candidate = harness.candidate('hidden', 1)
    harness.selected.controller.stageActivationBatch([candidate])
    const rejected = harness.build(
      2,
      harness.definitions.filter((definition) => definition.function.name !== 'hidden')
    )

    expect(rejected.activation.decisions).toEqual([
      expect.objectContaining({ accepted: false, rejectionCode: 'ineligible' })
    ])
    expect(rejected.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'core',
      TOOL_SEARCH_AGENT_TOOL_NAME
    ])
    harness.selected.controller.admit(rejected)
    expect(() =>
      harness.selected.controller.stageActivationBatch([structuredClone(candidate)])
    ).not.toThrow()
    expectSurfaceError(
      () =>
        harness.selected.controller.stageActivationBatch([
          { ...candidate, resultRank: 1 }
        ]),
      'conflicting_tool'
    )

    harness.selected.controller.stageActivationBatch([harness.candidate('hidden', 2)])
    const quotaLimited = harness.build(3)
    expect(quotaLimited.activation.decisions).toEqual([
      expect.objectContaining({ accepted: false, rejectionCode: 'per-run-batch-cap' })
    ])
    expect(quotaLimited.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'core',
      TOOL_SEARCH_AGENT_TOOL_NAME
    ])
  })

  it('omits definition drift and rejects targets outside the frozen virtualized ceiling', () => {
    const read = agentTool('read')
    const write = agentTool('write')
    const selected = createPolicySelectedToolSurfaceRun({
      ceilingDefinitions: [read, write],
      initialEligibleDefinitions: [read, write],
      toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME),
      policy: { ...productionPolicy, enterToolCount: 1, exitToolCount: 0 }
    })
    const build = (eligibleDefinitions: MCPToolDefinition[]) =>
      selected.controller.build({
        request: request(1),
        eligibleDefinitions,
        toolSearchAvailable: true
      })

    const drifted = build([
      agentTool('read', {
        function: { ...read.function, description: 'drifted after Run creation' }
      }),
      write
    ])
    expect(drifted.toolDefinitions.map((definition) => definition.function.name)).not.toContain(
      'read'
    )
    expectSurfaceError(() => build([read, write, agentTool('outside')]), 'conflicting_tool')
  })

  it('bounds aggregate live eligibility before per-definition drift checks', () => {
    const definitionCount = 1_023
    const ceilingDefinitions = Array.from({ length: definitionCount }, (_, index) =>
      agentTool(`tool_${index}`)
    )
    const selected = createPolicySelectedToolSurfaceRun({
      ceilingDefinitions,
      initialEligibleDefinitions: ceilingDefinitions,
      toolSearchDefinition: agentTool(TOOL_SEARCH_AGENT_TOOL_NAME),
      policy: {
        ...productionPolicy,
        enterToolCount: 1,
        exitToolCount: 0,
        maxInitialToolCount: 8
      }
    })
    const oversizedDescription = 'x'.repeat(
      Math.ceil(MAX_TOOL_SURFACE_TOTAL_INPUT_BYTES / definitionCount) + 1_024
    )
    const oversizedEligibility = ceilingDefinitions.map((definition) =>
      agentTool(definition.function.name, {
        function: { ...definition.function, description: oversizedDescription }
      })
    )

    expectSurfaceError(
      () =>
        selected.controller.build({
          request: request(1),
          eligibleDefinitions: oversizedEligibility,
          toolSearchAvailable: true
        }),
      'limit_exceeded'
    )
  })
})
