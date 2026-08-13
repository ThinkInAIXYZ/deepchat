import Database from 'better-sqlite3-multiple-ciphers'
import logger from '@shared/logger'
import { BaseTable } from '@/data/baseTable'
import { randomUUID } from 'crypto'
import {
  normalizeDeepChatTapeReadSources,
  serializeDeepChatTapeReadSources,
  SUMMARY_ANCHOR_NAMES,
  TAPE_INCARNATION_META_KEY,
  type DeepChatTapeAppendInput,
  type DeepChatTapeEntryRow,
  type DeepChatTapeReadSource,
  type DeepChatTapeSearchInput,
  type DeepChatTapeSourceType,
  type TapeAnchorAppendInput,
  type TapeEventAppendInput
} from '@/tape/domain/entry'
import { DEFAULT_EXCLUDED_TAPE_EVENT_NAMES } from '@/tape/domain/effectiveView'
import {
  EXECUTION_JOURNAL_EVENT_NAMES,
  isExecutionJournalReservedName,
  type ExecutionJournalEventName
} from '@/tape/domain/executionJournal'
import {
  CONTRACT_TAPE_EVENT_NAMES,
  isContractTapeReservedName,
  type ContractTapeEventName
} from '@/tape/domain/contractFacts'
import { SKILL_MATERIALIZATION_NAME } from '@/tape/domain/skillMaterialization'
import type {
  ContractPersistenceStore,
  ExecutionJournalPersistenceStore,
  TapeBootstrapStore,
  TapeEntryStore,
  TapeMutationProjection,
  SkillMaterializationPersistenceStore,
  TapeTransactionRunner
} from '@/tape/ports/storage'

export {
  normalizeDeepChatTapeReadSources,
  serializeDeepChatTapeReadSources,
  SUMMARY_ANCHOR_NAMES,
  TAPE_INCARNATION_META_KEY
} from '@/tape/domain/entry'
export type {
  DeepChatTapeAppendInput,
  DeepChatTapeEntryKind,
  DeepChatTapeEntryRow,
  DeepChatTapeReadSource,
  DeepChatTapeSearchInput,
  DeepChatTapeSourceInput,
  DeepChatTapeSourceType,
  TapeAnchorAppendInput,
  TapeEventAppendInput
} from '@/tape/domain/entry'

export type DeepChatTapeMutationProjection = TapeMutationProjection

const RECONSTRUCTION_ANCHOR_NAMES = SUMMARY_ANCHOR_NAMES

const TAPE_ENTRY_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_deepchat_tape_entries_session_kind
    ON deepchat_tape_entries(session_id, kind, entry_id);
  CREATE INDEX IF NOT EXISTS idx_deepchat_tape_entries_session_name
    ON deepchat_tape_entries(session_id, name, entry_id);
  CREATE INDEX IF NOT EXISTS idx_deepchat_tape_entries_session_source
    ON deepchat_tape_entries(session_id, source_type, source_id, source_seq);
  CREATE INDEX IF NOT EXISTS idx_deepchat_tape_entries_event_name
    ON deepchat_tape_entries(name, session_id, entry_id)
    WHERE kind = 'event';
  CREATE INDEX IF NOT EXISTS idx_deepchat_tape_entries_execution_run
    ON deepchat_tape_entries(name, session_id, source_id, entry_id)
    WHERE kind = 'event' AND source_type = 'runtime_event';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_deepchat_tape_entries_session_provenance
    ON deepchat_tape_entries(session_id, provenance_key)
    WHERE provenance_key IS NOT NULL;
`

const EXECUTION_JOURNAL_EVENT_NAMES_SQL = EXECUTION_JOURNAL_EVENT_NAMES.map(
  (name) => `'${name}'`
).join(', ')

export const UNTERMINATED_EXECUTION_JOURNAL_EVENTS_SQL = `
  WITH unterminated_runs AS (
    SELECT DISTINCT started.session_id, started.source_id AS run_id
    FROM deepchat_tape_entries AS started
    WHERE started.kind = 'event'
      AND started.name = 'execution/run_started'
      AND started.source_type = 'runtime_event'
      AND started.source_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM deepchat_tape_entries AS terminal
        WHERE terminal.kind = 'event'
          AND terminal.name = 'execution/run_terminal'
          AND terminal.source_type = 'runtime_event'
          AND terminal.source_seq = 0
          AND terminal.session_id = started.session_id
          AND terminal.source_id = started.source_id
          AND terminal.entry_id > started.entry_id
      )
  )
  SELECT journal.*
  FROM unterminated_runs AS run
  JOIN deepchat_tape_entries AS journal
    ON journal.session_id = run.session_id
   AND journal.source_id = run.run_id
  WHERE journal.kind = 'event'
    AND journal.source_type = 'runtime_event'
    AND journal.name IN (${EXECUTION_JOURNAL_EVENT_NAMES_SQL})
  ORDER BY journal.session_id ASC, journal.entry_id ASC
`

function safeJsonStringify(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {})
}

function buildProvenanceKey(input: DeepChatTapeAppendInput): string | null {
  if (input.provenanceKey !== undefined) {
    return input.provenanceKey
  }
  if (!input.source?.type || !input.source.id) {
    return null
  }
  return [
    input.source.type,
    input.source.id,
    input.source.seq ?? 0,
    input.kind,
    input.name ?? ''
  ].join(':')
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

// Three LIKE parameters per field group stay below SQLite's portable 999-variable floor after
// source, filter, and limit bindings.
const MAX_TAPE_SEARCH_TOKEN_CLAUSES = 256

function tokenizeDeepChatTapeSearchQuery(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

export function buildDeepChatTapeFtsMatch(value: string): string {
  const tokens = tokenizeDeepChatTapeSearchQuery(value)
  const values =
    tokens.length > 1 && tokens.length <= MAX_TAPE_SEARCH_TOKEN_CLAUSES ? tokens : [value]
  return values.map((token) => `"${token.replace(/"/g, '""')}"`).join(' AND ')
}

export function buildDeepChatTapeLikeSearchPredicate(
  fieldExpressions: readonly [string, ...string[]],
  normalizedQuery: string
): { sql: string; params: string[] } {
  const fieldClause = `(${fieldExpressions
    .map((field) => `${field} LIKE ? ESCAPE '\\'`)
    .join(' OR ')})`
  const queryClauses = [fieldClause]
  const queryPattern = `%${escapeLikePattern(normalizedQuery)}%`
  const params = fieldExpressions.map(() => queryPattern)
  const tokens = tokenizeDeepChatTapeSearchQuery(normalizedQuery)

  if (tokens.length > 1 && tokens.length <= MAX_TAPE_SEARCH_TOKEN_CLAUSES) {
    queryClauses.push(`(${tokens.map(() => fieldClause).join(' AND ')})`)
    for (const token of tokens) {
      const tokenPattern = `%${escapeLikePattern(token)}%`
      params.push(...fieldExpressions.map(() => tokenPattern))
    }
  }

  return {
    sql: `(${queryClauses.join(' OR ')})`,
    params
  }
}

const AUTHORIZED_TAPE_SOURCES_CTE_SQL = `
  authorized_sources(session_id, max_entry_id) AS (
    SELECT
      json_extract(value, '$.sessionId'),
      CAST(json_extract(value, '$.maxEntryId') AS INTEGER)
    FROM json_each(?)
  )
`

const DEFAULT_EXCLUDED_TAPE_EVENT_NAMES_SQL = DEFAULT_EXCLUDED_TAPE_EVENT_NAMES.map(
  (name) => `'${name.replaceAll("'", "''")}'`
).join(', ')

function effectiveTapeMessagePredicateSql(alias: string): string {
  return `
    json_type(${alias}.payload_json, '$.record') = 'object'
    AND typeof(json_extract(${alias}.payload_json, '$.record.id')) = 'text'
    AND typeof(json_extract(${alias}.payload_json, '$.record.sessionId')) = 'text'
    AND typeof(json_extract(${alias}.payload_json, '$.record.orderSeq')) IN ('integer', 'real')
    AND json_extract(${alias}.payload_json, '$.record.role') IN ('user', 'assistant')
    AND typeof(json_extract(${alias}.payload_json, '$.record.content')) = 'text'
    AND (
      json_extract(${alias}.payload_json, '$.record.status') IS NULL
      OR json_extract(${alias}.payload_json, '$.record.status') != 'pending'
    )
  `
}

function tapeRetractionMessageIdSql(alias: string): string {
  return `
    CASE
      WHEN json_type(${alias}.payload_json, '$.data') = 'object'
        THEN json_extract(${alias}.payload_json, '$.data.messageId')
      WHEN json_type(${alias}.payload_json, '$.data') = 'text'
        AND json_valid(json_extract(${alias}.payload_json, '$.data'))
        THEN json_extract(json_extract(${alias}.payload_json, '$.data'), '$.messageId')
      ELSE NULL
    END
  `
}

function tapeToolCallIdSql(alias: string): string {
  return `
    CASE
      WHEN ${alias}.kind = 'tool_result'
        THEN json_extract(${alias}.payload_json, '$.toolCallId')
      WHEN json_type(${alias}.payload_json, '$.toolCall') = 'object'
        THEN json_extract(${alias}.payload_json, '$.toolCall.id')
      WHEN json_type(${alias}.payload_json, '$.toolCall') = 'text'
        AND json_valid(json_extract(${alias}.payload_json, '$.toolCall'))
        THEN json_extract(json_extract(${alias}.payload_json, '$.toolCall'), '$.id')
      ELSE NULL
    END
  `
}

function effectiveTapeMessageOrderSeqSql(toolAlias: string, sourceAlias: string): string {
  return `
    SELECT json_extract(message.payload_json, '$.record.orderSeq')
    FROM deepchat_tape_entries AS message
    WHERE message.session_id = ${toolAlias}.session_id
      AND message.entry_id <= ${sourceAlias}.max_entry_id
      AND message.kind = 'message'
      AND ${effectiveTapeMessagePredicateSql('message')}
      AND json_extract(message.payload_json, '$.record.id') =
        json_extract(${toolAlias}.payload_json, '$.messageId')
      AND NOT EXISTS (
        SELECT 1
        FROM deepchat_tape_entries AS later_message
        WHERE later_message.session_id = message.session_id
          AND later_message.entry_id > message.entry_id
          AND later_message.entry_id <= ${sourceAlias}.max_entry_id
          AND later_message.kind = 'message'
          AND ${effectiveTapeMessagePredicateSql('later_message')}
          AND json_extract(later_message.payload_json, '$.record.id') =
            json_extract(message.payload_json, '$.record.id')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM deepchat_tape_entries AS retraction
        WHERE retraction.session_id = message.session_id
          AND retraction.entry_id > message.entry_id
          AND retraction.entry_id <= ${sourceAlias}.max_entry_id
          AND retraction.kind = 'event'
          AND retraction.name = 'message/retracted'
          AND (${tapeRetractionMessageIdSql('retraction')}) =
            json_extract(message.payload_json, '$.record.id')
      )
    ORDER BY message.entry_id DESC
    LIMIT 1
  `
}

function projectedTapePayloadSql(rowAlias: string, sourceAlias: string): string {
  return `
    CASE
      WHEN ${rowAlias}.kind IN ('tool_call', 'tool_result')
        THEN json_set(
          ${rowAlias}.payload_json,
          '$.orderSeq',
          COALESCE(
            (${effectiveTapeMessageOrderSeqSql(rowAlias, sourceAlias)}),
            json_extract(${rowAlias}.payload_json, '$.orderSeq')
          )
        )
      ELSE ${rowAlias}.payload_json
    END
  `
}

// These read-only SQL forms mirror deepchatTapeEffectiveSemantics. Search uses correlated
// candidate validation to avoid materializing a whole linked Tape; context uses the complete
// effective CTE because it needs stable neighboring-row positions. Native tests cover parity for
// replacement, retraction, head cutoff, window ordering, and derived tool order.
const EFFECTIVE_TAPE_ROWS_CTE_SQL = `
  bounded_rows AS (
    SELECT tape.*
    FROM deepchat_tape_entries AS tape
    INNER JOIN authorized_sources AS source
      ON source.session_id = tape.session_id
      AND tape.entry_id <= source.max_entry_id
    WHERE tape.kind != 'context'
  ),
  raw_message_candidates AS (
    SELECT
      bounded_rows.*,
      json_extract(payload_json, '$.record.id') AS message_id
    FROM bounded_rows
    WHERE kind = 'message'
  ),
  message_candidates AS (
    SELECT *
    FROM raw_message_candidates
    WHERE ${effectiveTapeMessagePredicateSql('raw_message_candidates')}
  ),
  ranked_messages AS (
    SELECT
      message_candidates.*,
      ROW_NUMBER() OVER (
        PARTITION BY session_id, message_id
        ORDER BY entry_id DESC
      ) AS candidate_rank
    FROM message_candidates
  ),
  effective_message_rows AS (
    SELECT ranked_messages.*
    FROM ranked_messages
    WHERE candidate_rank = 1
      AND NOT EXISTS (
        SELECT 1
        FROM bounded_rows AS retraction
        WHERE retraction.session_id = ranked_messages.session_id
          AND retraction.kind = 'event'
          AND retraction.name = 'message/retracted'
          AND retraction.entry_id > ranked_messages.entry_id
          AND (${tapeRetractionMessageIdSql('retraction')}) = ranked_messages.message_id
      )
  ),
  raw_tool_candidates AS (
    SELECT
      bounded_rows.*,
      json_extract(payload_json, '$.messageId') AS message_id,
      (${tapeToolCallIdSql('bounded_rows')}) AS tool_call_id,
      json_extract(meta_json, '$.status') AS tool_status
    FROM bounded_rows
    WHERE kind IN ('tool_call', 'tool_result')
  ),
  tool_candidates AS (
    SELECT *
    FROM raw_tool_candidates
    WHERE typeof(message_id) = 'text'
      AND length(message_id) > 0
      AND typeof(tool_call_id) = 'text'
      AND length(tool_call_id) > 0
      AND tool_status IN ('success', 'error')
  ),
  ranked_tools AS (
    SELECT
      tool_candidates.*,
      ROW_NUMBER() OVER (
        PARTITION BY session_id, kind, message_id, tool_call_id
        ORDER BY entry_id DESC
      ) AS candidate_rank
    FROM tool_candidates
  ),
  effective_rows AS (
    SELECT
      session_id, entry_id, kind, name, source_type, source_id, source_seq,
      provenance_key, payload_json, meta_json, created_at
    FROM bounded_rows
    WHERE kind = 'anchor'
    UNION ALL
    SELECT
      session_id, entry_id, kind, name, source_type, source_id, source_seq,
      provenance_key, payload_json, meta_json, created_at
    FROM bounded_rows
    WHERE kind = 'event'
      AND (
        name IS NULL
        OR (
          name NOT IN (${DEFAULT_EXCLUDED_TAPE_EVENT_NAMES_SQL})
          AND name NOT GLOB 'contract/*'
        )
      )
    UNION ALL
    SELECT
      session_id, entry_id, kind, name, source_type, source_id, source_seq,
      provenance_key, payload_json, meta_json, created_at
    FROM effective_message_rows
    UNION ALL
    SELECT
      ranked_tools.session_id,
      ranked_tools.entry_id,
      ranked_tools.kind,
      ranked_tools.name,
      ranked_tools.source_type,
      ranked_tools.source_id,
      ranked_tools.source_seq,
      ranked_tools.provenance_key,
      json_set(
        ranked_tools.payload_json,
        '$.orderSeq',
        json_extract(message.payload_json, '$.record.orderSeq')
      ) AS payload_json,
      ranked_tools.meta_json,
      ranked_tools.created_at
    FROM ranked_tools
    INNER JOIN effective_message_rows AS message
      ON message.session_id = ranked_tools.session_id
      AND message.message_id = ranked_tools.message_id
    WHERE ranked_tools.candidate_rank = 1
  )
`

const EFFECTIVE_TAPE_SEARCH_ROW_PREDICATE_SQL = `
  candidate.kind = 'anchor'
  OR (
    candidate.kind = 'event'
    AND (
      candidate.name IS NULL
      OR (
        candidate.name NOT IN (${DEFAULT_EXCLUDED_TAPE_EVENT_NAMES_SQL})
        AND candidate.name NOT GLOB 'contract/*'
      )
    )
  )
  OR (
    candidate.kind = 'message'
    AND ${effectiveTapeMessagePredicateSql('candidate')}
    AND NOT EXISTS (
      SELECT 1
      FROM deepchat_tape_entries AS later_message
      WHERE later_message.session_id = candidate.session_id
        AND later_message.entry_id > candidate.entry_id
        AND later_message.entry_id <= source.max_entry_id
        AND later_message.kind = 'message'
        AND ${effectiveTapeMessagePredicateSql('later_message')}
        AND json_extract(later_message.payload_json, '$.record.id') =
          json_extract(candidate.payload_json, '$.record.id')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM deepchat_tape_entries AS retraction
      WHERE retraction.session_id = candidate.session_id
        AND retraction.entry_id > candidate.entry_id
        AND retraction.entry_id <= source.max_entry_id
        AND retraction.kind = 'event'
        AND retraction.name = 'message/retracted'
        AND (${tapeRetractionMessageIdSql('retraction')}) =
          json_extract(candidate.payload_json, '$.record.id')
    )
  )
  OR (
    candidate.kind IN ('tool_call', 'tool_result')
    AND json_extract(candidate.meta_json, '$.status') IN ('success', 'error')
    AND typeof(json_extract(candidate.payload_json, '$.messageId')) = 'text'
    AND length(json_extract(candidate.payload_json, '$.messageId')) > 0
    AND typeof((${tapeToolCallIdSql('candidate')})) = 'text'
    AND length((${tapeToolCallIdSql('candidate')})) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM deepchat_tape_entries AS later_tool
      WHERE later_tool.session_id = candidate.session_id
        AND later_tool.entry_id > candidate.entry_id
        AND later_tool.entry_id <= source.max_entry_id
        AND later_tool.kind = candidate.kind
        AND json_extract(later_tool.meta_json, '$.status') IN ('success', 'error')
        AND json_extract(later_tool.payload_json, '$.messageId') =
          json_extract(candidate.payload_json, '$.messageId')
        AND (${tapeToolCallIdSql('later_tool')}) = (${tapeToolCallIdSql('candidate')})
    )
    AND EXISTS (
      SELECT 1
      FROM deepchat_tape_entries AS message
      WHERE message.session_id = candidate.session_id
        AND message.entry_id <= source.max_entry_id
        AND message.kind = 'message'
        AND ${effectiveTapeMessagePredicateSql('message')}
        AND json_extract(message.payload_json, '$.record.id') =
          json_extract(candidate.payload_json, '$.messageId')
        AND NOT EXISTS (
          SELECT 1
          FROM deepchat_tape_entries AS later_message
          WHERE later_message.session_id = message.session_id
            AND later_message.entry_id > message.entry_id
            AND later_message.entry_id <= source.max_entry_id
            AND later_message.kind = 'message'
            AND ${effectiveTapeMessagePredicateSql('later_message')}
            AND json_extract(later_message.payload_json, '$.record.id') =
              json_extract(message.payload_json, '$.record.id')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM deepchat_tape_entries AS retraction
          WHERE retraction.session_id = message.session_id
            AND retraction.entry_id > message.entry_id
            AND retraction.entry_id <= source.max_entry_id
            AND retraction.kind = 'event'
            AND retraction.name = 'message/retracted'
            AND (${tapeRetractionMessageIdSql('retraction')}) =
              json_extract(message.payload_json, '$.record.id')
        )
    )
  )
`

export class DeepChatTapeEntriesTable
  extends BaseTable
  implements
    TapeEntryStore,
    TapeTransactionRunner,
    TapeBootstrapStore,
    SkillMaterializationPersistenceStore
{
  constructor(
    db: Database.Database,
    private readonly mutationProjection?: DeepChatTapeMutationProjection
  ) {
    super(db, 'deepchat_tape_entries')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_tape_entries (
        session_id TEXT NOT NULL,
        entry_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        name TEXT,
        source_type TEXT,
        source_id TEXT,
        source_seq INTEGER,
        provenance_key TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, entry_id)
      );
      ${TAPE_ENTRY_INDEX_SQL}
    `
  }

  public createTable(): void {
    if (!this.tableExists()) {
      this.db.exec(this.getCreateTableSQL())
      return
    }
    this.ensureProvenanceColumns()
    this.db.exec(TAPE_ENTRY_INDEX_SQL)
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  runInTransaction<T>(operation: () => T): T {
    return this.db.transaction(operation)()
  }

  isInTransaction(): boolean {
    return this.db.inTransaction
  }

  append(input: DeepChatTapeAppendInput): DeepChatTapeEntryRow {
    return this.appendInternal(input, null)
  }

  protected appendInternal(
    input: DeepChatTapeAppendInput,
    authorizedNamespace: 'execution' | 'contract' | 'skill-materialized' | null
  ): DeepChatTapeEntryRow {
    if (authorizedNamespace !== 'execution' && isExecutionJournalReservedName(input.name)) {
      throw new Error(
        'The execution/* namespace is reserved for the strict Execution Journal writer.'
      )
    }
    if (authorizedNamespace !== 'contract' && isContractTapeReservedName(input.name)) {
      throw new Error('The contract/* namespace is reserved for the strict Contract writer.')
    }
    if (authorizedNamespace !== 'skill-materialized' && input.name === SKILL_MATERIALIZATION_NAME) {
      throw new Error('skill/materialized is reserved for the strict materialization writer.')
    }
    if (authorizedNamespace !== 'skill-materialized' && input.kind === 'context') {
      throw new Error('The context entry kind is reserved for the strict materialization writer.')
    }
    const append = this.db.transaction(() => {
      const provenanceKey = buildProvenanceKey(input)
      if (input.idempotent && provenanceKey) {
        const existing = this.getByProvenanceKey(input.sessionId, provenanceKey)
        if (existing) {
          return existing
        }
      }

      const createdAt = input.createdAt ?? Date.now()
      const previousSessionMaxEntryId = this.getMaxEntryId(input.sessionId)
      const row = {
        session_id: input.sessionId,
        entry_id: previousSessionMaxEntryId + 1,
        kind: input.kind,
        name: input.name ?? null,
        source_type: input.source?.type ?? null,
        source_id: input.source?.id ?? null,
        source_seq: input.source?.seq ?? null,
        provenance_key: provenanceKey,
        payload_json: safeJsonStringify(input.payload),
        meta_json: safeJsonStringify(input.meta),
        created_at: createdAt
      } satisfies DeepChatTapeEntryRow

      try {
        this.db
          .prepare(
            `INSERT INTO deepchat_tape_entries (
             session_id,
             entry_id,
             kind,
             name,
             source_type,
             source_id,
             source_seq,
             provenance_key,
             payload_json,
             meta_json,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
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
          )
      } catch (error) {
        if (input.idempotent && provenanceKey) {
          const existing = this.getByProvenanceKey(input.sessionId, provenanceKey)
          if (existing) {
            return existing
          }
        }
        throw error
      }

      if (this.mutationProjection) {
        try {
          const applyProjection = this.db.transaction(() =>
            this.mutationProjection?.applyAppendedEntry(row, previousSessionMaxEntryId)
          )
          applyProjection()
        } catch (error) {
          this.mutationProjection.invalidateSession(row.session_id)
          logger.warn(
            `[Tape] memory ingestion projection append failed; session marked stale: ${String(error)}`
          )
        }
      }

      return row
    })

    return append()
  }

  appendSkillMaterialization(input: {
    sessionId: string
    sourceId: string
    provenanceKey: string
    payload: import('@/tape/domain/skillMaterialization').TapeSkillMaterializationPayload
    payloadHash: string
  }): DeepChatTapeEntryRow {
    return this.appendInternal(
      {
        sessionId: input.sessionId,
        kind: 'context',
        name: SKILL_MATERIALIZATION_NAME,
        source: { type: 'runtime_event', id: input.sourceId, seq: 0 },
        provenanceKey: input.provenanceKey,
        payload: { ...input.payload },
        meta: { payloadHash: input.payloadHash },
        idempotent: true
      },
      'skill-materialized'
    )
  }

  appendAnchor(input: TapeAnchorAppendInput): DeepChatTapeEntryRow {
    return this.append({
      sessionId: input.sessionId,
      kind: 'anchor',
      name: input.name,
      source: input.source,
      provenanceKey: input.provenanceKey,
      payload: {
        name: input.name,
        state: input.state
      },
      meta: input.meta,
      createdAt: input.createdAt,
      idempotent: input.idempotent
    })
  }

  appendEvent(input: TapeEventAppendInput): DeepChatTapeEntryRow {
    return this.append({
      sessionId: input.sessionId,
      kind: 'event',
      name: input.name,
      source: input.source,
      provenanceKey: input.provenanceKey,
      payload: {
        name: input.name,
        data: input.data
      },
      meta: input.meta,
      createdAt: input.createdAt,
      idempotent: input.idempotent
    })
  }

  ensureBootstrapAnchor(sessionId: string): void {
    const existing = this.db
      .prepare(
        `SELECT entry_id
         FROM deepchat_tape_entries
         WHERE session_id = ? AND kind = 'anchor'
         ORDER BY entry_id ASC
         LIMIT 1`
      )
      .get(sessionId) as { entry_id: number } | undefined

    if (existing) {
      return
    }

    this.appendAnchor({
      sessionId,
      name: 'session/start',
      source: {
        type: 'session',
        id: sessionId,
        seq: 0
      },
      state: {
        owner: 'human'
      },
      meta: {
        [TAPE_INCARNATION_META_KEY]: randomUUID()
      },
      idempotent: true
    })
  }

  getBySession(sessionId: string): DeepChatTapeEntryRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ?
         ORDER BY entry_id ASC`
      )
      .all(sessionId) as DeepChatTapeEntryRow[]
  }

  getBySessionExcludingContext(sessionId: string): DeepChatTapeEntryRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ? AND kind != 'context'
         ORDER BY entry_id ASC`
      )
      .all(sessionId) as DeepChatTapeEntryRow[]
  }

  getByEntryIds(sessionId: string, entryIds: readonly number[]): DeepChatTapeEntryRow[] {
    const normalizedIds = [...new Set(entryIds)]
      .filter((entryId) => Number.isSafeInteger(entryId) && entryId > 0)
      .sort((left, right) => left - right)
    if (normalizedIds.length === 0) return []

    const rows: DeepChatTapeEntryRow[] = []
    for (let offset = 0; offset < normalizedIds.length; offset += 500) {
      const chunk = normalizedIds.slice(offset, offset + 500)
      const placeholders = chunk.map(() => '?').join(', ')
      rows.push(
        ...(this.db
          .prepare(
            `SELECT * FROM deepchat_tape_entries
             WHERE session_id = ? AND entry_id IN (${placeholders})
             ORDER BY entry_id ASC`
          )
          .all(sessionId, ...chunk) as DeepChatTapeEntryRow[])
      )
    }
    return rows
  }

  getViewManifestEventsByMessage(sessionId: string, messageId: string): DeepChatTapeEntryRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ?
           AND kind = 'event'
           AND name = 'view/assembled'
           AND source_type = 'runtime_event'
           AND source_id = ?
         ORDER BY entry_id ASC`
      )
      .all(sessionId, messageId) as DeepChatTapeEntryRow[]
  }

  getByEntryId(sessionId: string, entryId: number): DeepChatTapeEntryRow | undefined {
    return this.getByEntryIds(sessionId, [entryId])[0]
  }

  getMessageSourceEntries(sessionId: string, messageId: string): DeepChatTapeEntryRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ?
           AND source_type = 'message'
           AND source_id = ?
           AND (kind = 'message' OR (kind = 'event' AND name = 'message/retracted'))
         ORDER BY entry_id ASC`
      )
      .all(sessionId, messageId) as DeepChatTapeEntryRow[]
  }

  getBootstrapIncarnation(sessionId: string): string | undefined {
    const row = this.db
      .prepare(
        "SELECT meta_json FROM deepchat_tape_entries WHERE session_id = ? AND kind = 'anchor' AND name = 'session/start' ORDER BY entry_id ASC LIMIT 1"
      )
      .get(sessionId) as { meta_json: string } | undefined
    if (!row) return undefined
    const value = JSON.parse(row.meta_json) as Record<string, unknown>
    return typeof value[TAPE_INCARNATION_META_KEY] === 'string'
      ? value[TAPE_INCARNATION_META_KEY]
      : undefined
  }

  getMaxEventSourceSeq(
    sessionId: string,
    name: string,
    sourceType: DeepChatTapeSourceType,
    sourceId: string
  ): number {
    const row = this.db
      .prepare(
        `SELECT MAX(source_seq) AS max_source_seq
         FROM deepchat_tape_entries
         WHERE session_id = ?
           AND kind = 'event'
           AND name = ?
           AND source_type = ?
           AND source_id = ?`
      )
      .get(sessionId, name, sourceType, sourceId) as { max_source_seq: number | null } | undefined
    const maxSourceSeq = row?.max_source_seq
    return typeof maxSourceSeq === 'number' &&
      Number.isSafeInteger(maxSourceSeq) &&
      maxSourceSeq > 0
      ? maxSourceSeq
      : 0
  }

  getSubagentLineageEvents(sessionId: string): DeepChatTapeEntryRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ?
           AND kind = 'event'
           AND name IN ('subagent/tape_linked', 'fork/merge')
         ORDER BY entry_id ASC`
      )
      .all(sessionId) as DeepChatTapeEntryRow[]
  }

  getFirstEntriesBySessions(sessionIds: string[]): DeepChatTapeEntryRow[] {
    const ids = [...new Set(sessionIds.map((id) => id.trim()).filter(Boolean))]
    if (ids.length === 0) {
      return []
    }
    return this.db
      .prepare(
        `WITH requested_sessions(session_id) AS (
           SELECT value FROM json_each(?)
         ),
         first_entries(session_id, entry_id) AS (
           SELECT tape.session_id, MIN(tape.entry_id)
           FROM deepchat_tape_entries AS tape
           INNER JOIN requested_sessions AS requested
             ON requested.session_id = tape.session_id
           GROUP BY tape.session_id
         )
         SELECT tape.*
         FROM deepchat_tape_entries AS tape
         INNER JOIN first_entries AS first
           ON first.session_id = tape.session_id
           AND first.entry_id = tape.entry_id
         ORDER BY tape.session_id ASC`
      )
      .all(JSON.stringify(ids)) as DeepChatTapeEntryRow[]
  }

  getBySessionUpToEntryIdExcludingContext(
    sessionId: string,
    maxEntryId: number
  ): DeepChatTapeEntryRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ? AND entry_id <= ? AND kind != 'context'
         ORDER BY entry_id ASC`
      )
      .all(sessionId, maxEntryId) as DeepChatTapeEntryRow[]
  }

  listMemoryViewManifestAnchorsBySessions(
    sessionIds: string[],
    optionsOrLimit: number | { limit?: number; messageId?: string } = 100
  ): DeepChatTapeEntryRow[] {
    const uniqueSessionIds = [...new Set(sessionIds.filter((id) => id.trim().length > 0))]
    if (uniqueSessionIds.length === 0) {
      return []
    }
    const options = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : optionsOrLimit
    const cappedLimit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 500)
    const placeholders = uniqueSessionIds.map(() => '?').join(', ')
    const whereClauses = [
      `session_id IN (${placeholders})`,
      "kind = 'anchor'",
      "name = 'memory/view_assembled'"
    ]
    const params: Array<string | number> = [...uniqueSessionIds]
    if (options.messageId) {
      whereClauses.push("json_extract(meta_json, '$.messageId') = ?")
      params.push(options.messageId)
    }
    params.push(cappedLimit)
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY created_at DESC, entry_id DESC
         LIMIT ?`
      )
      .all(...params) as DeepChatTapeEntryRow[]
  }

  listMemoryViewManifestAnchorsByAgent(
    agentId: string,
    options: { sessionId?: string; limit?: number; messageId?: string } = {}
  ): DeepChatTapeEntryRow[] {
    const cappedLimit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 500)
    const whereClauses = [
      'sessions.agent_id = ?',
      "tape.kind = 'anchor'",
      "tape.name = 'memory/view_assembled'"
    ]
    const params: Array<string | number> = [agentId]
    if (options.sessionId) {
      whereClauses.push('tape.session_id = ?')
      params.push(options.sessionId)
    }
    if (options.messageId) {
      whereClauses.push("json_extract(tape.meta_json, '$.messageId') = ?")
      params.push(options.messageId)
    }
    params.push(cappedLimit)
    return this.db
      .prepare(
        `SELECT tape.*
         FROM deepchat_tape_entries AS tape
         INNER JOIN new_sessions AS sessions
           ON sessions.id = tape.session_id
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY tape.created_at DESC, tape.entry_id DESC
         LIMIT ?`
      )
      .all(...params) as DeepChatTapeEntryRow[]
  }

  getEntriesAfter(sessionId: string, entryId: number): DeepChatTapeEntryRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ? AND entry_id > ?
         ORDER BY entry_id ASC`
      )
      .all(sessionId, entryId) as DeepChatTapeEntryRow[]
  }

  getLatestAnchor(sessionId: string): DeepChatTapeEntryRow | undefined {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ? AND kind = 'anchor'
         ORDER BY entry_id DESC
         LIMIT 1`
      )
      .get(sessionId) as DeepChatTapeEntryRow | undefined
  }

  getAnchors(sessionId: string, limit: number = 20): DeepChatTapeEntryRow[] {
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 100)
    const rows = this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ? AND kind = 'anchor'
         ORDER BY entry_id DESC
         LIMIT ?`
      )
      .all(sessionId, cappedLimit) as DeepChatTapeEntryRow[]

    return rows.reverse()
  }

  getLatestSummaryAnchor(sessionId: string): DeepChatTapeEntryRow | undefined {
    const placeholders = SUMMARY_ANCHOR_NAMES.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ?
           AND kind = 'anchor'
           AND name IN (${placeholders})
         ORDER BY entry_id DESC
         LIMIT 1`
      )
      .get(sessionId, ...SUMMARY_ANCHOR_NAMES) as DeepChatTapeEntryRow | undefined
  }

  getLatestReconstructionAnchor(sessionId: string): DeepChatTapeEntryRow | undefined {
    const placeholders = RECONSTRUCTION_ANCHOR_NAMES.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ?
           AND kind = 'anchor'
           AND (
             name IN (${placeholders})
             OR name LIKE 'handoff/%'
             OR name LIKE 'auto_handoff/%'
           )
         ORDER BY entry_id DESC
         LIMIT 1`
      )
      .get(sessionId, ...RECONSTRUCTION_ANCHOR_NAMES) as DeepChatTapeEntryRow | undefined
  }

  getByProvenanceKey(sessionId: string, provenanceKey: string): DeepChatTapeEntryRow | undefined {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ? AND provenance_key = ?
         LIMIT 1`
      )
      .get(sessionId, provenanceKey) as DeepChatTapeEntryRow | undefined
  }

  getMaxEntryId(sessionId: string): number {
    const row = this.db
      .prepare(
        `SELECT MAX(entry_id) AS max_entry_id
         FROM deepchat_tape_entries
         WHERE session_id = ?`
      )
      .get(sessionId) as { max_entry_id: number | null } | undefined
    return row?.max_entry_id ?? 0
  }

  getMaxEntryIdExcludingContext(sessionId: string): number {
    const row = this.db
      .prepare(
        `SELECT MAX(entry_id) AS max_entry_id
         FROM deepchat_tape_entries
         WHERE session_id = ? AND kind != 'context'`
      )
      .get(sessionId) as { max_entry_id: number | null } | undefined
    return row?.max_entry_id ?? 0
  }

  getMaxEntryIdsBySessions(sessionIds: string[]): Map<string, number> {
    const ids = [...new Set(sessionIds.map((id) => id.trim()).filter(Boolean))]
    const maxEntryIdBySession = new Map(ids.map((id) => [id, 0]))
    if (ids.length === 0) {
      return maxEntryIdBySession
    }
    const rows = this.db
      .prepare(
        `WITH requested_sessions(session_id) AS (
           SELECT value FROM json_each(?)
         )
         SELECT tape.session_id, MAX(tape.entry_id) AS max_entry_id
         FROM deepchat_tape_entries AS tape
         INNER JOIN requested_sessions AS requested
           ON requested.session_id = tape.session_id
         GROUP BY tape.session_id`
      )
      .all(JSON.stringify(ids)) as Array<{ session_id: string; max_entry_id: number }>
    for (const row of rows) {
      maxEntryIdBySession.set(row.session_id, row.max_entry_id)
    }
    return maxEntryIdBySession
  }

  countAnchorsBySession(sessionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM deepchat_tape_entries
         WHERE session_id = ? AND kind = 'anchor'`
      )
      .get(sessionId) as { count: number } | undefined
    return row?.count ?? 0
  }

  countEntriesAfter(sessionId: string, entryId: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM deepchat_tape_entries
         WHERE session_id = ? AND entry_id > ?`
      )
      .get(sessionId, entryId) as { count: number } | undefined
    return row?.count ?? 0
  }

  countBySession(sessionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM deepchat_tape_entries
         WHERE session_id = ?`
      )
      .get(sessionId) as { count: number } | undefined
    return row?.count ?? 0
  }

  search(
    sessionId: string,
    query: string,
    options: DeepChatTapeSearchInput = {}
  ): DeepChatTapeEntryRow[] {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) {
      return []
    }
    const limit = Number.isFinite(options.limit) ? (options.limit as number) : 20
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 100)
    const queryPredicate = buildDeepChatTapeLikeSearchPredicate(
      ['payload_json', 'meta_json', 'name'],
      normalizedQuery
    )
    const whereClauses = ['session_id = ?', "kind != 'context'", queryPredicate.sql]
    const params: Array<string | number> = [sessionId, ...queryPredicate.params]

    if (options.kinds?.length) {
      whereClauses.push(`kind IN (${options.kinds.map(() => '?').join(', ')})`)
      params.push(...options.kinds)
    }

    if (Number.isFinite(options.startCreatedAt)) {
      whereClauses.push('created_at >= ?')
      params.push(options.startCreatedAt as number)
    }

    if (Number.isFinite(options.endCreatedAt)) {
      whereClauses.push('created_at <= ?')
      params.push(options.endCreatedAt as number)
    }

    params.push(cappedLimit)

    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY entry_id DESC
         LIMIT ?`
      )
      .all(...params) as DeepChatTapeEntryRow[]
  }

  searchEffectiveSourcesAtHeads(
    sources: readonly DeepChatTapeReadSource[],
    query: string,
    options: DeepChatTapeSearchInput = {}
  ): DeepChatTapeEntryRow[] {
    const normalizedSources = normalizeDeepChatTapeReadSources(sources)
    const normalizedQuery = query.trim()
    if (normalizedSources.length === 0 || !normalizedQuery) {
      return []
    }

    const limit = Number.isFinite(options.limit) ? (options.limit as number) : 20
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 100)
    const queryPredicate = buildDeepChatTapeLikeSearchPredicate(
      ['candidate.payload_json', 'candidate.meta_json', 'candidate.name'],
      normalizedQuery
    )
    const whereClauses = ["candidate.kind != 'context'", queryPredicate.sql]
    const params: Array<string | number> = [
      serializeDeepChatTapeReadSources(normalizedSources),
      ...queryPredicate.params
    ]

    if (options.kinds?.length) {
      whereClauses.push(`candidate.kind IN (${options.kinds.map(() => '?').join(', ')})`)
      params.push(...options.kinds)
    }
    if (Number.isFinite(options.startCreatedAt)) {
      whereClauses.push('candidate.created_at >= ?')
      params.push(options.startCreatedAt as number)
    }
    if (Number.isFinite(options.endCreatedAt)) {
      whereClauses.push('candidate.created_at <= ?')
      params.push(options.endCreatedAt as number)
    }
    params.push(cappedLimit)

    return this.db
      .prepare(
        `WITH
         ${AUTHORIZED_TAPE_SOURCES_CTE_SQL}
         SELECT
           candidate.session_id,
           candidate.entry_id,
           candidate.kind,
           candidate.name,
           candidate.source_type,
           candidate.source_id,
           candidate.source_seq,
           candidate.provenance_key,
           ${projectedTapePayloadSql('candidate', 'source')} AS payload_json,
           candidate.meta_json,
           candidate.created_at
         FROM deepchat_tape_entries AS candidate
         INNER JOIN authorized_sources AS source
           ON source.session_id = candidate.session_id
           AND candidate.entry_id <= source.max_entry_id
         WHERE ${whereClauses.join(' AND ')}
           AND (${EFFECTIVE_TAPE_SEARCH_ROW_PREDICATE_SQL})
         ORDER BY candidate.created_at DESC, candidate.session_id ASC, candidate.entry_id DESC
         LIMIT ?`
      )
      .all(...params) as DeepChatTapeEntryRow[]
  }

  getEffectiveContextRowsAtHead(
    source: DeepChatTapeReadSource,
    entryIds: number[],
    options: { before: number; after: number; limit: number }
  ): DeepChatTapeEntryRow[] {
    const normalizedSource = normalizeDeepChatTapeReadSources([source])[0]
    const requestedEntryIds = [
      ...new Set(entryIds.filter((entryId) => Number.isSafeInteger(entryId) && entryId > 0))
    ].sort((left, right) => left - right)
    if (!normalizedSource || requestedEntryIds.length === 0) {
      return []
    }
    const before = Math.min(Math.max(Math.floor(options.before), 0), 20)
    const after = Math.min(Math.max(Math.floor(options.after), 0), 20)
    const limit = Math.min(Math.max(Math.floor(options.limit), 1), 100)

    return this.db
      .prepare(
        `WITH
         ${AUTHORIZED_TAPE_SOURCES_CTE_SQL},
         ${EFFECTIVE_TAPE_ROWS_CTE_SQL},
         ordered_rows AS (
           SELECT
             effective_rows.*,
             ROW_NUMBER() OVER (ORDER BY entry_id ASC) AS row_position
           FROM effective_rows
         ),
         requested_ids(entry_id, request_ordinal) AS (
           SELECT CAST(value AS INTEGER), CAST(key AS INTEGER)
           FROM json_each(?)
         ),
         requested_positions AS (
           SELECT
             requested_ids.request_ordinal,
             ordered_rows.entry_id,
             ordered_rows.row_position
           FROM requested_ids
           INNER JOIN ordered_rows
             ON ordered_rows.entry_id = requested_ids.entry_id
         ),
         context_candidates AS (
           SELECT
             ordered_rows.*,
             0 AS priority_group,
             requested_positions.request_ordinal,
             0 AS neighbor_position
           FROM requested_positions
           INNER JOIN ordered_rows
             ON ordered_rows.entry_id = requested_positions.entry_id
           UNION ALL
           SELECT
             ordered_rows.*,
             1 AS priority_group,
             requested_positions.request_ordinal,
             ordered_rows.row_position AS neighbor_position
           FROM requested_positions
           INNER JOIN ordered_rows
             ON ordered_rows.row_position BETWEEN requested_positions.row_position - ?
               AND requested_positions.row_position + ?
             AND ordered_rows.entry_id != requested_positions.entry_id
         ),
         ranked_context_candidates AS (
           SELECT
             context_candidates.*,
             ROW_NUMBER() OVER (
               PARTITION BY session_id, entry_id
               ORDER BY priority_group, request_ordinal, neighbor_position
             ) AS duplicate_rank
           FROM context_candidates
         )
         SELECT
           session_id, entry_id, kind, name, source_type, source_id, source_seq,
           provenance_key, payload_json, meta_json, created_at
         FROM ranked_context_candidates
         WHERE duplicate_rank = 1
         ORDER BY priority_group, request_ordinal, neighbor_position
         LIMIT ?`
      )
      .all(
        serializeDeepChatTapeReadSources([normalizedSource]),
        JSON.stringify(requestedEntryIds),
        before,
        after,
        limit
      ) as DeepChatTapeEntryRow[]
  }

  private ensureProvenanceColumns(): void {
    const columns: Array<[string, string]> = [
      ['source_type', 'TEXT'],
      ['source_id', 'TEXT'],
      ['source_seq', 'INTEGER'],
      ['provenance_key', 'TEXT']
    ]
    for (const [columnName, columnType] of columns) {
      if (!this.hasColumn(columnName)) {
        this.db.exec(`ALTER TABLE deepchat_tape_entries ADD COLUMN ${columnName} ${columnType}`)
      }
    }
  }
}

export class DeepChatExecutionJournalStore
  extends DeepChatTapeEntriesTable
  implements ExecutionJournalPersistenceStore
{
  listUnterminatedRunEvents(): Iterable<DeepChatTapeEntryRow> {
    return this.db
      .prepare(UNTERMINATED_EXECUTION_JOURNAL_EVENTS_SQL)
      .iterate() as IterableIterator<DeepChatTapeEntryRow>
  }

  appendExecutionJournalEvent(
    input: TapeEventAppendInput & { name: ExecutionJournalEventName }
  ): DeepChatTapeEntryRow {
    if (!EXECUTION_JOURNAL_EVENT_NAMES.includes(input.name)) {
      throw new Error(`Unsupported Execution Journal event name: ${input.name}.`)
    }
    return this.appendInternal(
      {
        sessionId: input.sessionId,
        kind: 'event',
        name: input.name,
        source: input.source,
        provenanceKey: input.provenanceKey,
        payload: {
          name: input.name,
          data: input.data
        },
        meta: input.meta,
        createdAt: input.createdAt,
        idempotent: input.idempotent
      },
      'execution'
    )
  }
}

export class DeepChatContractStore
  extends DeepChatTapeEntriesTable
  implements ContractPersistenceStore
{
  appendContractEvent(
    input: TapeEventAppendInput & { name: ContractTapeEventName }
  ): DeepChatTapeEntryRow {
    if (!CONTRACT_TAPE_EVENT_NAMES.includes(input.name)) {
      throw new Error(`Unsupported Contract event name: ${input.name}.`)
    }
    return this.appendInternal(
      {
        sessionId: input.sessionId,
        kind: 'event',
        name: input.name,
        source: input.source,
        provenanceKey: input.provenanceKey,
        payload: {
          name: input.name,
          data: input.data
        },
        meta: input.meta,
        createdAt: input.createdAt,
        idempotent: input.idempotent
      },
      'contract'
    )
  }
}
