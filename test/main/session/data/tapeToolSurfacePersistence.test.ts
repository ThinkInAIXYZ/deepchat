import { describe, expect, it } from 'vitest'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/core/mcp'
import { buildCanonicalToolCatalog } from '@/agent/deepchat/runtime/toolSurface'
import { buildToolSearchDefinition } from '@/tool/agentTools/toolSearchTool'
import { buildExecutionContract } from '@/tape/domain/executionContract'
import {
  buildTapeSkillMaterializationRef,
  hashSkillEffectiveContent
} from '@/tape/domain/skillMaterialization'
import {
  TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME,
  TAPE_TOOL_CATALOG_EVENT_NAME,
  TAPE_TOOL_SURFACE_EVENT_NAME,
  buildProgrammaticToolSurfaceHashV1,
  buildTapeToolResultPayloadHash,
  getTapeToolSurfaceAdapterMode,
  type CreateTapeToolSurfaceFactInput,
  type TapeToolCatalogSourceEntry,
  type TapeToolSurfaceActiveEntry
} from '@/tape/domain/toolSurfaceFacts'
import { hashJsonData } from '@/tape/domain/canonicalJson'
import { createTapeViewManifest, type TapeViewManifestBuildInput } from '@/tape/domain/viewManifest'
import {
  ToolSurfaceProvenanceCorruptionError,
  ToolSurfaceProvenanceError
} from '@/tape/application/toolSurfaceProvenanceService'
import {
  DatabaseCtor,
  DeepChatTapeEntriesTable,
  createTapeService,
  createTapeTableMock,
  itIfSqlite
} from './tapeTestHarness'

const SESSION_ID = 'session-1'
const MESSAGE_ID = 'message-1'
const RUN_ID = '11111111-1111-4111-8111-111111111111'

const TOOL: MCPToolDefinition = {
  type: 'function',
  source: 'mcp',
  execution: TOOL_EXECUTION.read.parallel,
  function: {
    name: 'read_file',
    description: 'Read a file',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  server: {
    name: 'filesystem',
    id: '22222222-2222-4222-8222-222222222222',
    configGeneration: 1,
    bindingHash: 'a'.repeat(64),
    icons: '',
    description: 'Filesystem tools'
  },
  raw: {
    name: 'read_file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  }
}

const PROGRAMMATIC_TOOL: MCPToolDefinition = {
  type: 'function',
  source: 'mcp',
  execution: TOOL_EXECUTION.read.parallel,
  function: {
    name: 'remote_search',
    description: 'Search a remote index',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  server: {
    name: 'remote-index',
    id: '33333333-3333-4333-8333-333333333333',
    configGeneration: 1,
    bindingHash: 'b'.repeat(64),
    icons: '',
    description: 'Remote index tools'
  },
  raw: {
    name: 'remote_search',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    }
  }
}

const EXEC_TOOL: MCPToolDefinition = {
  type: 'function',
  source: 'agent',
  execution: TOOL_EXECUTION.write,
  function: {
    name: 'exec',
    description: 'Execute a foreground command',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command']
    }
  },
  server: {
    name: 'agent-filesystem',
    icons: '',
    description: 'Agent filesystem tools'
  }
}

const QUESTION_TOOL: MCPToolDefinition = {
  type: 'function',
  source: 'agent',
  execution: TOOL_EXECUTION.read.sequential,
  function: {
    name: 'question',
    description: 'Ask the user a question',
    parameters: { type: 'object', properties: { prompt: { type: 'string' } } }
  },
  server: {
    name: 'agent-interaction',
    icons: '',
    description: 'Agent interaction tools'
  }
}

function toCatalogEntry(
  entry: ReturnType<typeof buildCanonicalToolCatalog>['entries'][number]
): TapeToolCatalogSourceEntry {
  return {
    target: entry.target,
    stableTargetKey: entry.stableTargetKey,
    canonicalToolDefinitionHash: entry.canonicalToolDefinitionHash,
    exposure: entry.exposure,
    execution: entry.execution
  }
}

function createCommitInput(
  requestSeq = 1,
  content = 'Read a file',
  options: {
    eligibleTools?: readonly MCPToolDefinition[]
    activeTools?: readonly MCPToolDefinition[]
    policyVersion?: string
    virtualizationTriggered?: boolean
    messages?: TapeViewManifestBuildInput['messages']
    latestEntryId?: number
    tapeIncarnationId?: string
    skillContexts?: TapeViewManifestBuildInput['skillContexts']
  } = {}
) {
  const eligibleTools = options.eligibleTools ?? [TOOL]
  const activeTools = options.activeTools ?? [TOOL]
  const messages = options.messages ?? [{ role: 'user' as const, content }]
  const catalog = buildCanonicalToolCatalog(eligibleTools)
  const catalogEntries = catalog.entries.map(toCatalogEntry)
  const catalogByTarget = new Map(catalogEntries.map((entry) => [entry.stableTargetKey, entry]))
  const activeEntries: TapeToolSurfaceActiveEntry[] = activeTools.map((definition, index) => {
    const targetKey = buildCanonicalToolCatalog([definition]).entries[0].stableTargetKey
    const entry = catalogByTarget.get(targetKey)
    if (!entry) throw new TypeError('Active test tool is missing from its eligible catalog.')
    return {
      ...entry,
      activationOrdinal: index,
      reason: options.virtualizationTriggered ? 'policy-required' : 'full-catalog'
    }
  })
  const activeCatalog = buildCanonicalToolCatalog(activeTools)
  const executionContract = buildExecutionContract({
    request: {
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      runId: RUN_ID,
      requestSeq
    },
    promptAssembly: { prompt: '', sections: [] },
    providerMessages: messages,
    tools: activeTools,
    providerId: 'openai',
    modelId: 'gpt-5',
    modelConfig: {} as any,
    temperature: 0.2,
    maxTokens: 100,
    workspace: { kind: 'runtime_default' },
    maxSubagentDepth: 0,
    dynamicControlSnapshot: {
      permissionMode: 'default',
      requestAdmitted: true,
      cancellationRequested: false
    },
    assemblerVersion: 'test-v1'
  })
  const manifest = createTapeViewManifest({
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    requestSeq,
    taskType: requestSeq === 1 ? 'chat' : 'tool_loop',
    policy: 'legacy_context_v1',
    policyVersion: 1,
    contextBuilderVersion: 'legacy-v1',
    messages,
    tools: [...activeTools],
    latestEntryId: options.latestEntryId ?? 0,
    anchorEntryIds: [],
    included: [],
    excluded: [],
    tokenBudget: {
      contextLength: 1_000,
      requestedMaxTokens: 100,
      effectiveMaxTokens: 100,
      reserveTokens: 100,
      toolReserveTokens: activeCatalog.definitionTokens
    },
    providerId: 'openai',
    modelId: 'gpt-5',
    summaryCursorOrderSeq: 0,
    supportsVision: false,
    supportsAudioInput: false,
    traceDebugEnabled: false,
    executionContract,
    ...(options.skillContexts?.length
      ? {
          runId: RUN_ID,
          tapeIncarnationId: options.tapeIncarnationId,
          skillContexts: options.skillContexts
        }
      : {}),
    assembledAt: 200 + requestSeq
  })
  const surface = {
    request: executionContract.request,
    canonicalizationVersion: catalog.canonicalizationVersion,
    orderingVersion: 'activation-ordinal-v1',
    policyVersion: options.policyVersion ?? 'full-catalog-v1',
    adapterMode: options.virtualizationTriggered ? 'cli-programmatic' : 'direct-native',
    virtualizationTriggered: options.virtualizationTriggered ?? false,
    contractBearing: true,
    activeEntries,
    budget: {
      eligibleToolCount: catalog.entries.length,
      activeToolCount: activeEntries.length,
      eligibleDefinitionTokens: catalog.definitionTokens,
      activeDefinitionTokens: activeCatalog.definitionTokens
    }
  } satisfies Omit<CreateTapeToolSurfaceFactInput, 'manifestHash' | 'catalog'>
  return {
    manifest,
    activeToolDefinitions: activeTools,
    programmaticSurface: null,
    catalog: {
      catalogSchemaVersion: catalog.schemaVersion,
      canonicalizationVersion: catalog.canonicalizationVersion,
      fullCatalogHash: catalog.fullCatalogHash,
      entries: catalogEntries
    },
    surface
  }
}

function createProgrammaticCommitInput(requestSeq = 1) {
  const input = createCommitInput(requestSeq, 'Search a remote index', {
    eligibleTools: [EXEC_TOOL, PROGRAMMATIC_TOOL],
    activeTools: [EXEC_TOOL],
    policyVersion: 'cli-programmatic-v1',
    virtualizationTriggered: true
  })
  const activeTargets = new Set(input.surface.activeEntries.map((entry) => entry.stableTargetKey))
  const entries = input.catalog.entries.filter(
    (entry) => entry.target.source === 'mcp' && !activeTargets.has(entry.stableTargetKey)
  )
  return {
    ...input,
    programmaticSurface: {
      capabilitySchemaVersion: 1 as const,
      capabilityHashVersion: 1 as const,
      capabilityHash: hashJsonData({ capability: 'programmatic-test-v1', requestSeq }),
      programmaticSurfaceSchemaVersion: 1 as const,
      programmaticSurfaceHashVersion: 1 as const,
      programmaticSurfaceHash: buildProgrammaticToolSurfaceHashV1({
        schemaVersion: 1,
        canonicalizationVersion: input.catalog.canonicalizationVersion,
        catalogHash: input.catalog.fullCatalogHash,
        entries
      }),
      canonicalizationVersion: input.catalog.canonicalizationVersion,
      policyVersion: input.surface.policyVersion,
      adapterMode: 'cli-programmatic' as const,
      request: input.surface.request,
      entries,
      taskContractRef: input.manifest.executionContract.provenance.taskContractRef,
      ceilings: {
        maxToolEffect: 'read' as const,
        workspace: { kind: 'runtime_default' as const },
        maxSubagentDepth: 0 as const
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
}

function createVirtualizedCommitInput(
  toolResult: {
    entryId: number
    tapeIncarnationId: string
    payloadHash: string
  },
  latestEntryId = toolResult.entryId
) {
  const toolSearch = buildToolSearchDefinition()
  const tools = [toolSearch, TOOL]
  const messages = [{ role: 'user' as const, content: 'Find and read a file' }]
  const catalog = buildCanonicalToolCatalog(tools)
  const catalogEntries = catalog.entries.map(toCatalogEntry)
  const entryByName = new Map(
    catalogEntries.map((entry) => [entry.target.providerVisibleName, entry])
  )
  const toolSearchEntry = entryByName.get('tool_search')!
  const readFileEntry = entryByName.get('read_file')!
  const request = {
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    runId: RUN_ID,
    requestSeq: 2
  }
  const executionContract = buildExecutionContract({
    request,
    promptAssembly: { prompt: '', sections: [] },
    providerMessages: messages,
    tools,
    providerId: 'openai',
    modelId: 'gpt-5',
    modelConfig: {} as any,
    temperature: 0.2,
    maxTokens: 100,
    workspace: { kind: 'runtime_default' },
    maxSubagentDepth: 0,
    dynamicControlSnapshot: {
      permissionMode: 'default',
      requestAdmitted: true,
      cancellationRequested: false
    },
    assemblerVersion: 'test-v1'
  })
  const manifest = createTapeViewManifest({
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    requestSeq: 2,
    taskType: 'tool_loop',
    policy: 'legacy_context_v1',
    policyVersion: 1,
    contextBuilderVersion: 'legacy-v1',
    messages,
    tools,
    latestEntryId,
    anchorEntryIds: [1],
    included: [],
    excluded: [],
    tokenBudget: {
      contextLength: 1_000,
      requestedMaxTokens: 100,
      effectiveMaxTokens: 100,
      reserveTokens: 100,
      toolReserveTokens: catalog.definitionTokens
    },
    providerId: 'openai',
    modelId: 'gpt-5',
    summaryCursorOrderSeq: 0,
    supportsVision: false,
    supportsAudioInput: false,
    traceDebugEnabled: false,
    executionContract,
    assembledAt: 300
  })
  return {
    manifest,
    activeToolDefinitions: tools,
    programmaticSurface: null,
    catalog: {
      catalogSchemaVersion: catalog.schemaVersion,
      canonicalizationVersion: catalog.canonicalizationVersion,
      fullCatalogHash: catalog.fullCatalogHash,
      entries: catalogEntries
    },
    surface: {
      request,
      canonicalizationVersion: catalog.canonicalizationVersion,
      orderingVersion: 'activation-ordinal-v1',
      policyVersion: 'virtualized-v1',
      adapterMode: 'native-activation' as const,
      virtualizationTriggered: true,
      contractBearing: true,
      activeEntries: [
        { ...toolSearchEntry, activationOrdinal: 0, reason: 'tool-search' as const },
        { ...readFileEntry, activationOrdinal: 1, reason: 'search-result' as const }
      ],
      budget: {
        eligibleToolCount: catalog.entries.length,
        activeToolCount: catalog.entries.length,
        eligibleDefinitionTokens: catalog.definitionTokens,
        activeDefinitionTokens: catalog.definitionTokens
      },
      searchResultRefs: [
        {
          originRequestSeq: 1,
          toolCallOrdinalWithinBatch: 0,
          resultRank: 0,
          stableTargetKey: readFileEntry.stableTargetKey,
          canonicalToolDefinitionHash: readFileEntry.canonicalToolDefinitionHash,
          toolResult: {
            sessionId: SESSION_ID,
            tapeIncarnationId: toolResult.tapeIncarnationId,
            entryId: toolResult.entryId,
            payloadHashVersion: 1 as const,
            payloadHash: toolResult.payloadHash
          }
        }
      ]
    }
  }
}

function appendToolSearchResult(table: ReturnType<typeof createTapeTableMock>['table']) {
  table.ensureBootstrapAnchor(SESSION_ID)
  const tapeIncarnationId = JSON.parse(table.getByEntryId(SESSION_ID, 1).meta_json)
    .tapeIncarnationId as string
  const payload = {
    messageId: MESSAGE_ID,
    orderSeq: 1,
    toolCallId: 'search-call-1',
    response: JSON.stringify({
      results: [
        {
          name: 'read_file',
          source: 'MCP',
          description: 'Read a file',
          effect: 'read',
          state: 'pending'
        }
      ]
    })
  }
  const row = table.append({
    sessionId: SESSION_ID,
    kind: 'tool_result',
    name: 'tool_search',
    source: { type: 'tool_result', id: `${MESSAGE_ID}:search-call-1`, seq: 0 },
    payload,
    meta: { status: 'success' },
    createdAt: 250
  })
  return {
    entryId: row.entry_id,
    tapeIncarnationId,
    payloadHash: buildTapeToolResultPayloadHash(payload)
  }
}

function createSchema7CommitInput(
  table: ReturnType<typeof createTapeTableMock>['table'],
  service: ReturnType<typeof createTapeService>
) {
  table.ensureBootstrapAnchor(SESSION_ID)
  const tapeIncarnationId = table.getBootstrapIncarnation(SESSION_ID)!
  const skillName = 'runtime-skill'
  const effectiveContent = '# Runtime Skill\n\nUse the frozen execution package.'
  const responseText = JSON.stringify({
    success: true,
    name: skillName,
    content: effectiveContent,
    activatedForMessage: true,
    activationScope: 'message',
    activationEvidenceVersion: 1
  })
  const operation = {
    runId: RUN_ID,
    requestSeq: 1,
    providerToolCallId: 'skill-call-1'
  }
  service.commitRunStarted({
    sessionId: SESSION_ID,
    runId: RUN_ID,
    messageId: MESSAGE_ID,
    runKind: 'loop'
  })
  service.commitDispatch({
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    operation,
    toolName: 'skill_view',
    toolSource: 'agent',
    normalizedArguments: { name: skillName },
    target: { serverName: 'agent-skills', originalName: 'skill_view' }
  })
  const outcome = service.commitToolOutcome({
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    operation,
    responseText,
    isError: false
  })
  const toolResult = service.appendSkillViewResultFact({
    sessionId: SESSION_ID,
    expectedTapeIncarnationId: tapeIncarnationId,
    messageId: MESSAGE_ID,
    orderSeq: 2,
    blockIndex: 0,
    toolCallId: operation.providerToolCallId,
    toolName: 'skill_view',
    responseText,
    timestamp: 250,
    operation,
    outcomeEntryId: outcome.entryId,
    identity: {
      agentId: 'deepchat',
      sourceType: 'builtin',
      sourceId: 'builtin-skills',
      skillName
    }
  })
  const [materialization] = service.materializeSkillContexts([
    {
      sessionId: SESSION_ID,
      expectedTapeIncarnationId: tapeIncarnationId,
      agentId: 'deepchat',
      sourceType: 'builtin',
      sourceId: 'builtin-skills',
      skillName,
      effectiveContent,
      builderVersion: 'skill-effective-content-v2',
      renderedManifestHash: hashSkillEffectiveContent('manifest'),
      scriptInventoryHash: hashSkillEffectiveContent('scripts'),
      executionPackage: {
        files: [],
        executables: [],
        runtimePolicy: { python: 'auto', node: 'auto' },
        environmentBindingId: null
      }
    }
  ])
  const { sessionId: _sessionId, ...executionRef } =
    buildTapeSkillMaterializationRef(materialization)
  return createCommitInput(3, responseText, {
    messages: [{ role: 'tool', content: responseText, tool_call_id: operation.providerToolCallId }],
    latestEntryId: materialization.entryId,
    tapeIncarnationId,
    skillContexts: [
      {
        activationScope: 'runtime_view',
        agentId: 'deepchat',
        sourceType: 'builtin',
        sourceId: 'builtin-skills',
        skillName,
        authoritativeRef: {
          kind: 'tool_result',
          entryId: toolResult.entryId,
          contentHash: toolResult.contentHash
        },
        executionRef,
        providerRole: 'tool',
        sourceEntryIds: [],
        projectedContentHash: toolResult.contentHash,
        projectionVersion: 1,
        deduplicationSource: 'runtime_view'
      }
    ]
  })
}

describe('ToolSurfaceProvenanceService', () => {
  it('atomically commits one canonical manifest, catalog, and surface', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createCommitInput()

    const receipt = service.commitToolSurfaceView(input)

    expect(entries.map((entry) => entry.name)).toEqual([
      'session/start',
      'view/assembled',
      TAPE_TOOL_CATALOG_EVENT_NAME,
      TAPE_TOOL_SURFACE_EVENT_NAME
    ])
    expect(receipt.manifest).toMatchObject({ entryId: 2, created: true })
    expect(receipt.catalog).toMatchObject({ entryId: 3, created: true })
    expect(receipt.surface).toMatchObject({ entryId: 4, created: true })

    const surfacePayload = JSON.parse(entries[3].payload_json)
    expect(surfacePayload.data.catalog).toMatchObject({
      sessionId: SESSION_ID,
      tapeIncarnationId: receipt.tapeIncarnationId,
      entryId: receipt.catalog.entryId,
      fullCatalogHash: receipt.catalog.fullCatalogHash,
      catalogFactHash: receipt.catalog.catalogFactHash
    })
    expect(surfacePayload.data.manifestHash).toBe(input.manifest.hashes.manifestHash)
  })

  it('atomically commits a contract-bearing schema-v7 Skill and Tool Surface View', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createSchema7CommitInput(table, service)
    const evidenceEntryCount = entries.length

    expect(input.manifest).toMatchObject({ schemaVersion: 7, hashVersion: 5 })
    const receipt = service.commitToolSurfaceView(input)

    expect(entries.slice(evidenceEntryCount).map((entry) => entry.name)).toEqual([
      'view/assembled',
      TAPE_TOOL_CATALOG_EVENT_NAME,
      TAPE_TOOL_SURFACE_EVENT_NAME
    ])
    expect(receipt.manifest.created).toBe(true)
    expect(receipt.surface.created).toBe(true)
    expect(JSON.parse(entries.at(-1)!.payload_json).data.contractBearing).toBe(true)
  })

  it('rolls back a schema-v7 ViewManifest when its Tool Surface transaction fails', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createSchema7CommitInput(table, service)
    const evidenceEntries = structuredClone(entries)
    table.appendToolSurfaceEvent.mockImplementationOnce(() => {
      throw new Error('catalog write failed')
    })

    expect(() => service.commitToolSurfaceView(input)).toThrow(ToolSurfaceProvenanceError)
    expect(entries).toEqual(evidenceEntries)
  })

  it('atomically appends Programmatic provenance after the provider surface', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createProgrammaticCommitInput()

    const receipt = service.commitToolSurfaceView(input)

    expect(entries.map((entry) => entry.name)).toEqual([
      'session/start',
      'view/assembled',
      TAPE_TOOL_CATALOG_EVENT_NAME,
      TAPE_TOOL_SURFACE_EVENT_NAME,
      TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME
    ])
    expect(receipt.programmaticSurface).toMatchObject({
      entryId: 5,
      capabilityHash: input.programmaticSurface.capabilityHash,
      programmaticSurfaceHash: input.programmaticSurface.programmaticSurfaceHash,
      created: true
    })
    const payload = JSON.parse(entries[4].payload_json)
    expect(payload.data).toMatchObject({
      manifestHash: input.manifest.hashes.manifestHash,
      contractBearing: true,
      catalog: {
        entryId: receipt.catalog.entryId,
        tapeIncarnationId: receipt.tapeIncarnationId
      }
    })
    expect(entries[4].entry_id).toBeGreaterThan(receipt.surface.entryId)
  })

  it('reuses exact Programmatic facts and rejects changed content at the same identity', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createProgrammaticCommitInput()

    const first = service.commitToolSurfaceView(input)
    const repeated = service.commitToolSurfaceView(input)

    expect(repeated.programmaticSurface).toEqual({
      ...first.programmaticSurface,
      created: false
    })
    expect(
      entries.filter((entry) => entry.name === TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME)
    ).toHaveLength(1)
    expect(() =>
      service.commitToolSurfaceView({
        ...input,
        programmaticSurface: {
          ...input.programmaticSurface,
          capabilityHash: 'f'.repeat(64)
        }
      })
    ).toThrow(ToolSurfaceProvenanceCorruptionError)
  })

  it('does not repair a Programmatic fact whose provider surface is missing', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createProgrammaticCommitInput()
    service.commitToolSurfaceView(input)
    entries.splice(
      entries.findIndex((entry) => entry.name === TAPE_TOOL_SURFACE_EVENT_NAME),
      1
    )

    expect(() => service.commitToolSurfaceView(input)).toThrow(ToolSurfaceProvenanceCorruptionError)
    expect(entries.filter((entry) => entry.name === TAPE_TOOL_SURFACE_EVENT_NAME)).toEqual([])
    expect(
      entries.filter((entry) => entry.name === TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME)
    ).toHaveLength(1)
  })

  it('does not repair a provider surface whose Programmatic fact is missing', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createProgrammaticCommitInput()
    service.commitToolSurfaceView(input)
    entries.splice(
      entries.findIndex((entry) => entry.name === TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME),
      1
    )

    expect(() => service.commitToolSurfaceView(input)).toThrow(ToolSurfaceProvenanceCorruptionError)
    expect(entries.filter((entry) => entry.name === TAPE_TOOL_SURFACE_EVENT_NAME)).toHaveLength(1)
    expect(
      entries.filter((entry) => entry.name === TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME)
    ).toEqual([])
  })

  it('requires Programmatic provenance exactly for the CLI Programmatic adapter', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createProgrammaticCommitInput()

    expect(() => service.commitToolSurfaceView({ ...input, programmaticSurface: null })).toThrow(
      ToolSurfaceProvenanceError
    )
    expect(() =>
      service.commitToolSurfaceView({
        ...createCommitInput(),
        programmaticSurface: input.programmaticSurface
      })
    ).toThrow(ToolSurfaceProvenanceError)
    expect(entries).toEqual([])
    expect(table.runInTransaction).not.toHaveBeenCalled()
  })

  it('rejects incomplete Programmatic authority before opening a transaction', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createProgrammaticCommitInput()

    expect(() =>
      service.commitToolSurfaceView({
        ...input,
        programmaticSurface: { ...input.programmaticSurface, entries: [] }
      })
    ).toThrow(ToolSurfaceProvenanceError)
    expect(entries).toEqual([])
    expect(table.runInTransaction).not.toHaveBeenCalled()
  })

  it('rejects a CLI Programmatic View that omits an eligible Agent tool', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createCommitInput(1, 'Search a remote index', {
      eligibleTools: [EXEC_TOOL, QUESTION_TOOL, PROGRAMMATIC_TOOL],
      activeTools: [EXEC_TOOL],
      policyVersion: 'cli-programmatic-v1',
      virtualizationTriggered: true
    })
    const activeTargets = new Set(input.surface.activeEntries.map((entry) => entry.stableTargetKey))
    const programmaticEntries = input.catalog.entries.filter(
      (entry) => entry.target.source === 'mcp' && !activeTargets.has(entry.stableTargetKey)
    )
    const programmaticSurface = createProgrammaticCommitInput().programmaticSurface

    expect(() =>
      service.commitToolSurfaceView({
        ...input,
        programmaticSurface: {
          ...programmaticSurface,
          request: input.surface.request,
          programmaticSurfaceHash: buildProgrammaticToolSurfaceHashV1({
            schemaVersion: 1,
            canonicalizationVersion: input.catalog.canonicalizationVersion,
            catalogHash: input.catalog.fullCatalogHash,
            entries: programmaticEntries
          }),
          entries: programmaticEntries
        }
      })
    ).toThrow(ToolSurfaceProvenanceError)
    expect(entries).toEqual([])
    expect(table.runInTransaction).not.toHaveBeenCalled()
  })

  it('rolls back every View fact when Programmatic provenance persistence fails', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const append = table.appendToolSurfaceEvent.getMockImplementation()!
    table.appendToolSurfaceEvent
      .mockImplementationOnce(append)
      .mockImplementationOnce(append)
      .mockImplementationOnce(() => {
        throw new Error('programmatic surface write failed')
      })

    expect(() => service.commitToolSurfaceView(createProgrammaticCommitInput())).toThrow(
      ToolSurfaceProvenanceError
    )
    expect(entries).toEqual([])
  })

  it('recovers one hash-verified surface fact by provider request identity', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    const receipt = service.commitToolSurfaceView(createCommitInput())

    const records = service.listToolSurfaceFactsByMessageRequest(SESSION_ID, MESSAGE_ID, 1)

    expect(records).toHaveLength(1)
    expect(records[0].entryId).toBe(receipt.surface.entryId)
    expect(records[0].fact).toMatchObject({
      surfaceHash: receipt.surface.surfaceHash,
      request: { sessionId: SESSION_ID, messageId: MESSAGE_ID, runId: RUN_ID, requestSeq: 1 }
    })
  })

  it('recovers historical Tool Surface V1 rows without reinterpreting their hash recipe', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    const receipt = service.commitToolSurfaceView(createCommitInput())
    const row = table.getByEntryId(SESSION_ID, receipt.surface.entryId)
    const payload = JSON.parse(row.payload_json)
    const { adapterMode: _adapterMode, surfaceHash: _surfaceHash, ...currentBody } = payload.data
    const historicalBody = {
      ...currentBody,
      schemaVersion: 1,
      surfaceHashVersion: 1
    }
    payload.data = {
      ...historicalBody,
      surfaceHash: '01b061c42303751a9a5324532f1624d71c72ba1439dcaf93745aabb90a1bcbfc'
    }
    const meta = {
      tapeIncarnationId: '00000000-0000-4000-8000-000000000001',
      schemaVersion: 1,
      surfaceHashVersion: 1,
      runId: RUN_ID,
      manifestHash: '48bda5c7afaf7ddf9cdd8ce167e562c4044aafca5db21ca09f7e3b9ac9b3c9e0',
      fullCatalogHash: 'c7f53deaccaa834a4e05194ed183bafbccde596860d6b4865de5756a929e2053',
      surfaceHash: '01b061c42303751a9a5324532f1624d71c72ba1439dcaf93745aabb90a1bcbfc',
      contractBearing: true
    }
    row.payload_json = JSON.stringify(payload)
    row.meta_json = JSON.stringify(meta)

    expect(service.listToolSurfaceFactsByMessageRequest(SESSION_ID, MESSAGE_ID, 1)[0].fact).toEqual(
      payload.data
    )
  })

  it('recovers a fixed virtualized V1 fixture only as Native Activation', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    const result = appendToolSearchResult(table)
    const receipt = service.commitToolSurfaceView(createVirtualizedCommitInput(result))
    const row = table.getByEntryId(SESSION_ID, receipt.surface.entryId)
    const payload = JSON.parse(row.payload_json)
    const { adapterMode: _adapterMode, surfaceHash: _surfaceHash, ...currentBody } = payload.data
    payload.data = {
      ...currentBody,
      schemaVersion: 1,
      surfaceHashVersion: 1,
      surfaceHash: 'bc7d9b4eed1b07764689474500bc680e09dbde792065c3bc4d72e7206c0b6fe2'
    }
    row.payload_json = JSON.stringify(payload)
    row.meta_json = JSON.stringify({
      tapeIncarnationId: '00000000-0000-4000-8000-000000000001',
      schemaVersion: 1,
      surfaceHashVersion: 1,
      runId: RUN_ID,
      manifestHash: 'dc099f55c0332648bfa8efa4b002eff7f9d22dcbf4599ae25d07727568fa4a5a',
      fullCatalogHash: '307b4bf026f3cc9f12d31671fa6f67937df0490649efc471a67194a912a93324',
      surfaceHash: 'bc7d9b4eed1b07764689474500bc680e09dbde792065c3bc4d72e7206c0b6fe2',
      contractBearing: true
    })

    const records = service.listToolSurfaceFactsByMessageRequest(SESSION_ID, MESSAGE_ID, 2)
    expect(records).toHaveLength(1)
    expect(getTapeToolSurfaceAdapterMode(records[0].fact)).toBe('native-activation')
    expect('adapterMode' in records[0].fact).toBe(false)
  })

  it('keeps sessions without Tool Surface facts on the legacy recovery path', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)

    expect(service.listToolSurfaceFactsByMessage(SESSION_ID, MESSAGE_ID)).toEqual([])
    expect(service.listToolSurfaceFactsByMessageRequest(SESSION_ID, MESSAGE_ID, 1)).toEqual([])
  })

  it('fails recovery when a persisted surface payload no longer verifies', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    const receipt = service.commitToolSurfaceView(createCommitInput())
    const row = table.getByEntryId(SESSION_ID, receipt.surface.entryId)
    const payload = JSON.parse(row.payload_json)
    payload.data.policyVersion = 'tampered-policy'
    row.payload_json = JSON.stringify(payload)

    expect(() => service.listToolSurfaceFactsByMessageRequest(SESSION_ID, MESSAGE_ID, 1)).toThrow(
      ToolSurfaceProvenanceCorruptionError
    )
  })

  it('fails recovery when a surface belongs to another Tape incarnation', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    service.commitToolSurfaceView(createCommitInput())
    const anchor = table.getByEntryId(SESSION_ID, 1)
    const meta = JSON.parse(anchor.meta_json)
    meta.tapeIncarnationId = '00000000-0000-4000-8000-999999999999'
    anchor.meta_json = JSON.stringify(meta)

    expect(() => service.listToolSurfaceFactsByMessageRequest(SESSION_ID, MESSAGE_ID, 1)).toThrow(
      /canonical row validation/
    )
  })

  it('fails recovery when a surface loses its canonical catalog reference', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const receipt = service.commitToolSurfaceView(createCommitInput())
    entries.splice(
      entries.findIndex((entry) => entry.entry_id === receipt.catalog.entryId),
      1
    )

    expect(() => service.listToolSurfaceFactsByMessageRequest(SESSION_ID, MESSAGE_ID, 1)).toThrow(
      ToolSurfaceProvenanceCorruptionError
    )
  })

  it('reuses exact facts and one catalog fact across later Views in the same incarnation', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const firstInput = createCommitInput(1)

    const first = service.commitToolSurfaceView(firstInput)
    const repeated = service.commitToolSurfaceView(firstInput)
    const later = service.commitToolSurfaceView(createCommitInput(2))

    expect(repeated.manifest.created).toBe(false)
    expect(repeated.catalog.created).toBe(false)
    expect(repeated.surface.created).toBe(false)
    expect(repeated.surface.entryId).toBe(first.surface.entryId)
    expect(later.catalog.created).toBe(false)
    expect(later.catalog.entryId).toBe(first.catalog.entryId)
    expect(entries.filter((entry) => entry.name === TAPE_TOOL_CATALOG_EVENT_NAME)).toHaveLength(1)
    expect(entries.filter((entry) => entry.name === TAPE_TOOL_SURFACE_EVENT_NAME)).toHaveLength(2)
  })

  it('creates new physical facts after a Tape reset changes the incarnation', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createCommitInput()
    const first = service.commitToolSurfaceView(input)

    service.resetSessionTape(SESSION_ID)
    const afterReset = service.commitToolSurfaceView(input)

    expect(afterReset.tapeIncarnationId).not.toBe(first.tapeIncarnationId)
    expect(afterReset.catalog.created).toBe(true)
    expect(afterReset.surface.created).toBe(true)
    expect(afterReset.surface.surfaceHash).not.toBe(first.surface.surfaceHash)
  })

  it('treats the same surface identity with different content as corruption', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createCommitInput()
    service.commitToolSurfaceView(input)

    expect(() =>
      service.commitToolSurfaceView({
        ...input,
        surface: { ...input.surface, policyVersion: 'different-policy-v1' }
      })
    ).toThrow(ToolSurfaceProvenanceCorruptionError)
    expect(entries.filter((entry) => entry.name === TAPE_TOOL_SURFACE_EVENT_NAME)).toHaveLength(1)
  })

  it('rejects a conflicting manifest for an existing request identity', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createCommitInput()
    service.commitToolSurfaceView(input)

    const conflicting = createCommitInput(1, 'Different prompt')

    expect(() => service.commitToolSurfaceView(conflicting)).toThrow(
      ToolSurfaceProvenanceCorruptionError
    )
    expect(entries.filter((entry) => entry.name === 'view/assembled')).toHaveLength(1)
  })

  it('rolls back the manifest and catalog when the surface append fails', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const append = table.appendToolSurfaceEvent.getMockImplementation()!
    table.appendToolSurfaceEvent.mockImplementationOnce(append).mockImplementationOnce(() => {
      throw new Error('surface write failed')
    })

    expect(() => service.commitToolSurfaceView(createCommitInput())).toThrow(
      ToolSurfaceProvenanceError
    )
    expect(entries).toEqual([])
  })

  it('fails closed when the existing Tape has no canonical incarnation', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    table.appendAnchor({
      sessionId: SESSION_ID,
      name: 'session/start',
      source: { type: 'session', id: SESSION_ID, seq: 0 },
      state: { owner: 'human' },
      meta: {}
    })

    expect(() => service.commitToolSurfaceView(createCommitInput())).toThrow(
      ToolSurfaceProvenanceCorruptionError
    )
    expect(entries).toHaveLength(1)
  })

  it('binds ToolSearch activation to an earlier physical result fact', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const result = appendToolSearchResult(table)

    const receipt = service.commitToolSurfaceView(createVirtualizedCommitInput(result))

    expect(receipt.surface.created).toBe(true)
    expect(entries.filter((entry) => entry.name === TAPE_TOOL_SURFACE_EVENT_NAME)).toHaveLength(1)
  })

  it('rejects ToolSearch activation whose physical result hash does not match', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const result = appendToolSearchResult(table)

    expect(() =>
      service.commitToolSurfaceView(
        createVirtualizedCommitInput({ ...result, payloadHash: '0'.repeat(64) })
      )
    ).toThrow(ToolSurfaceProvenanceError)
    expect(entries.map((entry) => entry.name)).toEqual(['session/start', 'tool_search'])
  })

  it('rejects an unsuccessful physical ToolSearch result', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const result = appendToolSearchResult(table)
    table.getByEntryId(SESSION_ID, result.entryId).meta_json = JSON.stringify({ status: 'error' })

    expect(() => service.commitToolSurfaceView(createVirtualizedCommitInput(result))).toThrow(
      ToolSurfaceProvenanceError
    )
    expect(entries.map((entry) => entry.name)).toEqual(['session/start', 'tool_search'])
  })

  it('rejects ToolSearch activation outside the manifest Tape head', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const result = appendToolSearchResult(table)

    expect(() =>
      service.commitToolSurfaceView(createVirtualizedCommitInput(result, result.entryId - 1))
    ).toThrow(ToolSurfaceProvenanceError)
    expect(entries.map((entry) => entry.name)).toEqual(['session/start', 'tool_search'])
  })

  it('rejects a ToolSearch rank that names a different result', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const result = appendToolSearchResult(table)
    const input = createVirtualizedCommitInput(result)
    input.surface.searchResultRefs[0].resultRank = 1

    expect(() => service.commitToolSurfaceView(input)).toThrow(ToolSurfaceProvenanceError)
    expect(entries.map((entry) => entry.name)).toEqual(['session/start', 'tool_search'])
  })

  it('rejects ToolSearch evidence outside the eligible catalog before writing', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const result = appendToolSearchResult(table)
    const input = createVirtualizedCommitInput(result)
    const outsideCatalog = buildCanonicalToolCatalog([PROGRAMMATIC_TOOL]).entries[0]
    const altered = {
      ...input,
      surface: {
        ...input.surface,
        candidateRejections: [
          {
            originRequestSeq: 1,
            toolCallOrdinalWithinBatch: 0,
            resultRank: 0,
            stableTargetKey: outsideCatalog.stableTargetKey,
            canonicalToolDefinitionHash: outsideCatalog.canonicalToolDefinitionHash,
            toolResult: {
              sessionId: SESSION_ID,
              tapeIncarnationId: result.tapeIncarnationId,
              entryId: result.entryId,
              payloadHashVersion: 1 as const,
              payloadHash: result.payloadHash
            },
            rejectionCode: 'ineligible' as const
          }
        ]
      }
    } satisfies Parameters<typeof service.commitToolSurfaceView>[0]

    expect(() => service.commitToolSurfaceView(altered)).toThrow(ToolSurfaceProvenanceError)
    expect(entries.map((entry) => entry.name)).toEqual(['session/start', 'tool_search'])
    expect(table.runInTransaction).not.toHaveBeenCalled()
  })

  it('rejects active evidence that disagrees with the strict contract before writing', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createCommitInput()
    const altered = {
      ...structuredClone(input),
      surface: {
        ...structuredClone(input.surface),
        activeEntries: input.surface.activeEntries.map((entry, index) =>
          index === 0 ? { ...entry, execution: TOOL_EXECUTION.write } : entry
        )
      }
    }

    expect(() => service.commitToolSurfaceView(altered)).toThrow(ToolSurfaceProvenanceError)
    expect(entries).toEqual([])
    expect(table.runInTransaction).not.toHaveBeenCalled()
  })

  it('rejects definitions that did not produce the manifest before writing', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createCommitInput()
    const altered = structuredClone(input)
    altered.activeToolDefinitions[0].function.description = 'A different provider-visible schema'

    expect(() => service.commitToolSurfaceView(altered)).toThrow(ToolSurfaceProvenanceError)
    expect(entries).toEqual([])
    expect(table.runInTransaction).not.toHaveBeenCalled()
  })

  it('owns the transaction boundary instead of nesting inside a caller transaction', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)

    expect(() =>
      table.runInTransaction(() => service.commitToolSurfaceView(createCommitInput()))
    ).toThrow(ToolSurfaceProvenanceError)
  })

  it('rejects an exact surface persisted before its manifest or catalog', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = createCommitInput()
    service.commitToolSurfaceView(input)
    const surface = entries.find((entry) => entry.name === TAPE_TOOL_SURFACE_EVENT_NAME)!
    surface.entry_id = 2

    expect(() => service.commitToolSurfaceView(input)).toThrow(ToolSurfaceProvenanceCorruptionError)
  })

  itIfSqlite('enforces canonical idempotency with the SQLite persistence adapter', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatTapeEntriesTable(db)
      table.createTable()
      const service = createTapeService(table)
      const input = createCommitInput()

      const first = service.commitToolSurfaceView(input)
      const repeated = service.commitToolSurfaceView(input)
      const rows = table.getBySession(SESSION_ID)

      expect(repeated.surface.entryId).toBe(first.surface.entryId)
      expect(rows.filter((row) => row.name === TAPE_TOOL_CATALOG_EVENT_NAME)).toHaveLength(1)
      expect(rows.filter((row) => row.name === TAPE_TOOL_SURFACE_EVENT_NAME)).toHaveLength(1)
      expect(
        table.getEventsBySource(
          SESSION_ID,
          TAPE_TOOL_SURFACE_EVENT_NAME,
          'runtime_event',
          MESSAGE_ID,
          1
        )
      ).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  itIfSqlite('persists Programmatic View facts idempotently with the SQLite adapter', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatTapeEntriesTable(db)
      table.createTable()
      const service = createTapeService(table)
      const input = createProgrammaticCommitInput()

      const first = service.commitToolSurfaceView(input)
      const repeated = service.commitToolSurfaceView(input)
      const rows = table.getBySession(SESSION_ID)

      expect(repeated.programmaticSurface).toEqual({
        ...first.programmaticSurface,
        created: false
      })
      expect(rows.filter((row) => row.name === TAPE_TOOL_SURFACE_EVENT_NAME)).toHaveLength(1)
      expect(
        rows.filter((row) => row.name === TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME)
      ).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  itIfSqlite('keeps Tool Surface facts out of linked SQL search and context', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatTapeEntriesTable(db)
      table.createTable()
      table.ensureBootstrapAnchor(SESSION_ID)
      const contextBefore = table.appendEvent({
        sessionId: SESSION_ID,
        name: 'context/before',
        data: { marker: 'linked-context-marker' }
      })
      createTapeService(table).commitToolSurfaceView(createProgrammaticCommitInput())
      table.appendEvent({
        sessionId: SESSION_ID,
        name: 'context/after',
        data: { marker: 'linked-context-marker' }
      })
      const source = {
        sessionId: SESSION_ID,
        maxEntryId: table.getMaxEntryId(SESSION_ID)
      }

      expect(table.searchEffectiveSourcesAtHeads([source], 'view/tool')).toEqual([])
      expect(table.searchEffectiveSourcesAtHeads([source], 'programmatic_tool_surface')).toEqual([])
      const contextNames = table
        .getEffectiveContextRowsAtHead(source, [contextBefore.entry_id], {
          before: 0,
          after: 20,
          limit: 30
        })
        .map((row) => row.name)
      expect(contextNames).toContain('context/before')
      expect(contextNames).toContain('context/after')
      expect(contextNames).not.toContain(TAPE_TOOL_CATALOG_EVENT_NAME)
      expect(contextNames).not.toContain(TAPE_TOOL_SURFACE_EVENT_NAME)
      expect(contextNames).not.toContain(TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME)
    } finally {
      db.close()
    }
  })

  itIfSqlite('rolls back all View facts when the SQLite surface append fails', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatTapeEntriesTable(db)
      table.createTable()
      db.exec(`
        CREATE TRIGGER fail_tool_surface_insert
        BEFORE INSERT ON deepchat_tape_entries
        WHEN NEW.name = '${TAPE_TOOL_SURFACE_EVENT_NAME}'
        BEGIN
          SELECT RAISE(ABORT, 'surface write failed');
        END;
      `)
      const service = createTapeService(table)

      expect(() => service.commitToolSurfaceView(createCommitInput())).toThrow(
        ToolSurfaceProvenanceError
      )
      expect(table.getBySession(SESSION_ID)).toEqual([])
    } finally {
      db.close()
    }
  })

  itIfSqlite('rolls back all View facts when the SQLite Programmatic append fails', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatTapeEntriesTable(db)
      table.createTable()
      db.exec(`
        CREATE TRIGGER fail_programmatic_tool_surface_insert
        BEFORE INSERT ON deepchat_tape_entries
        WHEN NEW.name = '${TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME}'
        BEGIN
          SELECT RAISE(ABORT, 'programmatic surface write failed');
        END;
      `)
      const service = createTapeService(table)

      expect(() => service.commitToolSurfaceView(createProgrammaticCommitInput())).toThrow(
        ToolSurfaceProvenanceError
      )
      expect(table.getBySession(SESSION_ID)).toEqual([])
    } finally {
      db.close()
    }
  })
})
