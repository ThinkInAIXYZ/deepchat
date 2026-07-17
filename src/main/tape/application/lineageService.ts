import { createHash } from 'crypto'
import type {
  SubagentTapeLinkInput,
  SubagentTapeLinkOutcome,
  SubagentTapeLinkReceipt
} from '@shared/types/agent-interface'
import {
  TAPE_INCARNATION_META_KEY,
  type DeepChatTapeEntryRow,
  type DeepChatTapeReadSource
} from '../domain/entry'
import type { TapeApplicationProviders } from '../ports/application'
import { parseJsonObject, parseJsonValue } from './common'

type TapeLineageProviders = Pick<
  TapeApplicationProviders,
  'getEntryStore' | 'getLineageSessionReader'
>

function compactText(value: string, maxLength = 1000): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

const SUBAGENT_TAPE_LINK_EVENT_NAME = 'subagent/tape_linked'

const SUBAGENT_TAPE_LINK_VERSION = 2

const TAPE_IDENTITY_PATTERN = /^[a-f0-9]{64}$/

const SUBAGENT_TAPE_LINK_OUTCOMES = new Set<SubagentTapeLinkOutcome>([
  'completed',
  'error',
  'cancelled'
])

type SubagentTapeLinkSnapshot = {
  linkEntryId: number
  childSessionId: string
  childHeadEntryId: number
  childEntryCount: number
  outcome: SubagentTapeLinkOutcome
  childTapeIdentity: string | null
}

type ParsedSubagentTapeLink = {
  snapshot: SubagentTapeLinkSnapshot
  frozenInput: SubagentTapeLinkInput
}

export type LinkedTapeSourceResolution = {
  sources: DeepChatTapeReadSource[]
  unavailableSourceIds: Set<string>
}

export type AgentTapeViewErrorCode =
  | 'current_tape_unavailable'
  | 'linked_tape_unavailable'
  | 'linked_tape_unauthorized'

export class AgentTapeViewError extends Error {
  readonly name = 'AgentTapeViewError'

  constructor(
    readonly code: AgentTapeViewErrorCode,
    readonly parentSessionId: string,
    readonly sourceSessionId: string,
    message: string
  ) {
    super(message)
  }
}

export function normalizeSubagentTapeLinkInput(
  input: SubagentTapeLinkInput
): SubagentTapeLinkInput {
  const normalized = {
    parentSessionId: input.parentSessionId.trim(),
    childSessionId: input.childSessionId.trim(),
    runId: input.runId.trim(),
    taskId: input.taskId.trim(),
    slotId: input.slotId.trim(),
    taskTitle: compactText(input.taskTitle, 500),
    outcome: input.outcome,
    resultSummary: input.resultSummary?.trim() ? compactText(input.resultSummary, 2000) : null
  }
  for (const [name, value] of Object.entries(normalized)) {
    if (name === 'resultSummary' || name === 'outcome') continue
    if (typeof value !== 'string' || !value) {
      throw new Error(`Subagent Tape link ${name} is required.`)
    }
  }
  if (normalized.parentSessionId === normalized.childSessionId) {
    throw new Error('Subagent Tape link child must differ from its parent.')
  }
  if (!SUBAGENT_TAPE_LINK_OUTCOMES.has(normalized.outcome)) {
    throw new Error(`Invalid subagent Tape link outcome: ${String(normalized.outcome)}`)
  }
  return normalized
}

function isUnmarkedLegacyTape(row: DeepChatTapeEntryRow): boolean {
  const meta = parseJsonValue(row.meta_json)
  return (
    meta !== null &&
    typeof meta === 'object' &&
    !Array.isArray(meta) &&
    !Object.prototype.hasOwnProperty.call(meta, TAPE_INCARNATION_META_KEY)
  )
}

function computeTapeIdentity(row: DeepChatTapeEntryRow): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        row.session_id,
        row.entry_id,
        row.kind,
        row.name,
        row.source_type,
        row.source_id,
        row.source_seq,
        row.provenance_key,
        row.payload_json,
        row.meta_json,
        row.created_at
      ])
    )
    .digest('hex')
}

function subagentTapeLinkProvenanceKey(input: SubagentTapeLinkInput): string {
  // This version belongs to the stable task-identity key, independently of the evolving event
  // payload's linkVersion.
  const identityHash = createHash('sha256')
    .update(
      JSON.stringify([input.parentSessionId, input.childSessionId, input.runId, input.taskId])
    )
    .digest('hex')
  return `subagent:tape-link:v1:${identityHash}`
}

function parseSubagentTapeLink(row: DeepChatTapeEntryRow): ParsedSubagentTapeLink | null {
  const payload = parseJsonObject(row.payload_json)
  const data =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : {}
  const childSessionId = data.childSessionId
  const childHeadEntryId = data.childHeadEntryId
  const childEntryCount = data.childEntryCount
  const outcome = data.outcome
  const runId = data.runId
  const taskId = data.taskId
  const slotId = data.slotId
  const taskTitle = data.taskTitle
  const resultSummary = data.resultSummary
  const linkVersion = data.linkVersion
  const childTapeIdentity = data.childTapeIdentity
  const hasValidLinkVersion =
    (linkVersion === 1 && childTapeIdentity === undefined) ||
    (linkVersion === SUBAGENT_TAPE_LINK_VERSION &&
      typeof childTapeIdentity === 'string' &&
      TAPE_IDENTITY_PATTERN.test(childTapeIdentity))
  if (
    row.kind !== 'event' ||
    row.name !== SUBAGENT_TAPE_LINK_EVENT_NAME ||
    typeof childSessionId !== 'string' ||
    !childSessionId ||
    typeof childHeadEntryId !== 'number' ||
    !Number.isSafeInteger(childHeadEntryId) ||
    childHeadEntryId < 0 ||
    typeof childEntryCount !== 'number' ||
    !Number.isSafeInteger(childEntryCount) ||
    childEntryCount < 0 ||
    typeof outcome !== 'string' ||
    !SUBAGENT_TAPE_LINK_OUTCOMES.has(outcome as SubagentTapeLinkOutcome) ||
    typeof runId !== 'string' ||
    typeof taskId !== 'string' ||
    typeof slotId !== 'string' ||
    typeof taskTitle !== 'string' ||
    (resultSummary !== null && typeof resultSummary !== 'string') ||
    !hasValidLinkVersion ||
    row.source_type !== 'subagent' ||
    row.source_id !== childSessionId ||
    row.source_seq !== childHeadEntryId ||
    childEntryCount > childHeadEntryId
  ) {
    return null
  }

  let normalizedInput: SubagentTapeLinkInput
  try {
    normalizedInput = normalizeSubagentTapeLinkInput({
      parentSessionId: row.session_id,
      childSessionId,
      runId,
      taskId,
      slotId,
      taskTitle,
      outcome: outcome as SubagentTapeLinkOutcome,
      resultSummary
    })
  } catch {
    return null
  }
  if (
    normalizedInput.parentSessionId !== row.session_id ||
    normalizedInput.childSessionId !== childSessionId ||
    normalizedInput.runId !== runId ||
    normalizedInput.taskId !== taskId ||
    normalizedInput.slotId !== slotId ||
    normalizedInput.taskTitle !== taskTitle ||
    normalizedInput.resultSummary !== resultSummary ||
    row.provenance_key !== subagentTapeLinkProvenanceKey(normalizedInput)
  ) {
    return null
  }

  return {
    snapshot: {
      linkEntryId: row.entry_id,
      childSessionId,
      childHeadEntryId,
      childEntryCount,
      outcome: outcome as SubagentTapeLinkOutcome,
      childTapeIdentity:
        linkVersion === SUBAGENT_TAPE_LINK_VERSION ? (childTapeIdentity as string) : null
    },
    frozenInput: normalizedInput
  }
}

function parseSubagentTapeLinkSnapshot(row: DeepChatTapeEntryRow): SubagentTapeLinkSnapshot | null {
  return parseSubagentTapeLink(row)?.snapshot ?? null
}

function parseLegacyExternalTapeLinkSnapshot(
  row: DeepChatTapeEntryRow
): SubagentTapeLinkSnapshot | null {
  if (row.kind !== 'event' || row.name !== 'fork/merge' || row.source_type !== 'fork') {
    return null
  }
  const payload = parseJsonObject(row.payload_json)
  const data =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : {}
  const childSessionId = data.forkSessionId
  const forkId = data.forkId
  const referencedEntryCount = data.referencedEntryCount
  if (
    typeof childSessionId !== 'string' ||
    !childSessionId ||
    forkId !== childSessionId ||
    row.source_id !== childSessionId ||
    row.source_seq !== 0 ||
    row.provenance_key !== `fork:${row.session_id}:${childSessionId}:external-merge:event` ||
    typeof referencedEntryCount !== 'number' ||
    !Number.isSafeInteger(referencedEntryCount) ||
    referencedEntryCount <= 0
  ) {
    return null
  }
  return {
    linkEntryId: row.entry_id,
    childSessionId,
    childHeadEntryId: referencedEntryCount,
    childEntryCount: referencedEntryCount,
    outcome: 'completed',
    childTapeIdentity: null
  }
}

function toSubagentTapeLinkReceipt(row: DeepChatTapeEntryRow): SubagentTapeLinkReceipt {
  const snapshot = parseSubagentTapeLinkSnapshot(row)
  if (!snapshot) {
    throw new Error(`Stored subagent Tape link receipt is malformed: ${row.entry_id}`)
  }
  return {
    linkEntry: {
      sessionId: row.session_id,
      entryId: snapshot.linkEntryId
    },
    childSessionId: snapshot.childSessionId,
    childHeadEntryId: snapshot.childHeadEntryId,
    childEntryCount: snapshot.childEntryCount,
    outcome: snapshot.outcome
  }
}

function assertSubagentTapeLinkMatchesInput(
  row: DeepChatTapeEntryRow,
  input: SubagentTapeLinkInput
): void {
  const parsed = parseSubagentTapeLink(row)
  if (!parsed) {
    throw new Error(`Stored subagent Tape link receipt is malformed: ${row.entry_id}`)
  }
  const storedInput = parsed.frozenInput
  const storedKeys = Object.keys(storedInput) as Array<keyof SubagentTapeLinkInput>
  if (
    storedKeys.length !== Object.keys(input).length ||
    storedKeys.some((key) => storedInput[key] !== input[key])
  ) {
    throw new Error(
      `Subagent Tape link conflicts with finalized task ${input.runId}/${input.taskId}.`
    )
  }
}

export class TapeLineageService {
  constructor(private readonly providers: TapeLineageProviders) {}

  private get table() {
    return this.providers.getEntryStore()
  }

  resolveLinkedTapeSources(parentSessionId: string): LinkedTapeSourceResolution {
    const table = this.table
    const sessionTable = this.providers.getLineageSessionReader()
    if (!table || !sessionTable?.get(parentSessionId)) {
      throw new AgentTapeViewError(
        'current_tape_unavailable',
        parentSessionId,
        parentSessionId,
        `Current Tape ${parentSessionId} is unavailable.`
      )
    }

    const parsedSnapshots = table
      .getSubagentLineageEvents(parentSessionId)
      .map((row) => parseSubagentTapeLinkSnapshot(row) ?? parseLegacyExternalTapeLinkSnapshot(row))
      .filter((snapshot): snapshot is SubagentTapeLinkSnapshot => snapshot !== null)
    const latestSnapshotByChild = new Map<string, SubagentTapeLinkSnapshot>()
    for (const snapshot of parsedSnapshots) {
      const current = latestSnapshotByChild.get(snapshot.childSessionId)
      if (!current || snapshot.linkEntryId > current.linkEntryId) {
        latestSnapshotByChild.set(snapshot.childSessionId, snapshot)
      }
    }
    const snapshots = [...latestSnapshotByChild.values()]
    const childSessionIds = [...new Set(snapshots.map((snapshot) => snapshot.childSessionId))]
    const childById = new Map(sessionTable.getMany(childSessionIds).map((row) => [row.id, row]))
    const unavailableSourceIds = new Set<string>()
    const snapshotBySource = new Map<string, SubagentTapeLinkSnapshot>()

    for (const snapshot of snapshots) {
      const child = childById.get(snapshot.childSessionId)
      if (!child) {
        unavailableSourceIds.add(snapshot.childSessionId)
        continue
      }
      if (child.session_kind !== 'subagent' || child.parent_session_id !== parentSessionId) {
        continue
      }
      snapshotBySource.set(snapshot.childSessionId, snapshot)
    }

    const authorizedSourceIds = [...snapshotBySource.keys()]
    const firstEntryBySource = new Map(
      table.getFirstEntriesBySessions(authorizedSourceIds).map((row) => [row.session_id, row])
    )
    const liveHeads = table.getMaxEntryIdsBySessions(authorizedSourceIds)
    const availableSources: DeepChatTapeReadSource[] = []
    for (const [sourceSessionId, snapshot] of snapshotBySource) {
      const firstEntry = firstEntryBySource.get(sourceSessionId)
      const identityMatches = snapshot.childTapeIdentity
        ? firstEntry !== undefined && computeTapeIdentity(firstEntry) === snapshot.childTapeIdentity
        : firstEntry !== undefined && isUnmarkedLegacyTape(firstEntry)
      if (!identityMatches || (liveHeads.get(sourceSessionId) ?? 0) < snapshot.childHeadEntryId) {
        unavailableSourceIds.add(sourceSessionId)
        continue
      }
      availableSources.push({
        sessionId: sourceSessionId,
        maxEntryId: snapshot.childHeadEntryId
      })
    }

    return {
      sources: availableSources.sort((left, right) =>
        left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0
      ),
      unavailableSourceIds
    }
  }

  linkSubagentTape(input: SubagentTapeLinkInput): SubagentTapeLinkReceipt {
    const table = this.table
    const sessionTable = this.providers.getLineageSessionReader()
    const normalized = normalizeSubagentTapeLinkInput(input)
    const provenanceKey = subagentTapeLinkProvenanceKey(normalized)
    return table.runInTransaction(() => {
      const existing = table.getByProvenanceKey(normalized.parentSessionId, provenanceKey)
      if (existing) {
        assertSubagentTapeLinkMatchesInput(existing, normalized)
        const receipt = toSubagentTapeLinkReceipt(existing)
        return receipt
      }

      const sessionById = new Map(
        sessionTable
          .getMany([normalized.parentSessionId, normalized.childSessionId])
          .map((session) => [session.id, session])
      )
      const parent = sessionById.get(normalized.parentSessionId)
      const child = sessionById.get(normalized.childSessionId)
      if (
        !parent ||
        !child ||
        child.session_kind !== 'subagent' ||
        child.parent_session_id !== normalized.parentSessionId
      ) {
        throw new Error(
          `Session ${normalized.childSessionId} is not a direct subagent child of ` +
            `${normalized.parentSessionId}.`
        )
      }

      const childFirstEntry = table.getFirstEntriesBySessions([normalized.childSessionId])[0]
      if (!childFirstEntry || childFirstEntry.session_id !== normalized.childSessionId) {
        throw new Error(`Subagent Tape ${normalized.childSessionId} is unavailable.`)
      }
      const childTapeIdentity = computeTapeIdentity(childFirstEntry)
      const childHeadEntryId = table.getMaxEntryId(normalized.childSessionId)
      const childEntryCount = table.countBySession(normalized.childSessionId)
      const row = table.appendEvent({
        sessionId: normalized.parentSessionId,
        name: SUBAGENT_TAPE_LINK_EVENT_NAME,
        source: {
          type: 'subagent',
          id: normalized.childSessionId,
          seq: childHeadEntryId
        },
        provenanceKey,
        data: {
          linkVersion: SUBAGENT_TAPE_LINK_VERSION,
          childSessionId: normalized.childSessionId,
          childHeadEntryId,
          childEntryCount,
          childTapeIdentity,
          runId: normalized.runId,
          taskId: normalized.taskId,
          slotId: normalized.slotId,
          taskTitle: normalized.taskTitle,
          outcome: normalized.outcome,
          resultSummary: normalized.resultSummary
        },
        idempotent: true
      })
      assertSubagentTapeLinkMatchesInput(row, normalized)
      const receipt = toSubagentTapeLinkReceipt(row)
      return receipt
    })
  }
}
