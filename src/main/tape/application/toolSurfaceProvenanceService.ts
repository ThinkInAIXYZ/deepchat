import type { DeepChatTapeViewManifest } from '@shared/types/tape-view-manifest'
import { TOOL_SEARCH_AGENT_TOOL_NAME } from '@shared/agentTools'
import { stripToolExecutionContract, type MCPToolDefinition } from '@shared/types/core/mcp'
import { canonicalJsonStringifyData } from '../domain/canonicalJson'
import { type DeepChatTapeEntryRow, type TapeEventAppendInput } from '../domain/entry'
import {
  buildExecutionToolCeiling,
  buildExecutionToolTargetKey,
  buildProviderVisibleToolDefinitionsHash
} from '../domain/executionContract'
import {
  TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME,
  TAPE_TOOL_CATALOG_EVENT_NAME,
  TAPE_TOOL_SURFACE_EVENT_NAME,
  buildTapeToolResultPayloadHash,
  createTapeProgrammaticToolSurfaceFact,
  createTapeToolCatalogFact,
  createTapeToolSurfaceFact,
  type CreateTapeProgrammaticToolSurfaceFactInput,
  type CreateTapeToolCatalogFactInput,
  type CreateTapeToolSurfaceFactInput,
  type TapeProgrammaticToolSurfaceFact,
  type TapeToolCatalogFact,
  type TapeToolCatalogFactReference,
  type TapeToolCatalogSourceEntry,
  type TapeToolSurfaceActiveEntry,
  type TapeToolSurfaceFact,
  type TapeToolSurfaceFactV2,
  verifyTapeToolCatalogFact,
  verifyTapeToolSurfaceFact
} from '../domain/toolSurfaceFacts'
import {
  TAPE_VIEW_MANIFEST_EVENT_NAME,
  getTapeViewManifestExecutionContract,
  hashJson,
  verifyTapeViewManifestHash
} from '../domain/viewManifest'
import type { TapeApplicationEntryStore, TapeApplicationProviders } from '../ports/application'
import type {
  CommitTapeToolSurfaceViewInput,
  TapeToolSurfaceFactRecord,
  TapeToolSurfaceViewCommitReceipt,
  TapeToolSurfaceViewReader,
  TapeToolSurfaceViewWriter
} from '../ports/capabilities'
import { readCanonicalTapeIncarnationId } from './common'
import { buildTapeViewManifestProvenanceKey, type TapeViewReplayService } from './viewReplayService'

export type ToolSurfaceProvenanceErrorCode = 'invalid_input' | 'corruption' | 'persistence_failed'

export class ToolSurfaceProvenanceError extends Error {
  constructor(
    message: string,
    readonly code: ToolSurfaceProvenanceErrorCode,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ToolSurfaceProvenanceError'
  }
}

export class ToolSurfaceProvenanceCorruptionError extends ToolSurfaceProvenanceError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'corruption', options)
    this.name = 'ToolSurfaceProvenanceCorruptionError'
  }
}

type ToolSurfaceProvenanceProviders = Pick<TapeApplicationProviders, 'getEntryStore'>

type PreparedCommitInput = {
  readonly manifest: DeepChatTapeViewManifest
  readonly catalog: TapeToolCatalogFact
  readonly surface: Omit<CreateTapeToolSurfaceFactInput, 'manifestHash' | 'catalog'>
  readonly programmaticSurface: Omit<
    CreateTapeProgrammaticToolSurfaceFactInput,
    'manifestHash' | 'catalog' | 'contractBearing'
  > | null
}

type CanonicalEventInput = Omit<TapeEventAppendInput, 'name'> & {
  readonly name:
    | typeof TAPE_TOOL_CATALOG_EVENT_NAME
    | typeof TAPE_TOOL_SURFACE_EVENT_NAME
    | typeof TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME
  readonly source: NonNullable<TapeEventAppendInput['source']>
  readonly provenanceKey: string
}

function canonicalJsonEquals(raw: string, expected: unknown): boolean {
  try {
    return canonicalJsonStringifyData(JSON.parse(raw)) === canonicalJsonStringifyData(expected)
  } catch {
    return false
  }
}

function canonicalEventRowMatches(
  row: DeepChatTapeEntryRow,
  input: CanonicalEventInput,
  options: { ignoreCreatedAt?: boolean } = {}
): boolean {
  return (
    row.session_id === input.sessionId &&
    row.kind === 'event' &&
    row.name === input.name &&
    row.source_type === input.source.type &&
    row.source_id === input.source.id &&
    row.source_seq === (input.source.seq ?? null) &&
    row.provenance_key === input.provenanceKey &&
    (options.ignoreCreatedAt === true || row.created_at === input.createdAt) &&
    canonicalJsonEquals(row.payload_json, { name: input.name, data: input.data }) &&
    canonicalJsonEquals(row.meta_json, input.meta ?? {})
  )
}

function manifestRowMatches(
  row: DeepChatTapeEntryRow,
  manifest: DeepChatTapeViewManifest
): boolean {
  return (
    row.session_id === manifest.sessionId &&
    row.kind === 'event' &&
    row.name === TAPE_VIEW_MANIFEST_EVENT_NAME &&
    row.source_type === 'runtime_event' &&
    row.source_id === manifest.messageId &&
    row.source_seq === manifest.requestSeq &&
    row.provenance_key === buildTapeViewManifestProvenanceKey(manifest) &&
    row.created_at === manifest.assembledAt &&
    canonicalJsonEquals(row.payload_json, {
      name: TAPE_VIEW_MANIFEST_EVENT_NAME,
      data: { manifest }
    }) &&
    canonicalJsonEquals(row.meta_json, {
      viewId: manifest.viewId,
      requestSeq: manifest.requestSeq,
      taskType: manifest.taskType,
      policy: manifest.policy,
      policyVersion: manifest.policyVersion
    })
  )
}

function rowHasSurfaceRequestIdentity(
  row: DeepChatTapeEntryRow,
  request: CreateTapeToolSurfaceFactInput['request']
): boolean {
  try {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>
    const data = payload.data as Record<string, unknown> | undefined
    return (
      row.kind === 'event' &&
      row.name === TAPE_TOOL_SURFACE_EVENT_NAME &&
      data !== undefined &&
      canonicalJsonStringifyData(data.request) === canonicalJsonStringifyData(request)
    )
  } catch {
    return false
  }
}

function catalogProvenanceKey(tapeIncarnationId: string, fullCatalogHash: string): string {
  return `view:tool-catalog:v1:${tapeIncarnationId}:${fullCatalogHash}`
}

function surfaceProvenanceKey(
  tapeIncarnationId: string,
  request: CreateTapeToolSurfaceFactInput['request']
): string {
  return `view:tool-surface:v1:${tapeIncarnationId}:${request.sessionId}:${request.messageId}:${request.runId}:${request.requestSeq}`
}

function programmaticSurfaceProvenanceKey(
  tapeIncarnationId: string,
  request: CreateTapeProgrammaticToolSurfaceFactInput['request']
): string {
  return `view:programmatic-tool-surface:v1:${tapeIncarnationId}:${request.sessionId}:${request.messageId}:${request.runId}:${request.requestSeq}`
}

function sameCatalogEntry(
  left: TapeToolCatalogSourceEntry,
  right: TapeToolCatalogSourceEntry | TapeToolSurfaceActiveEntry
): boolean {
  return (
    left.stableTargetKey === right.stableTargetKey &&
    left.canonicalToolDefinitionHash === right.canonicalToolDefinitionHash &&
    left.exposure === right.exposure &&
    canonicalJsonStringifyData(left.target) === canonicalJsonStringifyData(right.target) &&
    canonicalJsonStringifyData(left.execution) === canonicalJsonStringifyData(right.execution)
  )
}

function assertSurfaceMatchesCatalog(
  catalog: CreateTapeToolCatalogFactInput,
  surface: PreparedCommitInput['surface']
): void {
  if (
    surface.canonicalizationVersion !== catalog.canonicalizationVersion ||
    surface.budget.eligibleToolCount !== catalog.entries.length
  ) {
    throw new TypeError('Tool surface does not match its eligible catalog observation.')
  }
  const catalogByTarget = new Map(catalog.entries.map((entry) => [entry.stableTargetKey, entry]))
  for (const active of surface.activeEntries) {
    const catalogEntry = catalogByTarget.get(active.stableTargetKey)
    if (!catalogEntry || !sameCatalogEntry(catalogEntry, active)) {
      throw new TypeError('Tool surface active entry does not match its eligible catalog.')
    }
  }
  const searchEvidence = [
    ...(surface.searchResultRefs ?? []),
    ...(surface.candidateRejections ?? [])
  ]
  for (const evidence of searchEvidence) {
    const catalogEntry = catalogByTarget.get(evidence.stableTargetKey)
    if (
      !catalogEntry ||
      catalogEntry.canonicalToolDefinitionHash !== evidence.canonicalToolDefinitionHash
    ) {
      throw new TypeError('ToolSearch evidence does not match its eligible catalog.')
    }
  }
}

function assertSurfaceMatchesManifest(
  manifest: DeepChatTapeViewManifest,
  surface: PreparedCommitInput['surface'],
  activeToolDefinitions: readonly MCPToolDefinition[]
): void {
  const request = surface.request
  const executionContract = getTapeViewManifestExecutionContract(manifest)
  if (
    request.sessionId !== manifest.sessionId ||
    request.messageId !== manifest.messageId ||
    request.requestSeq !== manifest.requestSeq ||
    surface.contractBearing !== Boolean(executionContract)
  ) {
    throw new TypeError('Tool surface request identity does not match its View manifest.')
  }
  const toolDefinitionsHash =
    manifest.schemaVersion === 5 || manifest.schemaVersion === 6 || manifest.schemaVersion === 7
      ? buildProviderVisibleToolDefinitionsHash(activeToolDefinitions)
      : hashJson(activeToolDefinitions.map(stripToolExecutionContract))
  if (
    toolDefinitionsHash !== manifest.hashes.toolDefinitionsHash ||
    activeToolDefinitions.length !== surface.activeEntries.length
  ) {
    throw new TypeError('Tool surface definitions do not match their View manifest.')
  }
  const activeByTarget = new Map(
    surface.activeEntries.map((entry) => [entry.stableTargetKey, entry])
  )
  for (const definition of activeToolDefinitions) {
    const ceiling = buildExecutionToolCeiling(definition)
    const key = buildExecutionToolTargetKey(ceiling.target)
    const active = activeByTarget.get(key)
    if (
      !active ||
      active.canonicalToolDefinitionHash !==
        buildProviderVisibleToolDefinitionsHash([definition]) ||
      canonicalJsonStringifyData(active.target) !== canonicalJsonStringifyData(ceiling.target) ||
      canonicalJsonStringifyData(active.execution) !== canonicalJsonStringifyData(ceiling.execution)
    ) {
      throw new TypeError('Tool surface definition does not match its active evidence.')
    }
  }
  if (!executionContract) return

  const contractRequest = executionContract.request
  if (canonicalJsonStringifyData(contractRequest) !== canonicalJsonStringifyData(request)) {
    throw new TypeError('Tool surface request identity does not match its ExecutionContract.')
  }
  if (executionContract.ceilings.tools.length !== surface.activeEntries.length) {
    throw new TypeError('Tool surface active set does not match its ExecutionContract ceiling.')
  }
  for (const ceiling of executionContract.ceilings.tools) {
    const key = buildExecutionToolTargetKey(ceiling.target)
    const active = activeByTarget.get(key)
    if (
      !active ||
      canonicalJsonStringifyData(active.target) !== canonicalJsonStringifyData(ceiling.target) ||
      canonicalJsonStringifyData(active.execution) !== canonicalJsonStringifyData(ceiling.execution)
    ) {
      throw new TypeError(
        'Tool surface active target does not match its ExecutionContract ceiling.'
      )
    }
  }
}

function assertProgrammaticSurfaceMatchesView(
  manifest: DeepChatTapeViewManifest,
  catalog: CreateTapeToolCatalogFactInput,
  surface: PreparedCommitInput['surface'],
  programmaticSurface: NonNullable<PreparedCommitInput['programmaticSurface']>
): void {
  if (
    canonicalJsonStringifyData(programmaticSurface.request) !==
      canonicalJsonStringifyData(surface.request) ||
    programmaticSurface.canonicalizationVersion !== catalog.canonicalizationVersion ||
    programmaticSurface.policyVersion !== surface.policyVersion
  ) {
    throw new TypeError('Programmatic Tool Surface does not belong to its provider View.')
  }
  const manifestTaskContractRef =
    getTapeViewManifestExecutionContract(manifest)?.provenance.taskContractRef ?? null
  if (
    canonicalJsonStringifyData(programmaticSurface.taskContractRef) !==
    canonicalJsonStringifyData(manifestTaskContractRef)
  ) {
    throw new TypeError('Programmatic Tool Surface does not match its View TaskContract.')
  }

  const activeTargets = new Set(surface.activeEntries.map((entry) => entry.stableTargetKey))
  if (
    catalog.entries.some(
      (entry) => entry.target.source === 'agent' && !activeTargets.has(entry.stableTargetKey)
    )
  ) {
    throw new TypeError('CLI Programmatic provider surface does not include every Agent tool.')
  }
  const expectedEntries = catalog.entries.filter(
    (entry) => entry.target.source === 'mcp' && !activeTargets.has(entry.stableTargetKey)
  )
  if (programmaticSurface.entries.length !== expectedEntries.length) {
    throw new TypeError('Programmatic Tool Surface is not the complete out-of-band MCP surface.')
  }
  const programmaticByTarget = new Map(
    programmaticSurface.entries.map((entry) => [entry.stableTargetKey, entry])
  )
  if (programmaticByTarget.size !== programmaticSurface.entries.length) {
    throw new TypeError('Programmatic Tool Surface contains a duplicate target.')
  }
  for (const expected of expectedEntries) {
    const programmatic = programmaticByTarget.get(expected.stableTargetKey)
    if (!programmatic || !sameCatalogEntry(expected, programmatic)) {
      throw new TypeError('Programmatic Tool Surface does not match its eligible catalog.')
    }
  }
}

function assertToolSearchResultReferences(
  table: TapeApplicationEntryStore,
  manifest: DeepChatTapeViewManifest,
  manifestRow: DeepChatTapeEntryRow,
  tapeIncarnationId: string,
  surface: PreparedCommitInput['surface'],
  catalog: TapeToolCatalogFact
): void {
  const refs = [...(surface.searchResultRefs ?? []), ...(surface.candidateRejections ?? [])]
  const parsedResultByEntryId = new Map<
    number,
    { payload: Record<string, unknown>; results: readonly Record<string, unknown>[] }
  >()
  for (const ref of refs) {
    if (
      ref.toolResult.sessionId !== surface.request.sessionId ||
      ref.toolResult.tapeIncarnationId !== tapeIncarnationId ||
      ref.toolResult.entryId > manifest.latestEntryId ||
      ref.toolResult.entryId >= manifestRow.entry_id
    ) {
      throw new ToolSurfaceProvenanceError(
        'ToolSearch activation references a result outside its originating Tape View.',
        'invalid_input'
      )
    }
    let parsedResult = parsedResultByEntryId.get(ref.toolResult.entryId)
    if (!parsedResult) {
      const row = table.getByEntryId(surface.request.sessionId, ref.toolResult.entryId)
      if (
        !row ||
        row.kind !== 'tool_result' ||
        row.name !== TOOL_SEARCH_AGENT_TOOL_NAME ||
        row.source_type !== 'tool_result'
      ) {
        throw new ToolSurfaceProvenanceError(
          'ToolSearch activation references a missing or non-ToolSearch result fact.',
          'invalid_input'
        )
      }
      let payload: Record<string, unknown>
      let meta: Record<string, unknown>
      let results: readonly Record<string, unknown>[]
      try {
        const parsedPayload = JSON.parse(row.payload_json) as unknown
        const parsedMeta = JSON.parse(row.meta_json) as unknown
        if (
          !parsedPayload ||
          typeof parsedPayload !== 'object' ||
          Array.isArray(parsedPayload) ||
          !parsedMeta ||
          typeof parsedMeta !== 'object' ||
          Array.isArray(parsedMeta)
        ) {
          throw new TypeError()
        }
        payload = parsedPayload as Record<string, unknown>
        meta = parsedMeta as Record<string, unknown>
        if (typeof payload.response !== 'string') throw new TypeError()
        const response = JSON.parse(payload.response) as { results?: unknown }
        if (!Array.isArray(response.results)) throw new TypeError()
        results = response.results.map((result) => {
          if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError()
          return result as Record<string, unknown>
        })
      } catch (error) {
        throw new ToolSurfaceProvenanceCorruptionError(
          'ToolSearch activation references a malformed result fact.',
          { cause: error }
        )
      }
      if (
        meta.status !== 'success' ||
        payload.messageId !== surface.request.messageId ||
        typeof payload.toolCallId !== 'string' ||
        row.source_id !== `${surface.request.messageId}:${payload.toolCallId}`
      ) {
        throw new ToolSurfaceProvenanceError(
          'ToolSearch activation references an unsuccessful or unrelated result fact.',
          'invalid_input'
        )
      }
      parsedResult = { payload, results }
      parsedResultByEntryId.set(ref.toolResult.entryId, parsedResult)
    }
    if (buildTapeToolResultPayloadHash(parsedResult.payload) !== ref.toolResult.payloadHash) {
      throw new ToolSurfaceProvenanceError(
        'ToolSearch activation result hash does not match its physical fact.',
        'invalid_input'
      )
    }
    const result = parsedResult.results[ref.resultRank]
    const catalogEntry =
      surface.activeEntries.find((entry) => entry.stableTargetKey === ref.stableTargetKey) ??
      catalog.entries.find((entry) => entry.stableTargetKey === ref.stableTargetKey)
    let providerVisibleName: string | null = catalogEntry?.target.providerVisibleName ?? null
    if (providerVisibleName === null) {
      try {
        const target = JSON.parse(ref.stableTargetKey) as { providerVisibleName?: unknown }
        providerVisibleName =
          typeof target.providerVisibleName === 'string' ? target.providerVisibleName : null
      } catch {}
    }
    if (
      !result ||
      providerVisibleName === null ||
      result.name !== providerVisibleName ||
      (catalogEntry && result.effect !== catalogEntry.execution.effect) ||
      result.state !== 'pending'
    ) {
      throw new ToolSurfaceProvenanceError(
        'ToolSearch activation rank does not identify its referenced target.',
        'invalid_input'
      )
    }
  }
}

function prepareCommitInput(input: CommitTapeToolSurfaceViewInput): PreparedCommitInput {
  if (verifyTapeViewManifestHash(input.manifest) !== 'valid') {
    throw new TypeError('Tool surface View manifest is not hash-valid.')
  }
  if (input.programmaticSurface === undefined) {
    throw new TypeError('Programmatic Tool Surface applicability must be explicit.')
  }
  if ((input.surface.adapterMode === 'cli-programmatic') !== (input.programmaticSurface !== null)) {
    throw new TypeError('Programmatic Tool Surface applicability does not match its adapter mode.')
  }
  assertSurfaceMatchesCatalog(input.catalog, input.surface)
  assertSurfaceMatchesManifest(input.manifest, input.surface, input.activeToolDefinitions)
  if (input.programmaticSurface !== null) {
    assertProgrammaticSurfaceMatchesView(
      input.manifest,
      input.catalog,
      input.surface,
      input.programmaticSurface
    )
  }
  return {
    manifest: input.manifest,
    catalog: createTapeToolCatalogFact(input.catalog),
    surface: input.surface,
    programmaticSurface: input.programmaticSurface
  }
}

function catalogEventInput(
  manifest: DeepChatTapeViewManifest,
  tapeIncarnationId: string,
  fact: TapeToolCatalogFact
): CanonicalEventInput {
  return {
    sessionId: manifest.sessionId,
    name: TAPE_TOOL_CATALOG_EVENT_NAME,
    source: { type: 'runtime_event', id: fact.fullCatalogHash, seq: 0 },
    provenanceKey: catalogProvenanceKey(tapeIncarnationId, fact.fullCatalogHash),
    data: { ...fact },
    meta: {
      tapeIncarnationId,
      schemaVersion: fact.schemaVersion,
      catalogFactHashVersion: fact.catalogFactHashVersion,
      fullCatalogHash: fact.fullCatalogHash,
      catalogFactHash: fact.catalogFactHash
    },
    createdAt: manifest.assembledAt,
    idempotent: true
  }
}

function surfaceEventInput(
  manifest: DeepChatTapeViewManifest,
  tapeIncarnationId: string,
  fact: TapeToolSurfaceFactV2
): CanonicalEventInput {
  return {
    sessionId: manifest.sessionId,
    name: TAPE_TOOL_SURFACE_EVENT_NAME,
    source: {
      type: 'runtime_event',
      id: manifest.messageId,
      seq: manifest.requestSeq
    },
    provenanceKey: surfaceProvenanceKey(tapeIncarnationId, fact.request),
    data: { ...fact },
    meta: {
      tapeIncarnationId,
      schemaVersion: fact.schemaVersion,
      surfaceHashVersion: fact.surfaceHashVersion,
      runId: fact.request.runId,
      manifestHash: fact.manifestHash,
      fullCatalogHash: fact.catalog.fullCatalogHash,
      surfaceHash: fact.surfaceHash,
      adapterMode: fact.adapterMode,
      contractBearing: fact.contractBearing
    },
    createdAt: manifest.assembledAt,
    idempotent: true
  }
}

function programmaticSurfaceEventInput(
  manifest: DeepChatTapeViewManifest,
  tapeIncarnationId: string,
  fact: TapeProgrammaticToolSurfaceFact
): CanonicalEventInput {
  return {
    sessionId: manifest.sessionId,
    name: TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME,
    source: {
      type: 'runtime_event',
      id: manifest.messageId,
      seq: manifest.requestSeq
    },
    provenanceKey: programmaticSurfaceProvenanceKey(tapeIncarnationId, fact.request),
    data: { ...fact },
    meta: {
      tapeIncarnationId,
      schemaVersion: fact.schemaVersion,
      factHashVersion: fact.factHashVersion,
      runId: fact.request.runId,
      manifestHash: fact.manifestHash,
      fullCatalogHash: fact.catalog.fullCatalogHash,
      capabilityHash: fact.capabilityHash,
      programmaticSurfaceHash: fact.programmaticSurfaceHash,
      projectionHash: fact.projectionHash,
      factHash: fact.factHash,
      contractBearing: fact.contractBearing
    },
    createdAt: manifest.assembledAt,
    idempotent: true
  }
}

function parsePersistedSurfaceFact(row: DeepChatTapeEntryRow): TapeToolSurfaceFact {
  try {
    const payload = JSON.parse(row.payload_json) as { name?: unknown; data?: unknown }
    if (payload.name !== TAPE_TOOL_SURFACE_EVENT_NAME || !verifyTapeToolSurfaceFact(payload.data)) {
      throw new TypeError('invalid Tool Surface fact payload')
    }
    const fact = payload.data
    if (
      row.session_id !== fact.request.sessionId ||
      row.kind !== 'event' ||
      row.name !== TAPE_TOOL_SURFACE_EVENT_NAME ||
      row.source_type !== 'runtime_event' ||
      row.source_id !== fact.request.messageId ||
      row.source_seq !== fact.request.requestSeq
    ) {
      throw new TypeError('Tool Surface fact row identity does not match its payload')
    }
    return fact
  } catch (error) {
    throw new ToolSurfaceProvenanceCorruptionError(
      `Tool surface entry ${row.entry_id} failed recovery validation.`,
      { cause: error }
    )
  }
}

function parsePersistedCatalogFact(row: DeepChatTapeEntryRow): TapeToolCatalogFact {
  try {
    const payload = JSON.parse(row.payload_json) as { name?: unknown; data?: unknown }
    if (payload.name !== TAPE_TOOL_CATALOG_EVENT_NAME || !verifyTapeToolCatalogFact(payload.data)) {
      throw new TypeError('invalid Tool Catalog fact payload')
    }
    return payload.data
  } catch (error) {
    throw new ToolSurfaceProvenanceCorruptionError(
      `Tool catalog entry ${row.entry_id} failed recovery validation.`,
      { cause: error }
    )
  }
}

export class ToolSurfaceProvenanceService
  implements TapeToolSurfaceViewWriter, TapeToolSurfaceViewReader
{
  constructor(
    private readonly providers: ToolSurfaceProvenanceProviders,
    private readonly viewReplay: TapeViewReplayService
  ) {}

  listToolSurfaceFactsByMessage(sessionId: string, messageId: string): TapeToolSurfaceFactRecord[] {
    const normalizedSessionId = sessionId.trim()
    const normalizedMessageId = messageId.trim()
    if (!normalizedSessionId || !normalizedMessageId) {
      throw new ToolSurfaceProvenanceError(
        'Tool surface recovery identity is invalid.',
        'invalid_input'
      )
    }
    const table = this.providers.getEntryStore()
    return this.parseRecoveryRows(
      normalizedSessionId,
      normalizedMessageId,
      table.getEventsBySourceId(
        normalizedSessionId,
        TAPE_TOOL_SURFACE_EVENT_NAME,
        'runtime_event',
        normalizedMessageId
      )
    )
  }

  listToolSurfaceFactsByMessageRequest(
    sessionId: string,
    messageId: string,
    requestSeq: number
  ): TapeToolSurfaceFactRecord[] {
    const normalizedSessionId = sessionId.trim()
    const normalizedMessageId = messageId.trim()
    if (
      !normalizedSessionId ||
      !normalizedMessageId ||
      !Number.isSafeInteger(requestSeq) ||
      requestSeq <= 0
    ) {
      throw new ToolSurfaceProvenanceError(
        'Tool surface recovery identity is invalid.',
        'invalid_input'
      )
    }
    const table = this.providers.getEntryStore()
    return this.parseRecoveryRows(
      normalizedSessionId,
      normalizedMessageId,
      table.getEventsBySource(
        normalizedSessionId,
        TAPE_TOOL_SURFACE_EVENT_NAME,
        'runtime_event',
        normalizedMessageId,
        requestSeq
      )
    )
  }

  private parseRecoveryRows(
    sessionId: string,
    messageId: string,
    rows: DeepChatTapeEntryRow[]
  ): TapeToolSurfaceFactRecord[] {
    if (rows.length === 0) return []
    const table = this.providers.getEntryStore()
    const firstEntry = table.getFirstEntriesBySessions([sessionId])[0]
    const tapeIncarnationId = firstEntry ? readCanonicalTapeIncarnationId(firstEntry) : null
    if (!tapeIncarnationId) {
      throw new ToolSurfaceProvenanceCorruptionError(
        `Session ${sessionId} has no canonical Tape incarnation.`
      )
    }
    const records = rows.map((row) => ({
      entryId: row.entry_id,
      fact: parsePersistedSurfaceFact(row)
    }))
    for (let index = 0; index < records.length; index += 1) {
      const row = rows[index]
      const { fact } = records[index]
      const expectedMeta = {
        tapeIncarnationId,
        schemaVersion: fact.schemaVersion,
        surfaceHashVersion: fact.surfaceHashVersion,
        runId: fact.request.runId,
        manifestHash: fact.manifestHash,
        fullCatalogHash: fact.catalog.fullCatalogHash,
        surfaceHash: fact.surfaceHash,
        ...('adapterMode' in fact ? { adapterMode: fact.adapterMode } : {}),
        contractBearing: fact.contractBearing
      }
      if (
        fact.catalog.sessionId !== sessionId ||
        fact.catalog.tapeIncarnationId !== tapeIncarnationId ||
        row.provenance_key !== surfaceProvenanceKey(tapeIncarnationId, fact.request) ||
        !canonicalJsonEquals(row.meta_json, expectedMeta)
      ) {
        throw new ToolSurfaceProvenanceCorruptionError(
          `Tool surface for message ${messageId} failed canonical row validation.`
        )
      }
      const catalogRow = table.getByEntryId(sessionId, fact.catalog.entryId)
      if (!catalogRow || catalogRow.entry_id >= row.entry_id) {
        throw new ToolSurfaceProvenanceCorruptionError(
          `Tool surface for message ${messageId} has an invalid catalog reference.`
        )
      }
      const catalog = parsePersistedCatalogFact(catalogRow)
      if (
        catalog.fullCatalogHash !== fact.catalog.fullCatalogHash ||
        catalog.catalogFactHash !== fact.catalog.catalogFactHash ||
        catalogRow.session_id !== sessionId ||
        catalogRow.kind !== 'event' ||
        catalogRow.name !== TAPE_TOOL_CATALOG_EVENT_NAME ||
        catalogRow.source_type !== 'runtime_event' ||
        catalogRow.source_id !== catalog.fullCatalogHash ||
        catalogRow.source_seq !== 0 ||
        catalogRow.provenance_key !==
          catalogProvenanceKey(tapeIncarnationId, catalog.fullCatalogHash) ||
        !canonicalJsonEquals(catalogRow.meta_json, {
          tapeIncarnationId,
          schemaVersion: catalog.schemaVersion,
          catalogFactHashVersion: catalog.catalogFactHashVersion,
          fullCatalogHash: catalog.fullCatalogHash,
          catalogFactHash: catalog.catalogFactHash
        })
      ) {
        throw new ToolSurfaceProvenanceCorruptionError(
          `Tool catalog for message ${messageId} failed canonical row validation.`
        )
      }
      const retainedCatalogEntries = new Map(
        catalog.entries.map((entry) => [entry.stableTargetKey, entry] as const)
      )
      for (const activeEntry of fact.activeEntries) {
        const catalogEntry = retainedCatalogEntries.get(activeEntry.stableTargetKey)
        if (!catalogEntry && catalog.retainedEntryCount === catalog.totalEntryCount) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `Tool surface for message ${messageId} is missing its complete catalog entry.`
          )
        }
        if (
          catalogEntry &&
          canonicalJsonStringifyData({
            target: catalogEntry.target,
            canonicalToolDefinitionHash: catalogEntry.canonicalToolDefinitionHash,
            exposure: catalogEntry.exposure,
            execution: catalogEntry.execution
          }) !==
            canonicalJsonStringifyData({
              target: activeEntry.target,
              canonicalToolDefinitionHash: activeEntry.canonicalToolDefinitionHash,
              exposure: activeEntry.exposure,
              execution: activeEntry.execution
            })
        ) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `Tool surface for message ${messageId} conflicts with its retained catalog entry.`
          )
        }
      }
    }
    return records
  }

  commitToolSurfaceView(input: CommitTapeToolSurfaceViewInput): TapeToolSurfaceViewCommitReceipt {
    let prepared: PreparedCommitInput
    try {
      prepared = prepareCommitInput(input)
    } catch (error) {
      throw new ToolSurfaceProvenanceError(
        'Tool surface provenance input is invalid.',
        'invalid_input',
        {
          cause: error
        }
      )
    }

    const table = this.providers.getEntryStore()
    if (table.isInTransaction()) {
      throw new ToolSurfaceProvenanceError(
        'Tool surface provenance must own its host transaction.',
        'persistence_failed'
      )
    }
    try {
      return table.runInTransaction(() => {
        const { manifest, catalog } = prepared
        table.ensureBootstrapAnchor(manifest.sessionId)
        const firstEntry = table.getFirstEntriesBySessions([manifest.sessionId])[0]
        const tapeIncarnationId = firstEntry ? readCanonicalTapeIncarnationId(firstEntry) : null
        if (!tapeIncarnationId) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `Session ${manifest.sessionId} has no canonical Tape incarnation.`
          )
        }

        const manifestRows = table.getEventsBySource(
          manifest.sessionId,
          TAPE_VIEW_MANIFEST_EVENT_NAME,
          'runtime_event',
          manifest.messageId,
          manifest.requestSeq
        )
        if (manifestRows.length > 1) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `View ${manifest.messageId}/${manifest.requestSeq} has conflicting manifests.`
          )
        }
        const existingManifest = manifestRows[0]
        if (existingManifest && !manifestRowMatches(existingManifest, manifest)) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `View ${manifest.messageId}/${manifest.requestSeq} has a different manifest.`
          )
        }
        const manifestRow = existingManifest ?? this.viewReplay.appendViewManifest(manifest)
        if (!manifestRowMatches(manifestRow, manifest)) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `View manifest append returned conflicting evidence for ${manifest.messageId}/${manifest.requestSeq}.`
          )
        }
        assertToolSearchResultReferences(
          table,
          manifest,
          manifestRow,
          tapeIncarnationId,
          prepared.surface,
          catalog
        )

        const catalogInput = catalogEventInput(manifest, tapeIncarnationId, catalog)
        const catalogRows = table.getEventsBySource(
          manifest.sessionId,
          TAPE_TOOL_CATALOG_EVENT_NAME,
          catalogInput.source.type,
          catalogInput.source.id,
          catalogInput.source.seq ?? 0
        )
        if (catalogRows.length > 1) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `Catalog ${catalog.fullCatalogHash} has duplicate physical facts.`
          )
        }
        const catalogByProvenance = table.getByProvenanceKey(
          manifest.sessionId,
          catalogInput.provenanceKey
        )
        const existingCatalog = catalogRows[0] ?? catalogByProvenance
        if (
          (catalogRows[0] &&
            catalogByProvenance &&
            catalogRows[0].entry_id !== catalogByProvenance.entry_id) ||
          (existingCatalog &&
            !canonicalEventRowMatches(existingCatalog, catalogInput, { ignoreCreatedAt: true }))
        ) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `Catalog ${catalog.fullCatalogHash} has conflicting persisted content.`
          )
        }
        const catalogRow =
          existingCatalog ?? table.appendToolSurfaceEvent({ ...catalogInput, idempotent: true })
        if (!canonicalEventRowMatches(catalogRow, catalogInput, { ignoreCreatedAt: true })) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `Catalog append returned conflicting evidence for ${catalog.fullCatalogHash}.`
          )
        }

        const catalogReference: TapeToolCatalogFactReference = {
          sessionId: manifest.sessionId,
          tapeIncarnationId,
          entryId: catalogRow.entry_id,
          fullCatalogHash: catalog.fullCatalogHash,
          catalogFactHash: catalog.catalogFactHash
        }
        const surfaceFact = createTapeToolSurfaceFact({
          ...prepared.surface,
          manifestHash: manifest.hashes.manifestHash,
          catalog: catalogReference
        })
        const surfaceInput = surfaceEventInput(manifest, tapeIncarnationId, surfaceFact)
        const surfaceIdentityRows = table
          .getEventsBySource(
            manifest.sessionId,
            TAPE_TOOL_SURFACE_EVENT_NAME,
            surfaceInput.source.type,
            surfaceInput.source.id,
            surfaceInput.source.seq ?? 0
          )
          .filter((row) => rowHasSurfaceRequestIdentity(row, surfaceFact.request))
        if (surfaceIdentityRows.length > 1) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `Tool surface ${manifest.messageId}/${manifest.requestSeq} has duplicate physical facts.`
          )
        }
        const surfaceByProvenance = table.getByProvenanceKey(
          manifest.sessionId,
          surfaceInput.provenanceKey
        )
        const existingSurface = surfaceIdentityRows[0] ?? surfaceByProvenance
        if (
          surfaceIdentityRows[0] &&
          surfaceByProvenance &&
          surfaceIdentityRows[0].entry_id !== surfaceByProvenance.entry_id
        ) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `Tool surface ${manifest.messageId}/${manifest.requestSeq} has conflicting identities.`
          )
        }
        if (existingSurface && !canonicalEventRowMatches(existingSurface, surfaceInput)) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `Tool surface ${manifest.messageId}/${manifest.requestSeq} has conflicting persisted content.`
          )
        }
        const surfaceRow =
          existingSurface ?? table.appendToolSurfaceEvent({ ...surfaceInput, idempotent: true })
        if (!canonicalEventRowMatches(surfaceRow, surfaceInput)) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `Tool surface append returned conflicting evidence for ${manifest.messageId}/${manifest.requestSeq}.`
          )
        }
        if (
          surfaceRow.entry_id <= manifestRow.entry_id ||
          surfaceRow.entry_id <= catalogRow.entry_id
        ) {
          throw new ToolSurfaceProvenanceCorruptionError(
            `Tool surface ${manifest.messageId}/${manifest.requestSeq} has impossible causal ordering.`
          )
        }

        const programmaticProvenanceKey = programmaticSurfaceProvenanceKey(
          tapeIncarnationId,
          surfaceFact.request
        )
        const programmaticRows = table.getEventsBySource(
          manifest.sessionId,
          TAPE_PROGRAMMATIC_TOOL_SURFACE_EVENT_NAME,
          'runtime_event',
          manifest.messageId,
          manifest.requestSeq
        )
        const programmaticByProvenance = table.getByProvenanceKey(
          manifest.sessionId,
          programmaticProvenanceKey
        )
        let programmaticReceipt: TapeToolSurfaceViewCommitReceipt['programmaticSurface'] = null
        if (prepared.programmaticSurface === null) {
          if (programmaticRows.length > 0 || programmaticByProvenance) {
            throw new ToolSurfaceProvenanceCorruptionError(
              `View ${manifest.messageId}/${manifest.requestSeq} conflicts with its Programmatic Tool Surface applicability.`
            )
          }
        } else {
          if (programmaticRows.length > 1) {
            throw new ToolSurfaceProvenanceCorruptionError(
              `Programmatic Tool Surface ${manifest.messageId}/${manifest.requestSeq} has duplicate physical facts.`
            )
          }
          const programmaticFact = createTapeProgrammaticToolSurfaceFact({
            ...prepared.programmaticSurface,
            manifestHash: manifest.hashes.manifestHash,
            catalog: catalogReference,
            contractBearing: Boolean(getTapeViewManifestExecutionContract(manifest))
          })
          const programmaticInput = programmaticSurfaceEventInput(
            manifest,
            tapeIncarnationId,
            programmaticFact
          )
          const existingProgrammatic = programmaticRows[0] ?? programmaticByProvenance
          if (
            (programmaticRows[0] &&
              programmaticByProvenance &&
              programmaticRows[0].entry_id !== programmaticByProvenance.entry_id) ||
            (existingProgrammatic &&
              !canonicalEventRowMatches(existingProgrammatic, programmaticInput))
          ) {
            throw new ToolSurfaceProvenanceCorruptionError(
              `Programmatic Tool Surface ${manifest.messageId}/${manifest.requestSeq} has conflicting persisted content.`
            )
          }
          if (Boolean(existingSurface) !== Boolean(existingProgrammatic)) {
            throw new ToolSurfaceProvenanceCorruptionError(
              `View ${manifest.messageId}/${manifest.requestSeq} has incomplete Programmatic provenance.`
            )
          }
          const programmaticRow =
            existingProgrammatic ??
            table.appendToolSurfaceEvent({ ...programmaticInput, idempotent: true })
          if (!canonicalEventRowMatches(programmaticRow, programmaticInput)) {
            throw new ToolSurfaceProvenanceCorruptionError(
              `Programmatic Tool Surface append returned conflicting evidence for ${manifest.messageId}/${manifest.requestSeq}.`
            )
          }
          if (
            programmaticRow.entry_id <= manifestRow.entry_id ||
            programmaticRow.entry_id <= catalogRow.entry_id ||
            programmaticRow.entry_id <= surfaceRow.entry_id
          ) {
            throw new ToolSurfaceProvenanceCorruptionError(
              `Programmatic Tool Surface ${manifest.messageId}/${manifest.requestSeq} has impossible causal ordering.`
            )
          }
          programmaticReceipt = {
            sessionId: manifest.sessionId,
            tapeIncarnationId,
            entryId: programmaticRow.entry_id,
            capabilityHash: programmaticFact.capabilityHash,
            programmaticSurfaceHash: programmaticFact.programmaticSurfaceHash,
            factHash: programmaticFact.factHash,
            created: !existingProgrammatic
          }
        }

        return {
          tapeIncarnationId,
          manifest: {
            sessionId: manifest.sessionId,
            entryId: manifestRow.entry_id,
            manifestHash: manifest.hashes.manifestHash,
            created: !existingManifest
          },
          catalog: {
            ...catalogReference,
            created: !existingCatalog
          },
          surface: {
            sessionId: manifest.sessionId,
            tapeIncarnationId,
            entryId: surfaceRow.entry_id,
            surfaceHash: surfaceFact.surfaceHash,
            created: !existingSurface
          },
          programmaticSurface: programmaticReceipt
        }
      })
    } catch (error) {
      if (error instanceof ToolSurfaceProvenanceError) throw error
      if (error instanceof TypeError) {
        throw new ToolSurfaceProvenanceError(
          'Tool surface provenance input is invalid.',
          'invalid_input',
          { cause: error }
        )
      }
      throw new ToolSurfaceProvenanceError(
        `Failed to persist Tool surface provenance for session ${prepared.manifest.sessionId}.`,
        'persistence_failed',
        { cause: error }
      )
    }
  }
}
