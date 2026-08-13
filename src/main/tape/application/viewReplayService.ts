import type {
  DeepChatTapeViewManifest,
  DeepChatTapeViewManifestRecord,
  DeepChatTapeViewManifestV6,
  DeepChatTapeViewManifestV7
} from '@shared/types/tape-view-manifest'
import type {
  DeepChatCausalObservationReadOptions,
  DeepChatCausalObservationRequest,
  DeepChatCausalObservationSlice,
  DeepChatTapeReplayEntrySnapshot,
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice,
  DeepChatTapeReplayTraceSnapshot
} from '@shared/types/tape-replay'
import { SUMMARY_ANCHOR_NAMES, type DeepChatTapeEntryRow } from '../domain/entry'
import { buildEffectiveTapeView } from '../domain/effectiveView'
import { readTapeMessageRetractionId, tapeEntryToMessageRecord } from '../domain/effectiveSemantics'
import {
  collectEntryIds,
  hashString,
  isPositiveInteger,
  normalizeStoredTapeViewManifest,
  withReplaySliceHash
} from '../domain/replay'
import { canonicalJsonStringifyData, hashJsonData } from '../domain/canonicalJson'
import { readTapeSkillMaterializationRef } from '../domain/skillMaterialization'
import {
  hashJson,
  TAPE_VIEW_MANIFEST_EVENT_NAME,
  verifyTapeViewManifestHash
} from '../domain/viewManifest'
import type {
  TapeApplicationProviders,
  TapeMessageTraceRow as DeepChatMessageTraceRow
} from '../ports/application'
import { toTapeSessionId } from '../domain/facts'
import {
  MAX_SKILL_VIEW_RESULT_FACT_BYTES,
  readSkillContextEvidence,
  validateSchema6SkillContexts,
  validateSchema7SkillContexts,
  validateRuntimeSkillJournalChain,
  type TapeRuntimeSkillViewContextReceipt,
  type TapeRuntimeSkillViewRecoveryInput,
  type TapeSkillContextEvidence
} from '../domain/skillContext'
import { buildExecutionOperationProvenanceKey } from '../domain/executionJournal'
import type {
  TapeMemoryContributionBudgetInspection,
  TapeMemoryContributionTokenInspection,
  TapeMemoryViewManifestInspection,
  TapeSkillRequestAuthorityBinding
} from '../ports/capabilities'
import { parseJsonObject } from './common'
import { assertTapeToolFactPhysicalEnvelope, buildToolFactProvenanceKey } from './factPersistence'
import type { TapeViewManifestAssemblySources } from './contracts'

type TapeViewReplayProviders = Pick<
  TapeApplicationProviders,
  'getEntryStore' | 'getMessageTraceReader' | 'getTerminalMessageReader'
>

const BOOTSTRAP_ANCHOR_NAME = 'session/start'

function isReconstructionAnchorName(name: string | null): boolean {
  if (name === null) {
    return false
  }
  return (
    (SUMMARY_ANCHOR_NAMES as readonly string[]).includes(name) ||
    name.startsWith('handoff/') ||
    name.startsWith('auto_handoff/')
  )
}

function readToolFactStatus(row: DeepChatTapeEntryRow): string | null {
  const status = parseJsonObject(row.meta_json).status
  return typeof status === 'string' ? status : null
}

function readToolFactToolCallId(row: DeepChatTapeEntryRow): string | null {
  const payload = parseJsonObject(row.payload_json)
  if (row.kind === 'tool_call') {
    const toolCall = payload.toolCall
    if (toolCall && typeof toolCall === 'object' && !Array.isArray(toolCall)) {
      const id = (toolCall as Record<string, unknown>).id
      return typeof id === 'string' && id.length > 0 ? id : null
    }
    return null
  }
  const toolCallId = payload.toolCallId
  return typeof toolCallId === 'string' && toolCallId.length > 0 ? toolCallId : null
}

function readToolFactMessageId(row: DeepChatTapeEntryRow): string | null {
  const messageId = parseJsonObject(row.payload_json).messageId
  return typeof messageId === 'string' && messageId.length > 0 ? messageId : null
}

function deriveSelectedMemoryIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const ids = new Set<string>()
  for (const item of value) {
    const id =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>).id
          : null
    if (typeof id === 'string' && id.length > 0) ids.add(id)
  }
  return [...ids]
}

function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

type DeepChatTapeSkillViewManifest = DeepChatTapeViewManifestV6 | DeepChatTapeViewManifestV7

function canonicalSkillManifestOccurrence(manifest: DeepChatTapeSkillViewManifest): string {
  return canonicalJsonStringifyData({ ...manifest, assembledAt: 0 })
}

function readContributionTokenMap(value: unknown): TapeMemoryContributionTokenInspection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const directive = readNonNegativeNumber(record.directive)
  const persona = readNonNegativeNumber(record.persona)
  const working = readNonNegativeNumber(record.working)
  const queryRecall = readNonNegativeNumber(record.queryRecall)
  if (directive === null || persona === null || working === null || queryRecall === null) {
    return null
  }
  return { directive, persona, working, queryRecall }
}

function readContributionBudget(value: unknown): TapeMemoryContributionBudgetInspection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const policyVersion = readNonNegativeNumber(record.policyVersion)
  const totalTokenBudget = readNonNegativeNumber(record.totalTokenBudget)
  const overheadTokens = readNonNegativeNumber(record.overheadTokens)
  const demand = readContributionTokenMap(record.demand)
  const allocated = readContributionTokenMap(record.allocated)
  const used = readContributionTokenMap(record.used)
  const borrowed = readContributionTokenMap(record.borrowed)
  const unallocatedTokens = readNonNegativeNumber(record.unallocatedTokens)
  const estimatedTotalTokens = readNonNegativeNumber(record.estimatedTotalTokens)
  const unusedTokens = readNonNegativeNumber(record.unusedTokens)
  if (
    policyVersion === null ||
    totalTokenBudget === null ||
    overheadTokens === null ||
    !demand ||
    !allocated ||
    !used ||
    !borrowed ||
    unallocatedTokens === null ||
    estimatedTotalTokens === null ||
    unusedTokens === null ||
    typeof record.constrained !== 'boolean'
  ) {
    return null
  }
  return {
    policyVersion,
    totalTokenBudget,
    overheadTokens,
    demand,
    allocated,
    used,
    borrowed,
    unallocatedTokens,
    estimatedTotalTokens,
    unusedTokens,
    constrained: record.constrained
  }
}

function toMemoryViewManifestInspection(
  row: DeepChatTapeEntryRow
): TapeMemoryViewManifestInspection | null {
  const payload = parseJsonObject(row.payload_json)
  const meta = parseJsonObject(row.meta_json)
  const manifest =
    payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
      ? (payload.state as Record<string, unknown>)
      : null
  if (!manifest) return null
  const readNumber = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  return {
    sessionId: row.session_id,
    messageId: typeof meta.messageId === 'string' ? meta.messageId : null,
    entryId: row.entry_id,
    policyVersion:
      typeof manifest.policyVersion === 'number' && Number.isFinite(manifest.policyVersion)
        ? manifest.policyVersion
        : null,
    tokenBudget: readNumber(manifest.tokenBudget),
    estimatedTokens: readNumber(manifest.estimatedTokens),
    selectedCount: Array.isArray(manifest.selected) ? manifest.selected.length : 0,
    selectedIds: deriveSelectedMemoryIds(manifest.selected),
    droppedCount: Array.isArray(manifest.dropped) ? manifest.dropped.length : 0,
    queryHash: typeof manifest.queryHash === 'string' ? manifest.queryHash : null,
    allocation: readContributionBudget(manifest.allocation),
    createdAt: row.created_at
  }
}

export class TapeViewReplayService {
  constructor(private readonly providers: TapeViewReplayProviders) {}

  private get table() {
    return this.providers.getEntryStore()
  }

  getEffectiveUserMessageSourceEntryId(sessionId: string, messageId: string): number | null {
    if (!sessionId.trim() || !messageId.trim()) {
      throw new Error('User-message Tape source identity is invalid.')
    }
    const rows = this.table.getMessageSourceEntries(sessionId, messageId)
    for (const row of rows) {
      if (
        row.session_id !== sessionId ||
        row.source_type !== 'message' ||
        row.source_id !== messageId
      ) {
        throw new Error('User-message Tape source history is invalid.')
      }
      if (row.kind === 'message') {
        const record = tapeEntryToMessageRecord(row)
        if (
          !record ||
          row.name !== `message/${record.role}` ||
          record.sessionId !== sessionId ||
          record.id !== messageId
        ) {
          throw new Error('User-message Tape source physical envelope is invalid.')
        }
      } else if (
        row.kind !== 'event' ||
        row.name !== 'message/retracted' ||
        readTapeMessageRetractionId(row) !== messageId
      ) {
        throw new Error('User-message Tape source history is invalid.')
      }
    }
    const effective = buildEffectiveTapeView(rows, { includePending: true }).messageEntries
    if (effective.length === 0) return null
    if (
      effective.length !== 1 ||
      effective[0].record.sessionId !== sessionId ||
      effective[0].record.id !== messageId
    ) {
      throw new Error('User-message Tape source resolution is ambiguous.')
    }
    return effective[0].record.role === 'user' ? effective[0].entryId : null
  }

  private requireRuntimeSkillJournalEvidence(input: {
    sessionId: string
    messageId: string
    toolCallId: string
    responseText: string
    evidence: unknown
  }): TapeSkillContextEvidence {
    const evidence = readSkillContextEvidence(input.evidence)
    if (evidence.operation.providerToolCallId !== input.toolCallId) {
      throw new Error('Runtime Skill-view Journal operation does not match its tool result.')
    }
    const outcomeRow = this.table.getByEntryIds(input.sessionId, [evidence.outcomeEntryId])[0]
    if (!outcomeRow) {
      throw new Error('Runtime Skill-view Journal outcome is missing.')
    }
    const dispatchRow = this.table.getByProvenanceKey(
      input.sessionId,
      buildExecutionOperationProvenanceKey(evidence.operation, 'dispatch')
    )
    if (!dispatchRow) {
      throw new Error('Runtime Skill-view Journal dispatch is missing.')
    }
    return validateRuntimeSkillJournalChain({
      sessionId: input.sessionId,
      messageId: input.messageId,
      toolCallId: input.toolCallId,
      responseText: input.responseText,
      evidence,
      dispatchRow,
      outcomeRow
    })
  }

  getViewManifestSourceMaps(
    sessionId: string,
    messageId?: string
  ): TapeViewManifestAssemblySources {
    const table = this.table
    const rows = table.getBySessionExcludingContext(sessionId)
    const entryIdByMessageId = new Map<string, number>()
    const toolCallEntryIdByToolId = new Map<string, number>()
    const toolResultEntryIdByToolId = new Map<string, number>()
    const latestEntryId = table.getMaxEntryId(sessionId)
    const anchorEntryIds: number[] = []
    let reconstructionAnchorEntryId: number | null = null
    let bootstrapAnchorEntryId: number | null = null

    for (const row of rows) {
      if (row.kind === 'anchor') {
        anchorEntryIds.push(row.entry_id)
        if (isReconstructionAnchorName(row.name)) {
          if (reconstructionAnchorEntryId === null || row.entry_id > reconstructionAnchorEntryId) {
            reconstructionAnchorEntryId = row.entry_id
          }
        } else if (row.name === BOOTSTRAP_ANCHOR_NAME) {
          bootstrapAnchorEntryId = row.entry_id
        }
        continue
      }
      if (row.kind === 'message' && row.source_type === 'message' && row.source_id) {
        entryIdByMessageId.set(row.source_id, row.entry_id)
        continue
      }
      if (row.kind === 'tool_call' || row.kind === 'tool_result') {
        if (messageId && readToolFactMessageId(row) !== messageId) {
          continue
        }
        const toolCallId = readToolFactToolCallId(row)
        if (!toolCallId || readToolFactStatus(row) === 'pending') {
          continue
        }
        const target =
          row.kind === 'tool_call' ? toolCallEntryIdByToolId : toolResultEntryIdByToolId
        target.set(toolCallId, row.entry_id)
      }
    }

    const reconstructionAnchorEntryIds =
      reconstructionAnchorEntryId !== null
        ? [reconstructionAnchorEntryId]
        : bootstrapAnchorEntryId !== null
          ? [bootstrapAnchorEntryId]
          : []

    return {
      latestEntryId,
      anchorEntryIds,
      reconstructionAnchorEntryIds,
      reconstructionAnchorEntryId,
      entryIdByMessageId,
      toolCallEntryIdByToolId,
      toolResultEntryIdByToolId
    }
  }

  recoverRuntimeSkillViewContexts(
    input: TapeRuntimeSkillViewRecoveryInput
  ): TapeRuntimeSkillViewContextReceipt[] {
    if (
      !input.sessionId.trim() ||
      !input.messageId.trim() ||
      !Number.isSafeInteger(input.messageOrderSeq) ||
      input.messageOrderSeq < 0 ||
      !input.expectedTapeIncarnationId.trim() ||
      input.projections.length > 64
    ) {
      throw new TypeError('Runtime Skill-view recovery identity is invalid.')
    }
    if (this.table.getBootstrapIncarnation(input.sessionId) !== input.expectedTapeIncarnationId) {
      throw new Error('Runtime Skill-view recovery belongs to another Session Tape incarnation.')
    }

    const expected = new Map<string, string>()
    for (const projection of input.projections) {
      if (
        !projection.toolCallId.trim() ||
        !projection.responseText ||
        !Number.isSafeInteger(projection.blockIndex) ||
        projection.blockIndex < 0 ||
        !Number.isSafeInteger(projection.timestamp) ||
        projection.timestamp < 0 ||
        Buffer.byteLength(projection.responseText, 'utf8') > MAX_SKILL_VIEW_RESULT_FACT_BYTES ||
        expected.has(projection.toolCallId)
      ) {
        throw new TypeError('Runtime Skill-view recovery projection is invalid or ambiguous.')
      }
      expected.set(projection.toolCallId, projection.responseText)
    }
    if (expected.size === 0) return []
    const executableManifests = this.listExactRuntimeSkillExecutionManifests(
      input.sessionId,
      input.messageId
    )

    return input.projections.map((projection) => {
      const expectedPayload = {
        messageId: input.messageId,
        orderSeq: input.messageOrderSeq,
        toolCallId: projection.toolCallId,
        response: projection.responseText
      }
      const provenanceKey = buildToolFactProvenanceKey(
        'tool_result',
        input.messageId,
        projection.toolCallId,
        expectedPayload
      )
      const authority = this.table.getByProvenanceKey(input.sessionId, provenanceKey)
      const payload = authority ? parseJsonObject(authority.payload_json) : {}
      const meta = authority ? parseJsonObject(authority.meta_json) : {}
      const evidence = authority
        ? this.requireRuntimeSkillJournalEvidence({
            sessionId: input.sessionId,
            messageId: input.messageId,
            toolCallId: projection.toolCallId,
            responseText: projection.responseText,
            evidence: meta.skillContextEvidence
          })
        : null
      const identity = evidence?.identity ?? null
      if (
        !authority ||
        !evidence ||
        !identity ||
        evidence.outcomeEntryId >= authority.entry_id ||
        authority.kind !== 'tool_result' ||
        authority.name !== 'skill_view' ||
        authority.source_type !== 'tool_result' ||
        authority.source_id !== `${input.messageId}:${projection.toolCallId}` ||
        authority.provenance_key !== provenanceKey ||
        readToolFactMessageId(authority) !== input.messageId ||
        readToolFactToolCallId(authority) !== projection.toolCallId ||
        readToolFactStatus(authority) !== 'success' ||
        payload.orderSeq !== input.messageOrderSeq ||
        payload.response !== projection.responseText ||
        meta.source !== 'live' ||
        meta.role !== 'assistant' ||
        meta.status !== 'success' ||
        meta.reason !== 'tool_loop' ||
        Object.keys(meta).sort().join('\0') !==
          ['reason', 'role', 'skillContextEvidence', 'source', 'status'].sort().join('\0')
      ) {
        throw new Error(
          'Runtime Skill-view recovery evidence drifted from its provider projection.'
        )
      }
      assertTapeToolFactPhysicalEnvelope(
        authority,
        {
          sessionId: toTapeSessionId(input.sessionId),
          messageId: input.messageId,
          orderSeq: input.messageOrderSeq,
          blockIndex: projection.blockIndex,
          block: {
            type: 'tool_call',
            content: '',
            status: 'success',
            timestamp: projection.timestamp,
            tool_call: {
              id: projection.toolCallId,
              name: 'skill_view',
              params: '',
              response: projection.responseText
            }
          },
          provenance: {
            source: 'tool_result',
            sourceId: `${input.messageId}:${projection.toolCallId}`,
            sequence: projection.blockIndex
          }
        },
        'live',
        {
          reason: 'tool_loop',
          skillContextEvidence: {
            identity,
            operation: evidence.operation,
            outcomeEntryId: evidence.outcomeEntryId
          }
        }
      )
      const executionRefs = executableManifests.flatMap((manifest) =>
        manifest.skillContexts.flatMap((context) =>
          context.activationScope === 'runtime_view' &&
          context.authoritativeRef.entryId === authority.entry_id &&
          context.authoritativeRef.contentHash === hashString(projection.responseText) &&
          context.agentId === identity.agentId &&
          context.sourceType === identity.sourceType &&
          context.sourceId === identity.sourceId &&
          context.skillName === identity.skillName
            ? [context.executionRef]
            : []
        )
      )
      const executionRefKeys = new Set(executionRefs.map((ref) => canonicalJsonStringifyData(ref)))
      if (executionRefs.length === 0 || executionRefKeys.size !== 1) {
        throw new Error('Runtime Skill-view recovery has no unique execution package authority.')
      }
      return {
        identity,
        toolCallId: projection.toolCallId,
        entryId: authority.entry_id,
        tapeIncarnationId: input.expectedTapeIncarnationId,
        contentHash: hashString(projection.responseText),
        executionRef: structuredClone(executionRefs[0])
      }
    })
  }

  listMemoryViewManifestsByAgent(
    agentId: string,
    options?: { sessionId?: string; limit?: number; messageId?: string }
  ): TapeMemoryViewManifestInspection[] {
    return this.table
      .listMemoryViewManifestAnchorsByAgent(agentId, options)
      .map(toMemoryViewManifestInspection)
      .filter((manifest): manifest is TapeMemoryViewManifestInspection => manifest !== null)
      .filter((manifest) => !options?.messageId || manifest.messageId === options.messageId)
  }

  appendViewManifest(manifest: DeepChatTapeViewManifest): DeepChatTapeEntryRow {
    const table = this.table
    table.ensureBootstrapAnchor(manifest.sessionId)
    if (manifest.schemaVersion === 6 || manifest.schemaVersion === 7) {
      return table.runInTransaction(() => {
        if (verifyTapeViewManifestHash(manifest) !== 'valid') {
          throw new Error('Skill-bearing ViewManifest integrity is invalid.')
        }
        if (table.getBootstrapIncarnation(manifest.sessionId) !== manifest.tapeIncarnationId) {
          throw new Error(
            'Skill-bearing ViewManifest Tape incarnation does not match the Session Tape.'
          )
        }
        this.validateSkillManifestEvidence(manifest)
        const provenanceKey = this.skillManifestProvenanceKey(manifest)
        const conflictingSchemaVersion = manifest.schemaVersion === 6 ? 7 : 6
        if (
          table.getByProvenanceKey(
            manifest.sessionId,
            this.skillManifestBindingProvenanceKey(conflictingSchemaVersion, manifest)
          )
        ) {
          throw new Error('Conflicting Skill-bearing ViewManifest execution binding.')
        }
        const row = table.getByProvenanceKey(manifest.sessionId, provenanceKey)
        if (row) {
          return this.requireEqualSkillManifestRow(row, manifest, provenanceKey)
        }
        return this.requireEqualSkillManifestRow(
          this.appendViewManifestEvent(manifest),
          manifest,
          provenanceKey
        )
      })
    }
    return this.appendViewManifestEvent(manifest)
  }

  private appendViewManifestEvent(manifest: DeepChatTapeViewManifest): DeepChatTapeEntryRow {
    const table = this.table
    return table.appendEvent({
      sessionId: manifest.sessionId,
      name: TAPE_VIEW_MANIFEST_EVENT_NAME,
      source: {
        type: 'runtime_event',
        id: manifest.messageId,
        seq: manifest.requestSeq
      },
      provenanceKey:
        manifest.schemaVersion === 6 || manifest.schemaVersion === 7
          ? this.skillManifestProvenanceKey(manifest)
          : `view:${manifest.sessionId}:${manifest.messageId}:${manifest.requestSeq}:${manifest.hashes.manifestHash}`,
      data: {
        manifest
      },
      meta: {
        viewId: manifest.viewId,
        requestSeq: manifest.requestSeq,
        taskType: manifest.taskType,
        policy: manifest.policy,
        policyVersion: manifest.policyVersion
      },
      createdAt: manifest.assembledAt,
      idempotent: true
    })
  }

  private skillManifestProvenanceKey(manifest: DeepChatTapeSkillViewManifest): string {
    return this.skillManifestBindingProvenanceKey(manifest.schemaVersion, manifest)
  }

  private skillManifestBindingProvenanceKey(
    schemaVersion: 6 | 7,
    input: {
      sessionId: string
      tapeIncarnationId: string
      runId: string
      requestSeq: number
    }
  ): string {
    return `view${schemaVersion}:${hashJsonData({
      sessionId: input.sessionId,
      tapeIncarnationId: input.tapeIncarnationId,
      runId: input.runId,
      requestSeq: input.requestSeq
    })}`
  }

  private requireEqualSkillManifestRow(
    row: DeepChatTapeEntryRow,
    manifest: DeepChatTapeSkillViewManifest,
    provenanceKey: string
  ): DeepChatTapeEntryRow {
    const record = this.toViewManifestRecord(row)
    if (
      !record ||
      record.manifest.schemaVersion !== manifest.schemaVersion ||
      verifyTapeViewManifestHash(record.manifest) !== 'valid'
    ) {
      throw new Error('Malformed row occupies the Skill-bearing ViewManifest binding.')
    }
    this.requireValidStoredSkillManifestOccurrence(row, record.manifest, provenanceKey)
    if (record.manifest.hashes.manifestHash !== manifest.hashes.manifestHash) {
      throw new Error('Conflicting Skill-bearing ViewManifest binding.')
    }
    if (
      canonicalSkillManifestOccurrence(record.manifest) !==
      canonicalSkillManifestOccurrence(manifest)
    ) {
      throw new Error('Skill-bearing ViewManifest canonical retry is not equal.')
    }
    return row
  }

  private requireSkillManifestEnvelope(
    row: DeepChatTapeEntryRow,
    manifest: DeepChatTapeSkillViewManifest,
    provenanceKey: string
  ): void {
    const expectedPayload = { name: TAPE_VIEW_MANIFEST_EVENT_NAME, data: { manifest } }
    const expectedMeta = {
      viewId: manifest.viewId,
      requestSeq: manifest.requestSeq,
      taskType: manifest.taskType,
      policy: manifest.policy,
      policyVersion: manifest.policyVersion
    }
    if (
      row.kind !== 'event' ||
      row.name !== TAPE_VIEW_MANIFEST_EVENT_NAME ||
      row.source_type !== 'runtime_event' ||
      row.source_id !== manifest.messageId ||
      row.source_seq !== manifest.requestSeq ||
      row.provenance_key !== provenanceKey ||
      row.created_at !== manifest.assembledAt ||
      canonicalJsonStringifyData(parseJsonObject(row.payload_json)) !==
        canonicalJsonStringifyData(expectedPayload) ||
      canonicalJsonStringifyData(parseJsonObject(row.meta_json)) !==
        canonicalJsonStringifyData(expectedMeta)
    ) {
      throw new Error('Skill-bearing ViewManifest physical envelope is corrupt.')
    }
  }

  private requireValidStoredSkillManifestOccurrence(
    row: DeepChatTapeEntryRow,
    manifest: DeepChatTapeSkillViewManifest,
    provenanceKey = this.skillManifestProvenanceKey(manifest)
  ): void {
    if (
      verifyTapeViewManifestHash(manifest) !== 'valid' ||
      this.table.getBootstrapIncarnation(manifest.sessionId) !== manifest.tapeIncarnationId
    ) {
      throw new Error('Skill-bearing ViewManifest occurrence identity is invalid.')
    }
    this.requireSkillManifestEnvelope(row, manifest, provenanceKey)
    this.validateSkillManifestEvidence(manifest)
  }

  private validateSkillManifestEvidence(manifest: DeepChatTapeSkillViewManifest): void {
    const table = this.table
    if (manifest.schemaVersion === 6) validateSchema6SkillContexts(manifest.skillContexts)
    else validateSchema7SkillContexts(manifest.skillContexts)
    const evidenceRows = new Map(
      table
        .getByEntryIds(
          manifest.sessionId,
          collectEntryIds(
            manifest.skillContexts.flatMap((context) => [
              context.authoritativeRef.entryId,
              ...('executionRef' in context ? [context.executionRef.entryId] : []),
              ...context.sourceEntryIds
            ])
          )
        )
        .map((row) => [row.entry_id, row])
    )
    for (const context of manifest.skillContexts) {
      const authoritativeRef = context.authoritativeRef
      if (authoritativeRef.entryId > manifest.latestEntryId) {
        throw new Error('Skill context references content after the View head.')
      }
      const authoritativeRow = evidenceRows.get(authoritativeRef.entryId)
      if (!authoritativeRow) {
        throw new Error('Skill context authority is missing.')
      }

      if (authoritativeRef.kind === 'materialization') {
        if (authoritativeRef.tapeIncarnationId !== manifest.tapeIncarnationId) {
          throw new Error('Skill materialization belongs to another Tape incarnation.')
        }
        readTapeSkillMaterializationRef(authoritativeRow, {
          sessionId: manifest.sessionId,
          ...authoritativeRef
        })
      } else {
        const payload = parseJsonObject(authoritativeRow.payload_json)
        const meta = parseJsonObject(authoritativeRow.meta_json)
        const evidence =
          typeof payload.messageId === 'string' &&
          typeof payload.toolCallId === 'string' &&
          typeof payload.response === 'string'
            ? this.requireRuntimeSkillJournalEvidence({
                sessionId: manifest.sessionId,
                messageId: payload.messageId,
                toolCallId: payload.toolCallId,
                responseText: payload.response,
                evidence: meta.skillContextEvidence
              })
            : null
        const identity = evidence?.identity ?? null
        if (
          authoritativeRow.kind !== 'tool_result' ||
          authoritativeRow.name !== 'skill_view' ||
          authoritativeRow.source_type !== 'tool_result' ||
          !evidence ||
          !identity ||
          evidence.outcomeEntryId >= authoritativeRow.entry_id ||
          identity.agentId !== context.agentId ||
          identity.sourceType !== context.sourceType ||
          identity.sourceId !== context.sourceId ||
          identity.skillName !== context.skillName ||
          readToolFactStatus(authoritativeRow) !== 'success' ||
          typeof payload.messageId !== 'string' ||
          payload.messageId !== manifest.messageId ||
          typeof payload.toolCallId !== 'string' ||
          !payload.toolCallId ||
          !Number.isSafeInteger(payload.orderSeq) ||
          (payload.orderSeq as number) < 0 ||
          !Number.isSafeInteger(authoritativeRow.source_seq) ||
          (authoritativeRow.source_seq as number) < 0 ||
          !Number.isSafeInteger(authoritativeRow.created_at) ||
          authoritativeRow.created_at < 0 ||
          typeof payload.response !== 'string' ||
          hashString(payload.response) !== authoritativeRef.contentHash
        ) {
          throw new Error('Skill tool-result authority is invalid.')
        }
        assertTapeToolFactPhysicalEnvelope(
          authoritativeRow,
          {
            sessionId: toTapeSessionId(manifest.sessionId),
            messageId: payload.messageId,
            orderSeq: payload.orderSeq as number,
            blockIndex: authoritativeRow.source_seq as number,
            block: {
              type: 'tool_call',
              content: '',
              status: 'success',
              timestamp: authoritativeRow.created_at,
              tool_call: {
                id: payload.toolCallId,
                name: 'skill_view',
                params: '',
                response: payload.response
              }
            },
            provenance: {
              source: 'tool_result',
              sourceId: `${manifest.messageId}:${payload.toolCallId}`,
              sequence: authoritativeRow.source_seq as number
            }
          },
          'live',
          {
            reason: 'tool_loop',
            skillContextEvidence: {
              identity,
              operation: evidence.operation,
              outcomeEntryId: evidence.outcomeEntryId
            }
          }
        )
        if ('executionRef' in context) {
          const executionRef = context.executionRef
          if (
            executionRef.entryId > manifest.latestEntryId ||
            executionRef.tapeIncarnationId !== manifest.tapeIncarnationId
          ) {
            throw new Error('Runtime Skill execution authority is outside the View boundary.')
          }
          const executionRow = evidenceRows.get(executionRef.entryId)
          if (!executionRow) throw new Error('Runtime Skill execution authority is missing.')
          const executionReceipt = readTapeSkillMaterializationRef(executionRow, {
            sessionId: manifest.sessionId,
            ...executionRef
          })
          let result: Record<string, unknown>
          try {
            const parsed = JSON.parse(payload.response as string) as unknown
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
            result = parsed as Record<string, unknown>
          } catch {
            throw new Error('Runtime Skill result cannot bind execution authority.')
          }
          if (
            typeof result.content !== 'string' ||
            hashString(result.content) !== executionReceipt.payload.effectiveContentHash
          ) {
            throw new Error(
              'Runtime Skill body and execution package resolved from different facts.'
            )
          }
        }
      }

      for (const sourceEntryId of context.sourceEntryIds) {
        if (sourceEntryId > manifest.latestEntryId || !evidenceRows.has(sourceEntryId)) {
          throw new Error('Skill context source evidence is missing.')
        }
      }
      if (context.activationScope === 'message') {
        const sourceRow = evidenceRows.get(context.sourceEntryIds[0])
        const sourceRecord = sourceRow ? tapeEntryToMessageRecord(sourceRow) : null
        if (
          context.sourceEntryIds.length !== 1 ||
          !sourceRow ||
          sourceRow.source_type !== 'message' ||
          sourceRow.source_id !== sourceRecord?.id ||
          sourceRow.name !== 'message/user' ||
          sourceRecord?.sessionId !== manifest.sessionId ||
          sourceRecord.role !== 'user'
        ) {
          throw new Error('Message Skill source is not a user-message fact.')
        }
      } else if (context.activationScope === 'session' && context.sourceEntryIds.length !== 0) {
        throw new Error('Session Skill context must not claim message sources.')
      }
    }
  }

  listViewManifestsByMessage(
    sessionId: string,
    messageId: string
  ): DeepChatTapeViewManifestRecord[] {
    const table = this.table
    return table
      .getViewManifestEventsByMessage(sessionId, messageId)
      .map((row) => this.toViewManifestRecord(row))
      .filter((record): record is DeepChatTapeViewManifestRecord => Boolean(record))
      .sort((left, right) => right.requestSeq - left.requestSeq || right.entryId - left.entryId)
  }

  private listExactRuntimeSkillExecutionManifests(
    sessionId: string,
    messageId: string
  ): DeepChatTapeViewManifestV7[] {
    return this.table.getViewManifestEventsByMessage(sessionId, messageId).flatMap((row) => {
      const payload = parseJsonObject(row.payload_json)
      const data = payload.data
      const rawManifest =
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>).manifest
          : null
      const claimsSchema7 =
        (rawManifest !== null &&
          typeof rawManifest === 'object' &&
          !Array.isArray(rawManifest) &&
          (rawManifest as Record<string, unknown>).schemaVersion === 7) ||
        row.provenance_key?.startsWith('view7:') === true
      if (!claimsSchema7) return []
      const record = this.toViewManifestRecord(row)
      if (!record || record.manifest.schemaVersion !== 7) {
        throw new Error('Runtime Skill execution View occurrence is corrupt.')
      }
      const exact = this.getViewManifestByExecutionBinding({
        sessionId,
        runId: record.manifest.runId,
        requestSeq: record.requestSeq
      })
      if (!exact || exact.entryId !== record.entryId || exact.manifest.schemaVersion !== 7) {
        throw new Error('Runtime Skill execution View binding is not exact.')
      }
      return [exact.manifest]
    })
  }

  getViewManifestByExecutionBinding(input: {
    sessionId: string
    runId: string
    requestSeq: number
  }): DeepChatTapeViewManifestRecord | null {
    if (!input.sessionId.trim() || !input.runId.trim() || !isPositiveInteger(input.requestSeq)) {
      throw new Error('Skill-bearing ViewManifest execution binding is invalid.')
    }
    const tapeIncarnationId = this.table.getBootstrapIncarnation(input.sessionId)
    if (!tapeIncarnationId) return null
    const candidates = ([6, 7] as const).flatMap((schemaVersion) => {
      const provenanceKey = this.skillManifestBindingProvenanceKey(schemaVersion, {
        ...input,
        tapeIncarnationId
      })
      const row = this.table.getByProvenanceKey(input.sessionId, provenanceKey)
      return row ? [{ row, provenanceKey }] : []
    })
    if (candidates.length === 0) return null
    if (candidates.length !== 1)
      throw new Error('Skill-bearing ViewManifest execution binding is ambiguous.')
    const [{ row, provenanceKey }] = candidates
    const record = this.toViewManifestRecord(row)
    if (
      !record ||
      (record.manifest.schemaVersion !== 6 && record.manifest.schemaVersion !== 7) ||
      record.manifest.runId !== input.runId ||
      record.manifest.requestSeq !== input.requestSeq ||
      record.manifest.tapeIncarnationId !== tapeIncarnationId ||
      verifyTapeViewManifestHash(record.manifest) !== 'valid'
    ) {
      throw new Error('Skill-bearing ViewManifest execution binding is corrupt.')
    }
    this.requireValidStoredSkillManifestOccurrence(row, record.manifest, provenanceKey)
    return record
  }

  assertSkillRequestAuthority(input: TapeSkillRequestAuthorityBinding): void {
    const record = this.getViewManifestByExecutionBinding({
      sessionId: input.sessionId,
      runId: input.runId,
      requestSeq: input.requestSeq
    })
    const manifest = record?.manifest
    if (
      !record ||
      record.messageId !== input.messageId ||
      (manifest?.schemaVersion !== 6 && manifest?.schemaVersion !== 7) ||
      manifest.runId !== input.runId ||
      manifest.requestSeq !== input.requestSeq ||
      manifest.tapeIncarnationId !== input.tapeIncarnationId ||
      manifest.hashes.manifestHash !== input.manifestHash ||
      manifest.hashes.promptHash !== input.promptHash ||
      manifest.hashes.toolDefinitionsHash !== input.toolDefinitionsHash ||
      canonicalJsonStringifyData(manifest.skillContexts) !==
        canonicalJsonStringifyData(input.skillContexts)
    ) {
      throw new Error(
        'Provider request Skill authority drifted after its ViewManifest was committed.'
      )
    }
  }

  getLatestViewManifestByRunBinding(input: {
    sessionId: string
    messageId: string
    runId: string
  }): DeepChatTapeViewManifestRecord | null {
    if (!input.sessionId.trim() || !input.messageId.trim() || !input.runId.trim()) {
      throw new Error('Skill-bearing ViewManifest Run binding is invalid.')
    }
    const tapeIncarnationId = this.table.getBootstrapIncarnation(input.sessionId)
    if (!tapeIncarnationId) return null
    const candidates = this.table
      .getViewManifestEventsByMessage(input.sessionId, input.messageId)
      .flatMap((row) => {
        const payload = parseJsonObject(row.payload_json)
        const data = payload.data
        const rawManifest =
          data && typeof data === 'object' && !Array.isArray(data)
            ? (data as Record<string, unknown>).manifest
            : null
        const rawManifestMatches =
          rawManifest !== null &&
          typeof rawManifest === 'object' &&
          !Array.isArray(rawManifest) &&
          (rawManifest as Record<string, unknown>).runId === input.runId &&
          ((rawManifest as Record<string, unknown>).schemaVersion === 6 ||
            (rawManifest as Record<string, unknown>).schemaVersion === 7)
        const sourceSeq =
          row.source_seq !== null && isPositiveInteger(row.source_seq) ? row.source_seq : null
        const schemaKeys =
          sourceSeq === null
            ? []
            : ([6, 7] as const).map((schemaVersion) =>
                this.skillManifestBindingProvenanceKey(schemaVersion, {
                  sessionId: input.sessionId,
                  tapeIncarnationId,
                  runId: input.runId,
                  requestSeq: sourceSeq
                })
              )
        const provenanceMatches =
          row.provenance_key !== null && schemaKeys.includes(row.provenance_key)
        if (!rawManifestMatches && !provenanceMatches) return []
        const rawRequestSeq = rawManifestMatches
          ? readNonNegativeNumber((rawManifest as Record<string, unknown>).requestSeq)
          : null
        if (
          rawManifestMatches &&
          (rawRequestSeq === null ||
            !isPositiveInteger(rawRequestSeq) ||
            sourceSeq === null ||
            sourceSeq !== rawRequestSeq)
        ) {
          throw new Error('Skill-bearing ViewManifest Run occurrence is corrupt.')
        }
        return [{ row, requestSeq: sourceSeq }]
      })
      .toSorted(
        (left, right) =>
          (right.requestSeq ?? 0) - (left.requestSeq ?? 0) || right.row.entry_id - left.row.entry_id
      )
    if (candidates.length === 0) return null
    const latest = candidates[0]
    const requestSeq = latest.requestSeq
    if (
      requestSeq === null ||
      latest.row.source_seq === null ||
      !isPositiveInteger(latest.row.source_seq) ||
      latest.row.source_seq !== requestSeq
    ) {
      throw new Error('Latest Skill-bearing ViewManifest Run binding is corrupt.')
    }
    if (candidates.filter((candidate) => candidate.requestSeq === requestSeq).length !== 1) {
      throw new Error('Latest Skill-bearing ViewManifest Run binding is ambiguous.')
    }
    const record = this.toViewManifestRecord(latest.row)
    if (
      !record ||
      (record.manifest.schemaVersion !== 6 && record.manifest.schemaVersion !== 7) ||
      record.manifest.runId !== input.runId
    ) {
      throw new Error('Latest Skill-bearing ViewManifest Run binding is corrupt.')
    }
    const exact = this.getViewManifestByExecutionBinding({
      sessionId: input.sessionId,
      runId: input.runId,
      requestSeq
    })
    if (!exact || exact.entryId !== record.entryId || exact.messageId !== input.messageId) {
      throw new Error('Latest Skill-bearing ViewManifest Run occurrence is not exact.')
    }
    return exact
  }

  exportReplaySlice(
    sessionId: string,
    messageId: string,
    options: DeepChatTapeReplayExportOptions = {}
  ): DeepChatTapeReplaySlice | null {
    if (options.requestSeq !== undefined && !isPositiveInteger(options.requestSeq)) {
      throw new Error('requestSeq must be a positive integer.')
    }

    const manifests = this.listViewManifestsByMessage(sessionId, messageId)
    const manifestRecord =
      options.requestSeq === undefined
        ? manifests[0]
        : manifests.find((record) => record.requestSeq === options.requestSeq)
    if (!manifestRecord) {
      return null
    }

    return this.buildReplaySlice(sessionId, messageId, manifestRecord, options)
  }

  readCausalObservationSlice(
    sessionId: string,
    messageId: string,
    options: DeepChatCausalObservationReadOptions = {}
  ): DeepChatCausalObservationSlice {
    if (options.requestSeq !== undefined && !isPositiveInteger(options.requestSeq)) {
      throw new Error('requestSeq must be a positive integer.')
    }

    const rows = this.table.getBySessionExcludingContext(sessionId)
    const manifestRows = rows.filter(
      (row) =>
        row.kind === 'event' &&
        row.name === TAPE_VIEW_MANIFEST_EVENT_NAME &&
        row.source_type === 'runtime_event' &&
        row.source_id === messageId
    )
    const traces = this.providers
      .getMessageTraceReader()
      .listByMessageId(messageId)
      .filter(
        (row) =>
          row.session_id === sessionId &&
          row.message_id === messageId &&
          isPositiveInteger(row.request_seq)
      )

    const requestSeq =
      options.requestSeq ??
      [...manifestRows.map((row) => row.source_seq), ...traces.map((row) => row.request_seq)]
        .filter((value): value is number => typeof value === 'number' && isPositiveInteger(value))
        .reduce<number | null>((latest, value) => Math.max(latest ?? value, value), null)

    let request: DeepChatCausalObservationRequest
    if (requestSeq === null) {
      request = { state: 'request_unavailable', requestSeq: null, trace: null }
    } else {
      const selectedManifestRows = manifestRows.filter((row) => row.source_seq === requestSeq)
      const manifestRecord = selectedManifestRows
        .map((row) => this.toViewManifestRecord(row))
        .find((record) => record?.messageId === messageId && record.requestSeq === requestSeq)
      const trace = this.selectLatestTrace(traces, sessionId, requestSeq)

      if (manifestRecord) {
        request = {
          state: 'manifest_bound',
          requestSeq,
          replay: this.buildReplaySlice(sessionId, messageId, manifestRecord, options)
        }
      } else {
        request = {
          state: selectedManifestRows.length > 0 ? 'manifest_malformed' : 'manifest_missing',
          requestSeq,
          trace: trace
            ? this.toReplayTraceSnapshot(trace, options.includeTracePayload === true)
            : null
        }
      }
    }

    const outputEntries = buildEffectiveTapeView(rows, { includePending: false })
      .rows.filter(
        (row) =>
          (row.kind === 'message' &&
            row.source_type === 'message' &&
            row.source_id === messageId) ||
          ((row.kind === 'tool_call' || row.kind === 'tool_result') &&
            readToolFactMessageId(row) === messageId)
      )
      .map((row) => this.toReplayEntrySnapshot(row, options.includeTapePayloads === true))
    const message = this.providers.getTerminalMessageReader().get(messageId)
    const terminalMessage =
      message?.session_id === sessionId &&
      message.role === 'assistant' &&
      (message.status === 'sent' || message.status === 'error')
        ? {
            status: message.status,
            orderSeq: message.order_seq,
            createdAt: message.created_at,
            updatedAt: message.updated_at,
            contentHash: hashString(message.content),
            metadataHash: hashString(message.metadata)
          }
        : null

    return {
      schemaVersion: 1,
      sessionId,
      messageId,
      request,
      output: {
        correlation: 'message_only',
        entries: outputEntries,
        terminalMessage
      },
      runtime:
        options.currentRuntimeStatus === undefined
          ? { scope: 'unavailable', status: null, eventHistory: 'not_persisted' }
          : {
              scope: 'current_only',
              status: options.currentRuntimeStatus,
              eventHistory: 'not_persisted'
            }
    }
  }

  private buildReplaySlice(
    sessionId: string,
    messageId: string,
    manifestRecord: DeepChatTapeViewManifestRecord,
    options: DeepChatTapeReplayExportOptions
  ): DeepChatTapeReplaySlice {
    const table = this.table
    const manifest = manifestRecord.manifest
    const includedEntryIds = collectEntryIds(manifest.included.map((ref) => ref.entryId))
    const excludedEntryIds = collectEntryIds(manifest.excluded.map((ref) => ref.entryId))
    const contributionSourceEntryIds = collectEntryIds(
      manifest.included.flatMap((ref) => ref.sourceEntryIds ?? [])
    )
    const skillContextEntryIds =
      manifest.schemaVersion === 6 || manifest.schemaVersion === 7
        ? collectEntryIds(
            manifest.skillContexts.flatMap((context) => [
              context.authoritativeRef.entryId,
              ...('executionRef' in context ? [context.executionRef.entryId] : []),
              ...context.sourceEntryIds
            ])
          )
        : []
    const anchorEntryIds = collectEntryIds([
      ...manifest.anchorEntryIds,
      ...contributionSourceEntryIds
    ])
    const selectedEntryIds = new Set([
      manifestRecord.entryId,
      ...includedEntryIds,
      ...excludedEntryIds,
      ...anchorEntryIds,
      ...skillContextEntryIds
    ])
    const selectedRows = table.getByEntryIds(sessionId, [...selectedEntryIds])
    const entries = selectedRows.map((row) =>
      this.toReplayEntrySnapshot(row, options.includeTapePayloads === true)
    )
    const foundEntryIds = new Set(entries.map((entry) => entry.entryId))
    let skillEvidenceValid = skillContextEntryIds.every((entryId) => foundEntryIds.has(entryId))
    if (skillEvidenceValid && (manifest.schemaVersion === 6 || manifest.schemaVersion === 7)) {
      try {
        const manifestRow = selectedRows.find((row) => row.entry_id === manifestRecord.entryId)
        if (!manifestRow) throw new Error('Skill-bearing ViewManifest occurrence is missing.')
        this.requireValidStoredSkillManifestOccurrence(manifestRow, manifest)
      } catch {
        skillEvidenceValid = false
      }
    }

    const trace = this.findReplayTrace(sessionId, messageId, manifestRecord.requestSeq)
    const createdAt = Date.now()
    const sliceBase: Omit<DeepChatTapeReplaySlice, 'hashes'> & {
      hashes: Omit<DeepChatTapeReplaySlice['hashes'], 'sliceHash'> & { sliceHash: '' }
    } = {
      schemaVersion: 1 as const,
      sliceId: `replay_${hashJson({
        sessionId,
        messageId,
        requestSeq: manifestRecord.requestSeq,
        manifestHash: manifest.hashes.manifestHash
      }).slice(0, 16)}`,
      sessionId,
      messageId,
      requestSeq: manifestRecord.requestSeq,
      mode: trace ? 'trace_bound' : 'manifest_only',
      manifestRecord,
      trace: trace ? this.toReplayTraceSnapshot(trace, options.includeTracePayload === true) : null,
      entries,
      refs: {
        manifestEntryId: manifestRecord.entryId,
        includedEntryIds,
        excludedEntryIds,
        anchorEntryIds,
        ...(manifest.schemaVersion === 6 || manifest.schemaVersion === 7
          ? { skillContextEntryIds }
          : {})
      },
      hashes: {
        manifestHash: manifest.hashes.manifestHash,
        sliceHash: ''
      },
      integrity: skillEvidenceValid ? manifestRecord.integrity : 'invalid',
      createdAt
    }

    return withReplaySliceHash(sliceBase)
  }

  private toViewManifestRecord(row: DeepChatTapeEntryRow): DeepChatTapeViewManifestRecord | null {
    const payload = parseJsonObject(row.payload_json)
    const data = payload.data
    const rawManifest =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>).manifest
        : undefined
    const manifest = normalizeStoredTapeViewManifest(rawManifest, row.session_id)
    if (
      !manifest ||
      manifest.messageId !== row.source_id ||
      manifest.requestSeq !== row.source_seq
    ) {
      return null
    }

    return {
      sessionId: row.session_id,
      messageId: manifest.messageId,
      requestSeq: manifest.requestSeq,
      entryId: row.entry_id,
      createdAt: row.created_at,
      integrity: verifyTapeViewManifestHash(manifest),
      manifest
    }
  }

  private findReplayTrace(
    sessionId: string,
    messageId: string,
    requestSeq: number
  ): DeepChatMessageTraceRow | null {
    const traceTable = this.providers.getMessageTraceReader()
    return this.selectLatestTrace(traceTable.listByMessageId(messageId), sessionId, requestSeq)
  }

  private selectLatestTrace(
    rows: DeepChatMessageTraceRow[],
    sessionId: string,
    requestSeq: number
  ): DeepChatMessageTraceRow | null {
    return (
      rows
        .filter((row) => row.session_id === sessionId && row.request_seq === requestSeq)
        .toSorted(
          (left, right) =>
            (right.physical_attempt ?? 0) - (left.physical_attempt ?? 0) ||
            right.created_at - left.created_at ||
            right.id.localeCompare(left.id)
        )[0] ?? null
    )
  }

  private toReplayEntrySnapshot(
    row: DeepChatTapeEntryRow,
    includePayloads: boolean
  ): DeepChatTapeReplayEntrySnapshot {
    const snapshot: DeepChatTapeReplayEntrySnapshot = {
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceSeq: row.source_seq,
      provenanceKey: row.provenance_key,
      payloadHash: hashString(row.payload_json),
      metaHash: hashString(row.meta_json),
      createdAt: row.created_at
    }

    if (includePayloads && row.kind !== 'context') {
      snapshot.payload = parseJsonObject(row.payload_json)
      snapshot.meta = parseJsonObject(row.meta_json)
    }

    return snapshot
  }

  private toReplayTraceSnapshot(
    row: DeepChatMessageTraceRow,
    includePayload: boolean
  ): DeepChatTapeReplayTraceSnapshot {
    const snapshot: DeepChatTapeReplayTraceSnapshot = {
      id: row.id,
      requestSeq: row.request_seq,
      logicalRound: row.logical_round,
      physicalAttempt: row.physical_attempt,
      providerId: row.provider_id,
      modelId: row.model_id,
      endpoint: row.endpoint,
      headersHash: hashString(row.headers_json),
      bodyHash: hashString(row.body_json),
      truncated: row.truncated === 1,
      createdAt: row.created_at
    }

    if (includePayload) {
      snapshot.headersJson = row.headers_json
      snapshot.bodyJson = row.body_json
    }

    return snapshot
  }
}
