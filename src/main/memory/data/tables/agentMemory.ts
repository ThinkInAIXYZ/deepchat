import Database from 'better-sqlite3-multiple-ciphers'
import logger from '@shared/logger'
import { BaseTable } from '@/data/baseTable'
import {
  AGENT_MEMORY_CATEGORIES,
  AGENT_MEMORY_HEALTH_KIND_KEYS,
  AGENT_MEMORY_HEALTH_STATUS_KEYS,
  AGENT_MEMORY_SCOPE_ID_MAX_CHARS
} from '@shared/types/agent-memory'
import { serializeAgentMemorySourceEntryIds } from '@shared/lib/agentMemoryLineage'
import { MEMORY_PAGE_MAX_LIMIT } from '@shared/contracts/routes/memory.routes'
import type { MemoryPerfObserver, MemoryRepositoryPort } from '../../../memory/ports'
import type {
  AgentMemoryHealthStats,
  AgentMemoryDerivationRow,
  AgentMemoryEmbeddingState,
  AgentMemoryInsertInput,
  AgentMemoryConflictState,
  AgentMemoryKind,
  AgentMemoryLifecycleRow,
  AgentMemoryListOptions,
  AgentMemoryPersonaState,
  AgentMemoryRow,
  AgentMemoryStatus,
  AgentMemoryWorkingCandidateCursor,
  ArchiveChallengerTransition,
  ArchiveConflictTargetTransition,
  InternalContentTransition,
  InternalMemoryInsertInput,
  MemoryTransitionTarget,
  MemoryClaimContentUpdateResult,
  MemoryClearBatchResult,
  MemoryClearJob,
  MemoryDerivationInsertInput,
  MemoryDirtySeed,
  MemoryScope,
  ResolveChallengerTransition,
  ReviveSupersededTransition,
  UserContentTransition,
  UserMetadataTransition
} from '../../../memory/domain/types'
import {
  AGENT_MEMORY_FTS_POLICY_VERSION,
  agentFtsScope,
  buildAgentFtsScopeSql,
  buildRecallablePredicate,
  isRecallableFtsRow
} from './agentMemoryFtsPolicy'
import {
  assertValidMemoryInsertState,
  deriveCanonicalStateFromLegacy,
  projectLegacyStatus,
  assertValidMemoryTransition
} from '../../../memory/domain/stateModel'
import type {
  MemoryEmbeddingRefsState,
  MemoryTransitionSnapshot
} from '../../../memory/domain/stateModel'
import {
  AGENT_MEMORY_LEGACY_STATUS_SQL_LIST,
  buildInternalKindPredicateSql,
  buildLegacyBridgeUpdateEmbeddingStateSql,
  buildLegacyBridgeUpdateLifecycleStateSql,
  buildLegacyEmbeddingStateSql,
  buildLegacyLifecycleStateSql,
  buildLegacyShadowMismatchPredicateSql,
  buildLegacyStatusProjectionSql,
  buildStatusProjectionFromExpressionsSql
} from './agentMemoryStateSql'
import { normalizeMemoryTemporalMetadata, temporalMetadataFromRow } from '../../core/temporal'
import { buildMemoryTombstoneIdentities, isTombstoneEligibleMemoryKind } from '../../core/tombstone'
import { MEMORY_RETRIEVAL_MAX_CANDIDATES } from '../../core/retrievalBudget'
import {
  AGENT_MEMORY_AGENT_SCOPE_FILTER,
  buildMemoryScopePredicateSql,
  legacyUserScopeForMemoryScope,
  memoryScopeFromRow,
  normalizeMemoryScope,
  normalizeMemoryScopeFilter
} from '../../core/scope'
import type { MemoryTombstoneDeleteInput, MemoryTombstoneReason } from '../../domain/types'

// 'working' is an internal session-open injection cache (a single blob row per agent); it is never
// recalled, embedded, reflected on, or archived. A 'crystal' kind (3+ corroborated sources) is a
// reserved future layer with no read/write path yet.

// Global migration version shared across all tables (see MainDatabase.migrate). v32 backfilled
// embedding_model + source_entry_ids; v33 adds the consolidation/forgetting columns; v34 adds the
// persona lifecycle column; v35 adds conflict linkage; v37 adds agentic category; v41 adds
// optimistic concurrency control for semantic decision writes; v42 normalizes lifecycle and
// embedding state while retaining the legacy status shadow; v46 adds temporal claim metadata; v47
// adds privacy-preserving exact-forgetting tombstones; v48 adds durable derivation edges and the
// rebuildable dirty-work index; v49 extends dirty work to reflection claims; v51 introduces typed
// applicability scopes while retaining user_scope as a write-only compatibility shadow; v52 makes
// Agent-wide clear resumable and bounds each synchronous deletion transaction.
const AGENT_MEMORY_STATE_MODEL_SCHEMA_VERSION = 42
const AGENT_MEMORY_TEMPORAL_SCHEMA_VERSION = 46
const AGENT_MEMORY_TOMBSTONE_SCHEMA_VERSION = 47
const AGENT_MEMORY_LINEAGE_SCHEMA_VERSION = 48
const AGENT_MEMORY_REFLECTION_DIRTY_SCHEMA_VERSION = 49
const AGENT_MEMORY_SCOPE_SCHEMA_VERSION = 51
const AGENT_MEMORY_RESUMABLE_CLEAR_SCHEMA_VERSION = 52
const AGENT_MEMORY_SCHEMA_VERSION = AGENT_MEMORY_RESUMABLE_CLEAR_SCHEMA_VERSION

const AGENT_MEMORY_FTS_META_KEY = 'agent_memory_fts'
const AGENT_MEMORY_FTS_META_VERSION = 4
const AGENT_MEMORY_FTS_RECOVERY_COOLDOWN_MS = 30_000
const PREVIOUS_AGENT_MEMORY_FTS_POLICY_VERSION = 2
const AGENT_MEMORY_CLEAR_BATCH_SIZE = 256

type FtsCapability = { available: boolean; tokenizer: 'trigram' | 'unicode61' }
type SearchMatchMode = 'all' | 'any'
type FtsMirrorRow = AgentMemoryRow & { rowid: number }
type TombstoneSourceRow = Pick<
  AgentMemoryRow,
  'agent_id' | 'scope_type' | 'scope_id' | 'kind' | 'content' | 'provenance_key'
>
type TombstoneSourcePageRow = TombstoneSourceRow & { storage_rowid: number }
type MemoryClearJobRow = {
  agent_id: string
  cutoff_rowid: number
  created_at: number
  removed_count: number
  phase: MemoryClearJob['phase']
}
type TombstoneClaimIdentityInput = Pick<
  AgentMemoryInsertInput,
  'agentId' | 'kind' | 'content' | 'provenanceKey'
> & {
  scope: MemoryScope
}

function toMemoryClearJob(row: MemoryClearJobRow): MemoryClearJob {
  return {
    agentId: row.agent_id,
    cutoffRowId: row.cutoff_rowid,
    createdAt: row.created_at,
    removed: row.removed_count,
    phase: row.phase
  }
}

const AGENT_MEMORY_TOMBSTONE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS agent_memory_tombstone (
    agent_id TEXT NOT NULL,
    identity_kind TEXT NOT NULL
      CHECK (identity_kind IN ('provenance', 'content')),
    identity_hash TEXT NOT NULL
      CHECK (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
    created_at INTEGER NOT NULL,
    reason TEXT NOT NULL
      CHECK (reason IN ('selective_delete', 'agent_clear')),
    PRIMARY KEY (agent_id, identity_kind, identity_hash)
  ) WITHOUT ROWID;
`

const AGENT_MEMORY_CLEAR_JOB_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS agent_memory_clear_job (
    agent_id TEXT PRIMARY KEY,
    cutoff_rowid INTEGER NOT NULL CHECK (cutoff_rowid >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    removed_count INTEGER NOT NULL DEFAULT 0 CHECK (removed_count >= 0),
    phase TEXT NOT NULL DEFAULT 'claims' CHECK (phase IN ('claims', 'vectors'))
  ) WITHOUT ROWID;
`

const AGENT_MEMORY_CLEAR_GUARD_INSERT_TRIGGER_NAME = 'agent_memory_clear_guard_bi_v1'
const AGENT_MEMORY_CLEAR_GUARD_UPDATE_TRIGGER_NAME = 'agent_memory_clear_guard_bu_v1'
const AGENT_MEMORY_CLEAR_GUARD_TRIGGER_DROP_SQL = `
  DROP TRIGGER IF EXISTS ${AGENT_MEMORY_CLEAR_GUARD_INSERT_TRIGGER_NAME};
  DROP TRIGGER IF EXISTS ${AGENT_MEMORY_CLEAR_GUARD_UPDATE_TRIGGER_NAME};
`
const AGENT_MEMORY_CLEAR_GUARD_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS ${AGENT_MEMORY_CLEAR_GUARD_INSERT_TRIGGER_NAME}
  BEFORE INSERT ON agent_memory
  WHEN EXISTS (
    SELECT 1 FROM agent_memory_clear_job WHERE agent_id = NEW.agent_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'agent memory clear in progress');
  END;

  CREATE TRIGGER IF NOT EXISTS ${AGENT_MEMORY_CLEAR_GUARD_UPDATE_TRIGGER_NAME}
  BEFORE UPDATE ON agent_memory
  WHEN EXISTS (
    SELECT 1
    FROM agent_memory_clear_job
    WHERE agent_id IN (OLD.agent_id, NEW.agent_id)
  )
  BEGIN
    SELECT RAISE(ABORT, 'agent memory clear in progress');
  END;
`

const AGENT_MEMORY_CLEAR_ARTIFACT_SQL = `
  ${AGENT_MEMORY_CLEAR_JOB_TABLE_SQL}
  ${AGENT_MEMORY_CLEAR_GUARD_TRIGGER_SQL}
`

// Read and maintenance work can finish after a durable clear job has fenced its Agent. Keep
// bookkeeping updates atomic with that fence so stale completions become no-ops; the triggers
// remain the final defense for domain writes that bypass their runtime gate.
const AGENT_MEMORY_CLEAR_BOOKKEEPING_FENCE_SQL = `
  NOT EXISTS (
    SELECT 1
    FROM agent_memory_clear_job AS clear_job
    WHERE clear_job.agent_id = memory.agent_id
  )
`

const AGENT_MEMORY_DERIVATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS agent_memory_derivation (
    agent_id TEXT NOT NULL,
    parent_memory_id TEXT NOT NULL,
    child_memory_id TEXT NOT NULL,
    derivation_kind TEXT NOT NULL
      CHECK (derivation_kind IN ('merge', 'reflection', 'supersede', 'manual_edit')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (agent_id, parent_memory_id, child_memory_id, derivation_kind)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS idx_agent_memory_derivation_child_v1
    ON agent_memory_derivation(agent_id, child_memory_id, created_at, parent_memory_id);
`

const AGENT_MEMORY_DIRTY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS agent_memory_dirty (
    agent_id TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    claim_revision INTEGER NOT NULL CHECK (claim_revision >= 1),
    enqueued_at INTEGER NOT NULL CHECK (enqueued_at >= 0),
    PRIMARY KEY (agent_id, memory_id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS idx_agent_memory_dirty_order_v1
    ON agent_memory_dirty(agent_id, enqueued_at, memory_id);
`

const AGENT_MEMORY_DIRTY_BACKFILL_SQL = `
  INSERT INTO agent_memory_dirty (
    agent_id, memory_id, generation, claim_revision, enqueued_at
  )
  SELECT agent_id, id, 1, max(1, decision_revision),
         max(0, COALESCE(last_accessed, created_at))
  FROM agent_memory
  WHERE kind IN ('episodic', 'semantic', 'reflection')
  ON CONFLICT (agent_id, memory_id) DO NOTHING;
`

const AGENT_MEMORY_DIRTY_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS agent_memory_dirty_ai
  AFTER INSERT ON agent_memory
  WHEN NEW.kind IN ('episodic', 'semantic', 'reflection')
  BEGIN
    INSERT INTO agent_memory_dirty (
      agent_id, memory_id, generation, claim_revision, enqueued_at
    )
    VALUES (
      NEW.agent_id, NEW.id, 1, max(1, NEW.decision_revision),
      max(0, COALESCE(NEW.last_accessed, NEW.created_at))
    )
    ON CONFLICT (agent_id, memory_id) DO UPDATE SET
      generation = agent_memory_dirty.generation + 1,
      claim_revision = excluded.claim_revision,
      enqueued_at = max(agent_memory_dirty.enqueued_at, excluded.enqueued_at);
  END;

  CREATE TRIGGER IF NOT EXISTS agent_memory_dirty_au
  AFTER UPDATE OF decision_revision, embedding_state, embedding_dim, embedding_model
  ON agent_memory
  WHEN NEW.kind IN ('episodic', 'semantic', 'reflection')
  BEGIN
    INSERT INTO agent_memory_dirty (
      agent_id, memory_id, generation, claim_revision, enqueued_at
    )
    VALUES (
      NEW.agent_id, NEW.id, 1, max(1, NEW.decision_revision),
      max(0, COALESCE(NEW.last_accessed, NEW.created_at))
    )
    ON CONFLICT (agent_id, memory_id) DO UPDATE SET
      generation = agent_memory_dirty.generation + 1,
      claim_revision = excluded.claim_revision,
      enqueued_at = max(agent_memory_dirty.enqueued_at, excluded.enqueued_at);
  END;

  CREATE TRIGGER IF NOT EXISTS agent_memory_dirty_ad
  AFTER DELETE ON agent_memory
  WHEN OLD.kind IN ('episodic', 'semantic', 'reflection')
  BEGIN
    INSERT INTO agent_memory_dirty (
      agent_id, memory_id, generation, claim_revision, enqueued_at
    )
    VALUES (
      OLD.agent_id, OLD.id, 1, max(1, OLD.decision_revision),
      max(0, COALESCE(OLD.last_accessed, OLD.created_at))
    )
    ON CONFLICT (agent_id, memory_id) DO UPDATE SET
      generation = agent_memory_dirty.generation + 1,
      claim_revision = excluded.claim_revision,
      enqueued_at = max(agent_memory_dirty.enqueued_at, excluded.enqueued_at);
  END;
`

const AGENT_MEMORY_DIRTY_TRIGGER_DROP_SQL = `
  DROP TRIGGER IF EXISTS agent_memory_dirty_ai;
  DROP TRIGGER IF EXISTS agent_memory_dirty_au;
  DROP TRIGGER IF EXISTS agent_memory_dirty_ad;
`

const DIRTY_SEED_REPOSITORY_LIMIT = 256

const AGENT_MEMORY_TEMPORAL_TRIGGER_INSERT_NAME = 'agent_memory_temporal_bi_v1'
const AGENT_MEMORY_TEMPORAL_TRIGGER_UPDATE_NAME = 'agent_memory_temporal_bu_v1'
const AGENT_MEMORY_TEMPORAL_TRIGGER_DROP_SQL = `
  DROP TRIGGER IF EXISTS ${AGENT_MEMORY_TEMPORAL_TRIGGER_INSERT_NAME};
  DROP TRIGGER IF EXISTS ${AGENT_MEMORY_TEMPORAL_TRIGGER_UPDATE_NAME};
`
const AGENT_MEMORY_TEMPORAL_INVALID_ROW_SQL = `
  (valid_from IS NOT NULL AND valid_until IS NOT NULL AND valid_from >= valid_until)
  OR temporal_kind IS NULL
  OR temporal_kind NOT IN ('atemporal', 'state', 'event', 'plan', 'recurring')
  OR (
    temporal_confidence IS NOT NULL
    AND (temporal_confidence < 0 OR temporal_confidence > 1)
  )
  OR (
    temporal_precision IS NOT NULL
    AND temporal_precision NOT IN ('exact', 'day', 'week', 'month', 'quarter', 'year', 'unknown')
  )
  OR (
    temporal_timezone IS NOT NULL
    AND (
      length(temporal_timezone) NOT BETWEEN 1 AND 128
      OR temporal_timezone != trim(temporal_timezone)
    )
  )
  OR (
    temporal_kind = 'atemporal'
    AND (
      valid_from IS NOT NULL
      OR valid_until IS NOT NULL
      OR temporal_confidence IS NOT NULL
      OR temporal_precision IS NOT NULL
      OR temporal_timezone IS NOT NULL
    )
  )
  OR (
    temporal_kind != 'atemporal'
    AND (
      temporal_confidence IS NULL
      OR temporal_precision IS NULL
      OR temporal_timezone IS NULL
    )
  )
`
const AGENT_MEMORY_TEMPORAL_INVALID_NEW_SQL = AGENT_MEMORY_TEMPORAL_INVALID_ROW_SQL.replaceAll(
  /\b(temporal_kind|valid_from|valid_until|temporal_confidence|temporal_precision|temporal_timezone)\b/gu,
  'NEW.$1'
)
const AGENT_MEMORY_TEMPORAL_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS ${AGENT_MEMORY_TEMPORAL_TRIGGER_INSERT_NAME}
  BEFORE INSERT ON agent_memory
  WHEN ${AGENT_MEMORY_TEMPORAL_INVALID_NEW_SQL}
  BEGIN
    SELECT RAISE(ABORT, 'invalid agent_memory temporal metadata');
  END;

  CREATE TRIGGER IF NOT EXISTS ${AGENT_MEMORY_TEMPORAL_TRIGGER_UPDATE_NAME}
  BEFORE UPDATE OF temporal_kind, valid_from, valid_until, temporal_confidence,
                   temporal_precision, temporal_timezone
  ON agent_memory
  WHEN ${AGENT_MEMORY_TEMPORAL_INVALID_NEW_SQL}
  BEGIN
    SELECT RAISE(ABORT, 'invalid agent_memory temporal metadata');
  END;
`

const AGENT_MEMORY_SCOPE_TRIGGER_INSERT_NAME = 'agent_memory_scope_bi_v1'
const AGENT_MEMORY_SCOPE_TRIGGER_UPDATE_NAME = 'agent_memory_scope_bu_v1'
const AGENT_MEMORY_SCOPE_TRIGGER_DROP_SQL = `
  DROP TRIGGER IF EXISTS ${AGENT_MEMORY_SCOPE_TRIGGER_INSERT_NAME};
  DROP TRIGGER IF EXISTS ${AGENT_MEMORY_SCOPE_TRIGGER_UPDATE_NAME};
`
const AGENT_MEMORY_SCOPE_INVALID_SQL = `
  NEW.scope_type NOT IN ('agent', 'user', 'project', 'session')
  OR (
    NEW.scope_type = 'agent'
    AND NEW.scope_id IS NOT NULL
  )
  OR (
    NEW.scope_type != 'agent'
    AND (
      NEW.scope_id IS NULL
      OR length(NEW.scope_id) NOT BETWEEN 1 AND ${AGENT_MEMORY_SCOPE_ID_MAX_CHARS}
      OR NEW.scope_id != trim(NEW.scope_id)
    )
  )
  OR (
    NEW.scope_type = 'user'
    AND NEW.user_scope IS NOT NEW.scope_id
  )
  OR (
    NEW.scope_type IN ('project', 'session')
    AND NEW.user_scope IS NOT NULL
  )
`
const AGENT_MEMORY_SCOPE_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS ${AGENT_MEMORY_SCOPE_TRIGGER_INSERT_NAME}
  BEFORE INSERT ON agent_memory
  WHEN ${AGENT_MEMORY_SCOPE_INVALID_SQL}
  BEGIN
    SELECT RAISE(ABORT, 'invalid agent_memory scope');
  END;

  CREATE TRIGGER IF NOT EXISTS ${AGENT_MEMORY_SCOPE_TRIGGER_UPDATE_NAME}
  BEFORE UPDATE OF user_scope, scope_type, scope_id ON agent_memory
  WHEN ${AGENT_MEMORY_SCOPE_INVALID_SQL}
  BEGIN
    SELECT RAISE(ABORT, 'invalid agent_memory scope');
  END;
`

const AGENT_MEMORY_SCOPE_INDEX_SQL = `
  DROP INDEX IF EXISTS idx_agent_memory_recall_importance_v5;
  CREATE INDEX IF NOT EXISTS idx_agent_memory_recall_scope_v6
    ON agent_memory(agent_id, scope_type, scope_id, importance DESC, created_at DESC, id ASC)
    WHERE lifecycle_state = 'active'
      AND superseded_by IS NULL
      AND kind NOT IN ('persona', 'working');
`

function embeddingRefsState(
  row: Pick<AgentMemoryRow, 'embedding_id' | 'embedding_dim' | 'embedding_model'>
): MemoryEmbeddingRefsState {
  const refs = [row.embedding_id, row.embedding_dim, row.embedding_model]
  const present = refs.filter((value) => value !== null).length
  return present === 0 ? 'none' : present === refs.length ? 'complete' : 'partial'
}

function transitionSnapshot(
  row: AgentMemoryRow,
  overrides: Partial<MemoryTransitionSnapshot> = {}
): MemoryTransitionSnapshot {
  return {
    lifecycleState: row.lifecycle_state,
    embeddingState: row.embedding_state,
    kind: row.kind,
    embeddingRefsState: embeddingRefsState(row),
    supersededBy: row.superseded_by,
    conflictState: row.conflict_state === 'challenged' ? 'challenged' : null,
    conflictWith: row.conflict_with,
    ...overrides
  }
}

export interface AgentMemorySearchResult {
  rows: AgentMemoryRow[]
  strategy: 'fts-only' | 'like-fallback'
}

function buildRevisionAwareEmbeddingValues<T extends { id: string; expectedRevision: number }>(
  updates: readonly T[],
  additionalValues: (update: T) => readonly unknown[] = () => []
): { valuesSql: string; params: unknown[] } {
  const unique = [...new Map(updates.map((update) => [update.id, update])).values()]
  const columnCount = 2 + (unique[0] ? additionalValues(unique[0]).length : 0)
  return {
    valuesSql: unique
      .map(() => `(${Array.from({ length: columnCount }, () => '?').join(', ')})`)
      .join(', '),
    params: unique.flatMap((update) => [
      update.id,
      update.expectedRevision,
      ...additionalValues(update)
    ])
  }
}

export function buildPendingEmbeddingSelectSql(agentScoped: boolean): string {
  const indexName = agentScoped
    ? 'idx_agent_memory_embedding_pending_agent_v2'
    : 'idx_agent_memory_embedding_pending_global_v2'
  const agentPredicate = agentScoped ? 'AND agent_id = ?' : ''
  return `SELECT * FROM agent_memory INDEXED BY ${indexName}
          WHERE lifecycle_state = 'active'
            AND embedding_state = 'pending'
            AND superseded_by IS NULL
            AND kind NOT IN ('persona', 'working')
            ${agentPredicate}
          ORDER BY created_at ASC, id ASC
          LIMIT ?`
}

export function buildManagementPageSelectSql(hasCursor: boolean): string {
  const cursorPredicate = hasCursor ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''
  return `SELECT *
          FROM agent_memory INDEXED BY idx_agent_memory_management_page_v3
          WHERE agent_id = ?
            AND superseded_by IS NULL
            AND lifecycle_state != 'conflicted'
            AND kind NOT IN ('persona', 'working')
            ${cursorPredicate}
          ORDER BY created_at DESC, id DESC
          LIMIT ?`
}

export function buildScopedImportanceCandidatesSql(
  agentId: string,
  scopeFilter: readonly MemoryScope[],
  limit: number
): { sql: string; params: Array<string | number> } {
  const scopes = normalizeMemoryScopeFilter(scopeFilter, [])
  const cappedLimit = Number.isFinite(limit) ? Math.min(800, Math.max(1, Math.floor(limit))) : 1
  if (!scopes.length) {
    return {
      sql: `SELECT am.rowid AS memory_rowid,
                   am.id,
                   am.importance,
                   am.created_at
            FROM agent_memory am
            WHERE 0`,
      params: []
    }
  }

  const params: Array<string | number> = []
  const branches = scopes.map((scope) => {
    const scopePredicate = buildMemoryScopePredicateSql('am', [scope])
    params.push(agentId, ...scopePredicate.params, cappedLimit)
    return `SELECT *
            FROM (
              SELECT am.rowid AS memory_rowid,
                     am.id,
                     am.importance,
                     am.created_at
              FROM agent_memory am INDEXED BY idx_agent_memory_recall_scope_v6
              WHERE am.agent_id = ?
                AND ${buildRecallablePredicate('am')}
                AND ${scopePredicate.sql}
              ORDER BY am.importance DESC, am.created_at DESC, am.id ASC
              LIMIT ?
            )`
  })
  params.push(cappedLimit)
  return {
    sql: `SELECT memory_rowid, id, importance, created_at
          FROM (
            ${branches.join('\nUNION ALL\n')}
          )
          ORDER BY importance DESC, created_at DESC, id ASC
          LIMIT ?`,
    params
  }
}

function isTransientFtsError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' || code === 'SQLITE_INTERRUPT'
}

const AGENT_MEMORY_BASE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_kind
    ON agent_memory(agent_id, kind, status);
  CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_active
    ON agent_memory(agent_id, superseded_by);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_provenance
    ON agent_memory(agent_id, provenance_key)
    WHERE provenance_key IS NOT NULL;
`

const AGENT_MEMORY_RETIRED_INDEX_SQL = `
  DROP INDEX IF EXISTS idx_agent_memory_pending_embedding_v1;
  DROP INDEX IF EXISTS idx_agent_memory_management_page;
  DROP INDEX IF EXISTS idx_agent_memory_management_page_v2;
  DROP INDEX IF EXISTS idx_agent_memory_cognitive_top;
  DROP INDEX IF EXISTS idx_agent_memory_cognitive_top_v2;
  DROP INDEX IF EXISTS idx_agent_memory_recall_importance_v4;
  DROP INDEX IF EXISTS idx_agent_memory_recent_activity;
  DROP INDEX IF EXISTS idx_agent_memory_recent_activity_v2;
  DROP INDEX IF EXISTS idx_agent_memory_archive_eligible;
  DROP INDEX IF EXISTS idx_agent_memory_archive_eligible_v2;
  DROP INDEX IF EXISTS idx_agent_memory_conflict_fairness;
  DROP INDEX IF EXISTS idx_agent_memory_conflict_fairness_v2;
  DROP INDEX IF EXISTS idx_agent_memory_conflict_target;
  DROP INDEX IF EXISTS idx_agent_memory_conflict_link_anomaly_v2;
  DROP INDEX IF EXISTS idx_agent_memory_recall_importance_v5;
`

const AGENT_MEMORY_CONFLICT_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_agent_memory_conflict_state_anomaly_v2
    ON agent_memory(agent_id, conflict_state, id)
    WHERE conflict_state IS NOT NULL;
`

const AGENT_MEMORY_CANONICAL_INDEX_SQL = `
  DROP INDEX IF EXISTS idx_agent_memory_embedding_queue;
  DROP INDEX IF EXISTS idx_agent_memory_lifecycle_maintenance;
  CREATE INDEX IF NOT EXISTS idx_agent_memory_active_recall
    ON agent_memory(agent_id, lifecycle_state, superseded_by, kind, created_at);
  CREATE INDEX IF NOT EXISTS idx_agent_memory_management_page_v3
    ON agent_memory(agent_id, created_at DESC, id DESC)
    WHERE lifecycle_state != 'conflicted'
      AND superseded_by IS NULL
      AND kind NOT IN ('persona', 'working');
  CREATE INDEX IF NOT EXISTS idx_agent_memory_archive_eligible_v3
    ON agent_memory(agent_id, COALESCE(last_accessed, created_at), created_at, id)
    WHERE lifecycle_state = 'active'
      AND superseded_by IS NULL
      AND conflict_state IS NULL
      AND is_anchor = 0
      AND kind NOT IN ('persona', 'working');
  CREATE INDEX IF NOT EXISTS idx_agent_memory_cognitive_top_v3
    ON agent_memory(agent_id, importance DESC, created_at DESC, id DESC)
    WHERE lifecycle_state = 'active'
      AND superseded_by IS NULL
      AND kind IN ('episodic', 'semantic', 'reflection');
  CREATE INDEX IF NOT EXISTS idx_agent_memory_conflict_fairness_v3
    ON agent_memory(agent_id, COALESCE(last_consolidated_at, 0), created_at, id)
    WHERE lifecycle_state = 'conflicted' AND superseded_by IS NULL;
  CREATE INDEX IF NOT EXISTS idx_agent_memory_recent_activity_v3
    ON agent_memory(agent_id, COALESCE(last_accessed, created_at) DESC)
    WHERE lifecycle_state != 'archived';
  CREATE INDEX IF NOT EXISTS idx_agent_memory_embedding_pending_agent_v2
    ON agent_memory(agent_id, created_at, id)
    WHERE lifecycle_state = 'active'
      AND embedding_state = 'pending'
      AND superseded_by IS NULL
      AND kind NOT IN ('persona', 'working');
  CREATE INDEX IF NOT EXISTS idx_agent_memory_embedding_pending_global_v2
    ON agent_memory(created_at, id, agent_id)
    WHERE lifecycle_state = 'active'
      AND embedding_state = 'pending'
      AND superseded_by IS NULL
      AND kind NOT IN ('persona', 'working');
  CREATE INDEX IF NOT EXISTS idx_agent_memory_conflict_target_v2
    ON agent_memory(agent_id, lifecycle_state, conflict_with, id);
`

const AGENT_MEMORY_V42_MARKER_SETUP_SQL = `
  CREATE TEMP TABLE IF NOT EXISTS agent_memory_v42_added_columns (
    name TEXT PRIMARY KEY
  ) WITHOUT ROWID;
  DELETE FROM agent_memory_v42_added_columns;
  INSERT INTO agent_memory_v42_added_columns (name)
  SELECT 'lifecycle_state'
  WHERE NOT EXISTS (
    SELECT 1 FROM pragma_table_info('agent_memory') WHERE name = 'lifecycle_state'
  );
  INSERT INTO agent_memory_v42_added_columns (name)
  SELECT 'embedding_state'
  WHERE NOT EXISTS (
    SELECT 1 FROM pragma_table_info('agent_memory') WHERE name = 'embedding_state'
  );
  CREATE TEMP TABLE IF NOT EXISTS agent_memory_v42_migration_stats (
    normalized_legacy_status_count INTEGER NOT NULL
  );
  DELETE FROM agent_memory_v42_migration_stats;
  INSERT INTO agent_memory_v42_migration_stats (normalized_legacy_status_count)
  SELECT COUNT(*) FROM agent_memory
  WHERE status NOT IN (${AGENT_MEMORY_LEGACY_STATUS_SQL_LIST});
`

const AGENT_MEMORY_LIFECYCLE_BACKFILL_SQL = `
  UPDATE agent_memory
  SET lifecycle_state = ${buildLegacyLifecycleStateSql()};
`

const AGENT_MEMORY_EMBEDDING_BACKFILL_SQL = `
  UPDATE agent_memory
  SET embedding_state = ${buildLegacyEmbeddingStateSql()};
`

const AGENT_MEMORY_V42_COMBINED_BACKFILL_SQL = `
  UPDATE agent_memory
  SET lifecycle_state = ${buildLegacyLifecycleStateSql()},
      embedding_state = ${buildLegacyEmbeddingStateSql()}
  WHERE EXISTS (
    SELECT 1 FROM agent_memory_v42_added_columns WHERE name = 'lifecycle_state'
  ) AND EXISTS (
    SELECT 1 FROM agent_memory_v42_added_columns WHERE name = 'embedding_state'
  );
`

const AGENT_MEMORY_V42_TARGETED_LIFECYCLE_BACKFILL_SQL = `
  UPDATE agent_memory
  SET lifecycle_state = ${buildLegacyLifecycleStateSql()}
  WHERE EXISTS (
    SELECT 1 FROM agent_memory_v42_added_columns WHERE name = 'lifecycle_state'
  ) AND NOT EXISTS (
    SELECT 1 FROM agent_memory_v42_added_columns WHERE name = 'embedding_state'
  );
`

const AGENT_MEMORY_V42_TARGETED_EMBEDDING_BACKFILL_SQL = `
  UPDATE agent_memory
  SET embedding_state = ${buildLegacyEmbeddingStateSql()}
  WHERE EXISTS (
    SELECT 1 FROM agent_memory_v42_added_columns WHERE name = 'embedding_state'
  ) AND NOT EXISTS (
    SELECT 1 FROM agent_memory_v42_added_columns WHERE name = 'lifecycle_state'
  );
`

const AGENT_MEMORY_SHADOW_RECONCILE_SQL = `
  UPDATE agent_memory
  SET status = ${buildLegacyStatusProjectionSql()}
  WHERE ${buildLegacyShadowMismatchPredicateSql()};
`

const AGENT_MEMORY_LEGACY_STATUS_BRIDGE_INSERT_NAME = 'agent_memory_legacy_status_bridge_ai'
const AGENT_MEMORY_LEGACY_STATUS_BRIDGE_UPDATE_NAME = 'agent_memory_legacy_status_bridge_au'
const AGENT_MEMORY_LEGACY_INSERT_LIFECYCLE_SQL = buildLegacyLifecycleStateSql('NEW')
const AGENT_MEMORY_LEGACY_INSERT_EMBEDDING_SQL = buildLegacyEmbeddingStateSql('NEW')
const AGENT_MEMORY_LEGACY_INSERT_STATUS_SQL = buildStatusProjectionFromExpressionsSql(
  AGENT_MEMORY_LEGACY_INSERT_LIFECYCLE_SQL,
  AGENT_MEMORY_LEGACY_INSERT_EMBEDDING_SQL
)
const AGENT_MEMORY_LEGACY_UPDATE_LIFECYCLE_SQL = buildLegacyBridgeUpdateLifecycleStateSql()
const AGENT_MEMORY_LEGACY_UPDATE_EMBEDDING_SQL = buildLegacyBridgeUpdateEmbeddingStateSql()
const AGENT_MEMORY_LEGACY_UPDATE_STATUS_SQL = buildStatusProjectionFromExpressionsSql(
  AGENT_MEMORY_LEGACY_UPDATE_LIFECYCLE_SQL,
  AGENT_MEMORY_LEGACY_UPDATE_EMBEDDING_SQL
)

const AGENT_MEMORY_LEGACY_STATUS_BRIDGE_INSERT_SQL = `
  CREATE TRIGGER IF NOT EXISTS ${AGENT_MEMORY_LEGACY_STATUS_BRIDGE_INSERT_NAME}
  AFTER INSERT ON agent_memory
  WHEN ${buildLegacyShadowMismatchPredicateSql('NEW')}
  BEGIN
    SELECT CASE
      WHEN NEW.status NOT IN (${AGENT_MEMORY_LEGACY_STATUS_SQL_LIST})
        THEN RAISE(ABORT, 'invalid legacy agent_memory status')
    END;
    UPDATE agent_memory
    SET status = ${AGENT_MEMORY_LEGACY_INSERT_STATUS_SQL},
        lifecycle_state = ${AGENT_MEMORY_LEGACY_INSERT_LIFECYCLE_SQL},
        embedding_state = ${AGENT_MEMORY_LEGACY_INSERT_EMBEDDING_SQL}
    WHERE rowid = NEW.rowid;
  END;
`

const AGENT_MEMORY_LEGACY_STATUS_BRIDGE_UPDATE_SQL = `
  CREATE TRIGGER IF NOT EXISTS ${AGENT_MEMORY_LEGACY_STATUS_BRIDGE_UPDATE_NAME}
  AFTER UPDATE OF status ON agent_memory
  WHEN NEW.status != OLD.status
    AND NEW.lifecycle_state = OLD.lifecycle_state
    AND NEW.embedding_state = OLD.embedding_state
    AND ${buildLegacyShadowMismatchPredicateSql('NEW')}
  BEGIN
    SELECT CASE
      WHEN NEW.status NOT IN (${AGENT_MEMORY_LEGACY_STATUS_SQL_LIST})
        THEN RAISE(ABORT, 'invalid legacy agent_memory status')
    END;
    UPDATE agent_memory
    SET status = ${AGENT_MEMORY_LEGACY_UPDATE_STATUS_SQL},
        lifecycle_state = ${AGENT_MEMORY_LEGACY_UPDATE_LIFECYCLE_SQL},
        embedding_state = ${AGENT_MEMORY_LEGACY_UPDATE_EMBEDDING_SQL}
    WHERE rowid = NEW.rowid;
  END;
`

const AGENT_MEMORY_LEGACY_STATUS_BRIDGE_SQL = `
  ${AGENT_MEMORY_LEGACY_STATUS_BRIDGE_INSERT_SQL}
  ${AGENT_MEMORY_LEGACY_STATUS_BRIDGE_UPDATE_SQL}
`

const AGENT_MEMORY_LEGACY_STATUS_BRIDGE_DEFINITIONS = new Map([
  [AGENT_MEMORY_LEGACY_STATUS_BRIDGE_INSERT_NAME, AGENT_MEMORY_LEGACY_STATUS_BRIDGE_INSERT_SQL],
  [AGENT_MEMORY_LEGACY_STATUS_BRIDGE_UPDATE_NAME, AGENT_MEMORY_LEGACY_STATUS_BRIDGE_UPDATE_SQL]
])

function tokenizeSearchQuery(query: string): string[] {
  return query
    .trim()
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter(Boolean)
}

function unicodeCodePointLength(value: string): number {
  return Array.from(value).length
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function readAggregateNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readAggregateNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function normalizeSchemaDefinition(sql: string | null | undefined): string {
  return (sql ?? '')
    .replace(/\bIF\s+NOT\s+EXISTS\b/giu, '')
    .replace(/\s+/gu, ' ')
    .replace(/;\s*$/u, '')
    .trim()
    .toLowerCase()
}

function aggregateAlias(prefix: string, key: string): string {
  return `${prefix}_${key}`
}

function buildCanonicalStatusFilter(statuses: readonly AgentMemoryStatus[]): string {
  const conditions = statuses.map((status) => {
    switch (status) {
      case 'archived':
        return "lifecycle_state = 'archived'"
      case 'conflicted':
        return "lifecycle_state = 'conflicted'"
      case 'embedded':
        return "lifecycle_state = 'active' AND embedding_state = 'ready'"
      case 'error':
        return "lifecycle_state = 'active' AND embedding_state = 'error'"
      case 'fts_only':
        return "lifecycle_state = 'active' AND embedding_state IN ('fts_only', 'not_applicable')"
      case 'pending_embedding':
        return "lifecycle_state = 'active' AND embedding_state = 'pending'"
    }
  })
  return `(${conditions.map((condition) => `(${condition})`).join(' OR ')})`
}

function buildCountCaseAggregates(column: string, prefix: string, keys: readonly string[]): string {
  return keys
    .map(
      (key) =>
        `SUM(CASE WHEN ${column} = ${sqlLiteral(key)} THEN 1 ELSE 0 END) AS ${aggregateAlias(
          prefix,
          key
        )}`
    )
    .join(',\n           ')
}

function readAggregateRecord<const Keys extends readonly string[]>(
  row: Record<string, unknown> | undefined,
  prefix: string,
  keys: Keys
): Record<Keys[number], number> {
  return Object.fromEntries(
    keys.map((key) => [key, readAggregateNumber(row?.[aggregateAlias(prefix, key)])])
  ) as Record<Keys[number], number>
}

export class AgentMemoryTable extends BaseTable implements MemoryRepositoryPort {
  constructor(
    db: Database.Database,
    private readonly perfObserver?: MemoryPerfObserver
  ) {
    super(db, 'agent_memory')
  }

  private ftsCapability: FtsCapability | undefined
  private ftsReady = false
  private ftsRecoveryAfter = 0
  private temporalArtifactsEnsured = false

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS agent_memory (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        user_scope TEXT,
        scope_type TEXT NOT NULL DEFAULT 'agent'
          CHECK (scope_type IN ('agent', 'user', 'project', 'session')),
        scope_id TEXT
          CHECK (scope_id IS NULL OR
                 (length(scope_id) BETWEEN 1 AND ${AGENT_MEMORY_SCOPE_ID_MAX_CHARS}
                  AND scope_id = trim(scope_id))),
        kind TEXT NOT NULL,
        category TEXT,
        content TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        status TEXT NOT NULL DEFAULT 'pending_embedding',
        embedding_id TEXT,
        embedding_dim INTEGER,
        embedding_model TEXT,
        source_session TEXT,
        provenance_key TEXT,
        is_anchor INTEGER NOT NULL DEFAULT 0,
        superseded_by TEXT,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER,
        access_count INTEGER NOT NULL DEFAULT 0,
        decay_score REAL,
        source_entry_ids TEXT,
        confidence REAL,
        temporal_kind TEXT NOT NULL DEFAULT 'atemporal'
          CHECK (temporal_kind IN ('atemporal', 'state', 'event', 'plan', 'recurring')),
        valid_from INTEGER,
        valid_until INTEGER,
        temporal_confidence REAL
          CHECK (temporal_confidence IS NULL OR
                 (temporal_confidence >= 0 AND temporal_confidence <= 1)),
        temporal_precision TEXT
          CHECK (temporal_precision IS NULL OR
                 temporal_precision IN ('exact', 'day', 'week', 'month', 'quarter', 'year', 'unknown')),
        temporal_timezone TEXT
          CHECK (temporal_timezone IS NULL OR
                 (length(temporal_timezone) BETWEEN 1 AND 128
                  AND temporal_timezone = trim(temporal_timezone))),
        last_consolidated_at INTEGER,
        conflict_state TEXT,
        conflict_with TEXT,
        persona_state TEXT,
        decision_revision INTEGER NOT NULL DEFAULT 1,
        lifecycle_state TEXT NOT NULL DEFAULT 'active'
          CHECK (lifecycle_state IN ('active', 'archived', 'conflicted')),
        embedding_state TEXT NOT NULL DEFAULT 'pending'
          CHECK (embedding_state IN ('pending', 'ready', 'error', 'fts_only', 'not_applicable')),
        CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
        CHECK (
          (temporal_kind = 'atemporal' AND valid_from IS NULL AND valid_until IS NULL
            AND temporal_confidence IS NULL AND temporal_precision IS NULL
            AND temporal_timezone IS NULL)
          OR
          (temporal_kind != 'atemporal' AND temporal_confidence IS NOT NULL
            AND temporal_precision IS NOT NULL AND temporal_timezone IS NOT NULL)
        ),
        CHECK (
          (scope_type = 'agent' AND scope_id IS NULL)
          OR (scope_type != 'agent' AND scope_id IS NOT NULL)
        ),
        CHECK (
          scope_type = 'agent'
          OR (scope_type = 'user' AND user_scope IS scope_id)
          OR (scope_type IN ('project', 'session') AND user_scope IS NULL)
        )
      );
      ${AGENT_MEMORY_TOMBSTONE_TABLE_SQL}
      ${AGENT_MEMORY_CLEAR_ARTIFACT_SQL}
      ${AGENT_MEMORY_DERIVATION_TABLE_SQL}
      ${AGENT_MEMORY_DIRTY_TABLE_SQL}
      ${AGENT_MEMORY_DIRTY_BACKFILL_SQL}
      ${AGENT_MEMORY_DIRTY_TRIGGER_SQL}
      ${AGENT_MEMORY_BASE_INDEX_SQL}
      ${AGENT_MEMORY_CONFLICT_INDEX_SQL}
      ${AGENT_MEMORY_CANONICAL_INDEX_SQL}
      ${AGENT_MEMORY_TEMPORAL_TRIGGER_SQL}
      ${AGENT_MEMORY_SCOPE_INDEX_SQL}
      ${AGENT_MEMORY_SCOPE_TRIGGER_SQL}
      ${AGENT_MEMORY_LEGACY_STATUS_BRIDGE_SQL}
    `
  }

  override createTable(): void {
    this.db.function('agent_memory_fts_scope', { deterministic: true }, (agentId: unknown) =>
      agentFtsScope(typeof agentId === 'string' ? agentId : String(agentId))
    )
    if (!this.tableExists()) {
      this.db.exec(this.getCreateTableSQL())
      this.temporalArtifactsEnsured = true
    } else {
      this.db.exec(AGENT_MEMORY_TOMBSTONE_TABLE_SQL)
      this.db.exec(AGENT_MEMORY_BASE_INDEX_SQL)
      const columns = this.db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{
        name: string
      }>
      if (columns.some((column) => column.name === 'conflict_with')) {
        this.db.exec(AGENT_MEMORY_CONFLICT_INDEX_SQL)
      }
      if (
        columns.some((column) => column.name === 'decision_revision') &&
        columns.some((column) => column.name === 'lifecycle_state') &&
        columns.some((column) => column.name === 'embedding_state')
      ) {
        this.ensureLineageAndDirtyArtifacts()
      }
      if (
        columns.some((column) => column.name === 'temporal_kind') &&
        columns.some((column) => column.name === 'valid_from') &&
        columns.some((column) => column.name === 'valid_until') &&
        columns.some((column) => column.name === 'temporal_confidence') &&
        columns.some((column) => column.name === 'temporal_precision') &&
        columns.some((column) => column.name === 'temporal_timezone')
      ) {
        this.ensureTemporalArtifacts()
      }
      if (
        columns.some((column) => column.name === 'scope_type') &&
        columns.some((column) => column.name === 'scope_id')
      ) {
        this.ensureScopeArtifacts()
      }
    }
    this.ensureClearArtifacts()
    const currentColumns = this.db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{
      name: string
    }>
    if (
      currentColumns.some((column) => column.name === 'lifecycle_state') &&
      currentColumns.some((column) => column.name === 'embedding_state')
    ) {
      this.ensureFtsIndex()
    }
  }

  private ensureLineageAndDirtyArtifacts(): void {
    const dirtyTableExists = !!this.db
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'agent_memory_dirty'"
      )
      .get()
    this.db.exec(AGENT_MEMORY_DERIVATION_TABLE_SQL)
    this.db
      .prepare(
        `DELETE FROM agent_memory_derivation
         WHERE parent_memory_id = child_memory_id`
      )
      .run()
    this.db.exec(AGENT_MEMORY_DIRTY_TABLE_SQL)
    if (!dirtyTableExists) this.db.exec(AGENT_MEMORY_DIRTY_BACKFILL_SQL)
    this.db.exec(AGENT_MEMORY_DIRTY_TRIGGER_SQL)
  }

  private ensureClearArtifacts(): void {
    this.db.transaction(() => {
      this.db.exec(AGENT_MEMORY_CLEAR_GUARD_TRIGGER_DROP_SQL)
      this.db.exec(AGENT_MEMORY_CLEAR_ARTIFACT_SQL)
    })()
  }

  private ensureTemporalArtifacts(): void {
    if (this.temporalArtifactsEnsured) return
    const columns = new Set(
      (
        this.db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{
          name: string
        }>
      ).map((column) => column.name)
    )
    const archiveStateAssignments = [
      columns.has('lifecycle_state') ? "lifecycle_state = 'archived'" : null,
      columns.has('status') ? "status = 'archived'" : null
    ].filter((assignment): assignment is string => assignment !== null)
    const repair = this.db.transaction(() => {
      this.db.exec(AGENT_MEMORY_TEMPORAL_TRIGGER_DROP_SQL)
      const quarantinedIds = (
        this.db
          .prepare(
            `SELECT id
             FROM agent_memory
             WHERE (${AGENT_MEMORY_TEMPORAL_INVALID_ROW_SQL})
               AND kind NOT IN ('persona', 'working')
             ORDER BY id
             LIMIT 20`
          )
          .all() as Array<{ id: string }>
      ).map((row) => row.id)
      const quarantined =
        archiveStateAssignments.length > 0
          ? this.db
              .prepare(
                `UPDATE agent_memory
                 SET temporal_kind = 'atemporal',
                     valid_from = NULL,
                     valid_until = NULL,
                     temporal_confidence = NULL,
                     temporal_precision = NULL,
                     temporal_timezone = NULL,
                     ${archiveStateAssignments.join(', ')}
                 WHERE (${AGENT_MEMORY_TEMPORAL_INVALID_ROW_SQL})
                   AND kind NOT IN ('persona', 'working')`
              )
              .run().changes
          : this.db
              .prepare(
                `DELETE FROM agent_memory
                 WHERE (${AGENT_MEMORY_TEMPORAL_INVALID_ROW_SQL})
                   AND kind NOT IN ('persona', 'working')`
              )
              .run().changes
      const normalizedInternal = this.db
        .prepare(
          `UPDATE agent_memory
           SET temporal_kind = 'atemporal',
               valid_from = NULL,
               valid_until = NULL,
               temporal_confidence = NULL,
               temporal_precision = NULL,
               temporal_timezone = NULL
           WHERE (${AGENT_MEMORY_TEMPORAL_INVALID_ROW_SQL})
             AND kind IN ('persona', 'working')`
        )
        .run().changes
      this.db.exec(AGENT_MEMORY_TEMPORAL_TRIGGER_SQL)
      return {
        quarantined,
        quarantinedIds,
        normalizedInternal,
        repaired: quarantined + normalizedInternal
      }
    })()
    this.temporalArtifactsEnsured = true
    if (repair.repaired > 0) {
      const idSample = repair.quarantinedIds.length
        ? ` ids=${JSON.stringify(repair.quarantinedIds)}${repair.quarantined > repair.quarantinedIds.length ? '…' : ''}`
        : ''
      logger.warn(
        `[Memory] repaired invalid temporal metadata: quarantinedClaims=${repair.quarantined} normalizedInternal=${repair.normalizedInternal}${idSample}`
      )
    }
  }

  private ensureScopeArtifacts(): void {
    const columns = new Set(
      (
        this.db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{
          name: string
        }>
      ).map((column) => column.name)
    )
    if (!columns.has('scope_type') || !columns.has('scope_id')) return

    this.db.transaction(() => {
      this.db.exec(AGENT_MEMORY_SCOPE_TRIGGER_DROP_SQL)
      this.db.exec(AGENT_MEMORY_SCOPE_TRIGGER_SQL)
    })()
    const indexColumns = [
      'agent_id',
      'scope_type',
      'scope_id',
      'importance',
      'created_at',
      'id',
      'lifecycle_state',
      'superseded_by',
      'kind'
    ]
    if (indexColumns.every((column) => columns.has(column))) {
      this.db.exec(AGENT_MEMORY_SCOPE_INDEX_SQL)
    }
  }

  private insertTombstonesForRows(
    rows: readonly TombstoneSourceRow[],
    createdAt: number,
    reason: MemoryTombstoneReason
  ): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO agent_memory_tombstone (
         agent_id, identity_kind, identity_hash, created_at, reason
       ) VALUES (?, ?, ?, ?, ?)`
    )
    for (const row of rows) {
      if (!isTombstoneEligibleMemoryKind(row.kind)) continue
      for (const identity of buildMemoryTombstoneIdentities({
        agentId: row.agent_id,
        content: row.content,
        provenanceKey: row.provenance_key,
        scope: memoryScopeFromRow(row)
      })) {
        insert.run(row.agent_id, identity.identityKind, identity.identityHash, createdAt, reason)
      }
    }
  }

  private findTombstoneIdentitiesForClaim(
    input: TombstoneClaimIdentityInput
  ): ReturnType<typeof buildMemoryTombstoneIdentities> {
    if (!isTombstoneEligibleMemoryKind(input.kind)) return []
    const identities = buildMemoryTombstoneIdentities({
      agentId: input.agentId,
      content: input.content,
      provenanceKey: input.provenanceKey ?? null,
      scope: normalizeMemoryScope(input.scope)
    })
    const find = this.db.prepare(
      `SELECT 1 AS present
       FROM agent_memory_tombstone
       WHERE agent_id = ? AND identity_kind = ? AND identity_hash = ?
       LIMIT 1`
    )
    return identities.filter((identity) =>
      find.get(input.agentId, identity.identityKind, identity.identityHash)
    )
  }

  hasTombstoneForClaim(input: TombstoneClaimIdentityInput): boolean {
    return this.findTombstoneIdentitiesForClaim(input).length > 0
  }

  private replaceLegacyStatusBridge(): void {
    const conflictingObject = this.db
      .prepare(
        `SELECT type, name FROM sqlite_master
         WHERE name IN (?, ?) AND type != 'trigger'
         LIMIT 1`
      )
      .get(
        AGENT_MEMORY_LEGACY_STATUS_BRIDGE_INSERT_NAME,
        AGENT_MEMORY_LEGACY_STATUS_BRIDGE_UPDATE_NAME
      ) as { type: string; name: string } | undefined
    if (conflictingObject) {
      throw new Error(
        `[Memory] legacy status bridge name is occupied by ${conflictingObject.type}: ${conflictingObject.name}`
      )
    }
    this.db.exec(`
      ${this.dropLegacyStatusBridgeSql()}
      ${AGENT_MEMORY_LEGACY_STATUS_BRIDGE_SQL}
    `)
  }

  private dropLegacyStatusBridgeSql(): string {
    return `
      DROP TRIGGER IF EXISTS ${AGENT_MEMORY_LEGACY_STATUS_BRIDGE_INSERT_NAME};
      DROP TRIGGER IF EXISTS ${AGENT_MEMORY_LEGACY_STATUS_BRIDGE_UPDATE_NAME};
    `
  }

  private legacyStatusBridgeDefinitionsMatch(): boolean {
    const rows = this.db
      .prepare(
        `SELECT name, sql
         FROM sqlite_master
         WHERE type = 'trigger' AND name IN (?, ?)`
      )
      .all(
        AGENT_MEMORY_LEGACY_STATUS_BRIDGE_INSERT_NAME,
        AGENT_MEMORY_LEGACY_STATUS_BRIDGE_UPDATE_NAME
      ) as Array<{ name: string; sql: string | null }>
    const actual = new Map(rows.map((row) => [row.name, normalizeSchemaDefinition(row.sql)]))
    return [...AGENT_MEMORY_LEGACY_STATUS_BRIDGE_DEFINITIONS].every(
      ([name, sql]) => actual.get(name) === normalizeSchemaDefinition(sql)
    )
  }

  private ensureCurrentLegacyStatusBridge(backupBeforeRecovery?: () => string | null): void {
    if (this.legacyStatusBridgeDefinitionsMatch()) return
    const mismatchCount = this.countLegacyShadowMismatches()
    if (mismatchCount === 0) {
      this.db.transaction(() => this.replaceLegacyStatusBridge())()
      return
    }
    if (!backupBeforeRecovery) {
      throw new Error('[Memory] legacy status bridge recovery requires a database backup callback')
    }
    const backupPath = backupBeforeRecovery()
    if (!backupPath) throw new Error('[Memory] failed to back up database before bridge recovery')

    const recovery = this.db.transaction(() => {
      this.db.exec(this.dropLegacyStatusBridgeSql())
      const internalCanonicalPreserved = this.db
        .prepare(
          `UPDATE agent_memory
           SET status = ${buildLegacyStatusProjectionSql()}
           WHERE ${buildLegacyShadowMismatchPredicateSql()}
             AND ${buildInternalKindPredicateSql()}
             AND status = 'fts_only'
             AND lifecycle_state IN ('archived', 'conflicted')
             AND embedding_state = 'not_applicable'`
        )
        .run().changes
      const lifecycleExpression = buildLegacyLifecycleStateSql()
      const embeddingExpression = buildLegacyEmbeddingStateSql()
      const legacyRepaired = this.db
        .prepare(
          `UPDATE agent_memory
           SET lifecycle_state = ${lifecycleExpression},
               embedding_state = ${embeddingExpression},
               status = ${buildStatusProjectionFromExpressionsSql(lifecycleExpression, embeddingExpression)}
           WHERE ${buildLegacyShadowMismatchPredicateSql()}`
        )
        .run().changes
      this.replaceLegacyStatusBridge()
      const remaining = this.countLegacyShadowMismatches()
      if (remaining !== 0) {
        throw new Error(`[Memory] legacy status bridge recovery left ${remaining} mismatches`)
      }
      return { internalCanonicalPreserved, legacyRepaired }
    })()

    logger.warn(
      `[Memory] repaired legacy status bridge mismatches: legacy=${recovery.legacyRepaired} internalCanonical=${recovery.internalCanonicalPreserved} backup=${backupPath}`
    )
  }

  assertCurrentSchema(options?: { backupBeforeLegacyBridgeRecovery?: () => string | null }): void {
    const columns = this.db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{
      name: string
      notnull: number
      dflt_value: string | null
    }>
    for (const columnName of [
      'decision_revision',
      'lifecycle_state',
      'embedding_state',
      'temporal_kind',
      'valid_from',
      'valid_until',
      'temporal_confidence',
      'temporal_precision',
      'temporal_timezone',
      'scope_type',
      'scope_id'
    ]) {
      if (!columns.some((column) => column.name === columnName)) {
        throw new Error(`[Memory] agent_memory schema migration is incomplete: ${columnName}`)
      }
    }
    this.ensureTemporalArtifacts()
    const tableSql = (
      this.db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_memory'")
        .get() as { sql: string | null } | undefined
    )?.sql
    const lifecycleColumn = columns.find((column) => column.name === 'lifecycle_state')
    const embeddingColumn = columns.find((column) => column.name === 'embedding_state')
    const temporalKindColumn = columns.find((column) => column.name === 'temporal_kind')
    const scopeTypeColumn = columns.find((column) => column.name === 'scope_type')
    const normalizedTableSql = tableSql?.replace(/\s+/gu, ' ')
    if (
      lifecycleColumn?.notnull !== 1 ||
      lifecycleColumn.dflt_value !== "'active'" ||
      !tableSql?.includes("CHECK (lifecycle_state IN ('active', 'archived', 'conflicted'))")
    ) {
      throw new Error('[Memory] agent_memory lifecycle_state constraints are incomplete')
    }
    if (
      embeddingColumn?.notnull !== 1 ||
      embeddingColumn.dflt_value !== "'pending'" ||
      !tableSql?.includes(
        "CHECK (embedding_state IN ('pending', 'ready', 'error', 'fts_only', 'not_applicable'))"
      )
    ) {
      throw new Error('[Memory] agent_memory embedding_state constraints are incomplete')
    }
    if (
      temporalKindColumn?.notnull !== 1 ||
      temporalKindColumn.dflt_value !== "'atemporal'" ||
      !normalizedTableSql?.includes(
        "CHECK (temporal_kind IN ('atemporal', 'state', 'event', 'plan', 'recurring'))"
      ) ||
      !normalizedTableSql.includes(
        'CHECK (temporal_confidence IS NULL OR (temporal_confidence >= 0 AND temporal_confidence <= 1))'
      ) ||
      !normalizedTableSql.includes(
        "CHECK (temporal_precision IS NULL OR temporal_precision IN ('exact', 'day', 'week', 'month', 'quarter', 'year', 'unknown'))"
      ) ||
      !normalizedTableSql.includes(
        'CHECK (temporal_timezone IS NULL OR (length(temporal_timezone) BETWEEN 1 AND 128 AND temporal_timezone = trim(temporal_timezone)))'
      )
    ) {
      throw new Error('[Memory] agent_memory temporal constraints are incomplete')
    }
    if (
      scopeTypeColumn?.notnull !== 1 ||
      scopeTypeColumn.dflt_value !== "'agent'" ||
      !normalizedTableSql?.includes(
        "CHECK (scope_type IN ('agent', 'user', 'project', 'session'))"
      ) ||
      !normalizedTableSql.includes(
        `CHECK (scope_id IS NULL OR (length(scope_id) BETWEEN 1 AND ${AGENT_MEMORY_SCOPE_ID_MAX_CHARS} AND scope_id = trim(scope_id)))`
      )
    ) {
      throw new Error('[Memory] agent_memory scope constraints are incomplete')
    }
    const invalidTemporalRows = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM agent_memory
           WHERE ${AGENT_MEMORY_TEMPORAL_INVALID_ROW_SQL}`
        )
        .get() as { count: number }
    ).count
    if (invalidTemporalRows !== 0) {
      throw new Error(
        `[Memory] agent_memory contains ${invalidTemporalRows} invalid temporal claim rows`
      )
    }
    const invalidScopeRows = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM agent_memory
           WHERE scope_type NOT IN ('agent', 'user', 'project', 'session')
              OR (scope_type = 'agent' AND scope_id IS NOT NULL)
              OR (
                scope_type != 'agent'
                AND (
                  scope_id IS NULL
                  OR length(scope_id) NOT BETWEEN 1 AND ?
                  OR scope_id != trim(scope_id)
                )
              )
              OR (scope_type = 'user' AND user_scope IS NOT scope_id)
              OR (scope_type IN ('project', 'session') AND user_scope IS NOT NULL)`
        )
        .get(AGENT_MEMORY_SCOPE_ID_MAX_CHARS) as { count: number }
    ).count
    if (invalidScopeRows !== 0) {
      throw new Error(`[Memory] agent_memory contains ${invalidScopeRows} invalid scope rows`)
    }
    this.db.exec(AGENT_MEMORY_BASE_INDEX_SQL)
    this.db.exec(AGENT_MEMORY_RETIRED_INDEX_SQL)
    this.db.exec(AGENT_MEMORY_CONFLICT_INDEX_SQL)
    this.db.exec(AGENT_MEMORY_CANONICAL_INDEX_SQL)
    this.ensureScopeArtifacts()
    this.ensureCurrentLegacyStatusBridge(options?.backupBeforeLegacyBridgeRecovery)
    const tombstoneSql = (
      this.db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_memory_tombstone'"
        )
        .get() as { sql: string | null } | undefined
    )?.sql
    const normalizedTombstoneSql = tombstoneSql?.replace(/\s+/gu, ' ').trim()
    if (
      !normalizedTombstoneSql?.includes("CHECK (identity_kind IN ('provenance', 'content'))") ||
      !normalizedTombstoneSql.includes(
        "CHECK (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*')"
      ) ||
      !normalizedTombstoneSql.includes("CHECK (reason IN ('selective_delete', 'agent_clear'))") ||
      !normalizedTombstoneSql.includes('PRIMARY KEY (agent_id, identity_kind, identity_hash)') ||
      !normalizedTombstoneSql.endsWith('WITHOUT ROWID')
    ) {
      throw new Error('[Memory] agent_memory_tombstone constraints are incomplete')
    }
    const clearJobSql = (
      this.db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_memory_clear_job'"
        )
        .get() as { sql: string | null } | undefined
    )?.sql
    const normalizedClearJobSql = clearJobSql?.replace(/\s+/gu, ' ').trim()
    if (
      !normalizedClearJobSql?.includes('CHECK (cutoff_rowid >= 0)') ||
      !normalizedClearJobSql.includes('CHECK (created_at >= 0)') ||
      !normalizedClearJobSql.includes('CHECK (removed_count >= 0)') ||
      !normalizedClearJobSql.includes("CHECK (phase IN ('claims', 'vectors'))") ||
      !normalizedClearJobSql.includes('agent_id TEXT PRIMARY KEY') ||
      !normalizedClearJobSql.endsWith('WITHOUT ROWID')
    ) {
      throw new Error('[Memory] agent_memory_clear_job constraints are incomplete')
    }
    for (const [name, signature, identityGuard] of [
      [
        AGENT_MEMORY_CLEAR_GUARD_INSERT_TRIGGER_NAME,
        'BEFORE INSERT ON agent_memory',
        'WHERE agent_id = NEW.agent_id'
      ],
      [
        AGENT_MEMORY_CLEAR_GUARD_UPDATE_TRIGGER_NAME,
        'BEFORE UPDATE ON agent_memory',
        'WHERE agent_id IN (OLD.agent_id, NEW.agent_id)'
      ]
    ] as const) {
      const triggerSql = (
        this.db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get(name) as { sql: string | null } | undefined
      )?.sql
        ?.replace(/\s+/gu, ' ')
        .trim()
      if (
        !triggerSql?.includes(signature) ||
        !triggerSql.includes('SELECT 1 FROM agent_memory_clear_job') ||
        !triggerSql.includes(identityGuard) ||
        !triggerSql.includes("SELECT RAISE(ABORT, 'agent memory clear in progress')")
      ) {
        throw new Error(`[Memory] ${name} is incomplete`)
      }
    }
    const derivationSql = (
      this.db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_memory_derivation'"
        )
        .get() as { sql: string | null } | undefined
    )?.sql
    const normalizedDerivationSql = derivationSql?.replace(/\s+/gu, ' ').trim()
    if (
      !normalizedDerivationSql?.includes(
        "CHECK (derivation_kind IN ('merge', 'reflection', 'supersede', 'manual_edit'))"
      ) ||
      !normalizedDerivationSql.includes(
        'PRIMARY KEY (agent_id, parent_memory_id, child_memory_id, derivation_kind)'
      ) ||
      !normalizedDerivationSql.endsWith('WITHOUT ROWID')
    ) {
      throw new Error('[Memory] agent_memory_derivation constraints are incomplete')
    }
    const dirtySql = (
      this.db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_memory_dirty'"
        )
        .get() as { sql: string | null } | undefined
    )?.sql
    const normalizedDirtySql = dirtySql?.replace(/\s+/gu, ' ').trim()
    if (
      !normalizedDirtySql?.includes('CHECK (generation >= 1)') ||
      !normalizedDirtySql.includes('CHECK (claim_revision >= 1)') ||
      !normalizedDirtySql.includes('PRIMARY KEY (agent_id, memory_id)') ||
      !normalizedDirtySql.endsWith('WITHOUT ROWID')
    ) {
      throw new Error('[Memory] agent_memory_dirty constraints are incomplete')
    }
    for (const [name, signature, kindSignature] of [
      [
        'agent_memory_dirty_ai',
        'AFTER INSERT ON agent_memory',
        "WHEN NEW.kind IN ('episodic', 'semantic', 'reflection')"
      ],
      [
        'agent_memory_dirty_au',
        'AFTER UPDATE OF decision_revision, embedding_state, embedding_dim, embedding_model ON agent_memory',
        "WHEN NEW.kind IN ('episodic', 'semantic', 'reflection')"
      ],
      [
        'agent_memory_dirty_ad',
        'AFTER DELETE ON agent_memory',
        "WHEN OLD.kind IN ('episodic', 'semantic', 'reflection')"
      ]
    ] as const) {
      const triggerSql = (
        this.db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get(name) as { sql: string | null } | undefined
      )?.sql
      const normalizedTriggerSql = triggerSql?.replace(/\s+/gu, ' ')
      if (
        !normalizedTriggerSql?.includes(signature) ||
        !normalizedTriggerSql.includes(kindSignature) ||
        !normalizedTriggerSql.includes('INSERT INTO agent_memory_dirty') ||
        !normalizedTriggerSql.includes('generation = agent_memory_dirty.generation + 1')
      ) {
        throw new Error(`[Memory] ${name} is incomplete`)
      }
    }
    for (const indexName of [
      'idx_agent_memory_derivation_child_v1',
      'idx_agent_memory_dirty_order_v1',
      'idx_agent_memory_recall_scope_v6'
    ]) {
      if (
        !this.db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get(indexName)
      ) {
        throw new Error(`[Memory] required index is missing: ${indexName}`)
      }
    }
    for (const [name, signature] of [
      [AGENT_MEMORY_SCOPE_TRIGGER_INSERT_NAME, 'BEFORE INSERT ON agent_memory'],
      [
        AGENT_MEMORY_SCOPE_TRIGGER_UPDATE_NAME,
        'BEFORE UPDATE OF user_scope, scope_type, scope_id ON agent_memory'
      ]
    ] as const) {
      const triggerSql = (
        this.db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get(name) as { sql: string | null } | undefined
      )?.sql
        ?.replace(/\s+/gu, ' ')
        .trim()
      if (
        !triggerSql?.includes(signature) ||
        !triggerSql.includes("NEW.scope_type NOT IN ('agent', 'user', 'project', 'session')") ||
        !triggerSql.includes('NEW.user_scope IS NOT NEW.scope_id') ||
        !triggerSql.includes("SELECT RAISE(ABORT, 'invalid agent_memory scope')")
      ) {
        throw new Error(`[Memory] ${name} is incomplete`)
      }
    }
    for (const [name, signature] of [
      [AGENT_MEMORY_TEMPORAL_TRIGGER_INSERT_NAME, 'BEFORE INSERT ON agent_memory'],
      [
        AGENT_MEMORY_TEMPORAL_TRIGGER_UPDATE_NAME,
        'BEFORE UPDATE OF temporal_kind, valid_from, valid_until, temporal_confidence, temporal_precision, temporal_timezone ON agent_memory'
      ]
    ] as const) {
      const triggerSql = (
        this.db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get(name) as { sql: string | null } | undefined
      )?.sql
        ?.replace(/\s+/gu, ' ')
        .trim()
      if (
        !triggerSql?.includes(signature) ||
        !triggerSql.includes("NEW.temporal_kind NOT IN ('atemporal', 'state', 'event', 'plan'") ||
        !triggerSql.includes("SELECT RAISE(ABORT, 'invalid agent_memory temporal metadata')")
      ) {
        throw new Error(`[Memory] ${name} is incomplete`)
      }
    }
    this.ensureFtsIndex()
  }

  finalizeMigration(version: number): void {
    if (version === AGENT_MEMORY_RESUMABLE_CLEAR_SCHEMA_VERSION) {
      this.ensureClearArtifacts()
      return
    }
    if (version === AGENT_MEMORY_TEMPORAL_SCHEMA_VERSION) {
      this.ensureTemporalArtifacts()
      return
    }
    if (version === AGENT_MEMORY_SCOPE_SCHEMA_VERSION) {
      this.ensureScopeArtifacts()
      return
    }
    if (
      version === AGENT_MEMORY_LINEAGE_SCHEMA_VERSION ||
      version === AGENT_MEMORY_REFLECTION_DIRTY_SCHEMA_VERSION
    ) {
      this.db.exec(AGENT_MEMORY_DIRTY_TRIGGER_SQL)
      return
    }
    if (version !== AGENT_MEMORY_STATE_MODEL_SCHEMA_VERSION) return
    this.replaceLegacyStatusBridge()
    const markerExists = this.db
      .prepare(
        `SELECT 1 AS present FROM sqlite_temp_master
         WHERE type = 'table' AND name = 'agent_memory_v42_added_columns'`
      )
      .get() as { present: number } | undefined
    if (!markerExists) return
    const addedColumnCount = (
      this.db.prepare('SELECT COUNT(*) AS count FROM agent_memory_v42_added_columns').get() as {
        count: number
      }
    ).count
    const ftsMetaExists = this.db
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'agent_memory_fts_meta'"
      )
      .get()
    if (addedColumnCount === 2 && ftsMetaExists) {
      this.db
        .prepare(
          `UPDATE agent_memory_fts_meta
           SET policy_version = ?, updated_at = ?
           WHERE key = ? AND policy_version = ?
             AND mutation_generation = indexed_generation`
        )
        .run(
          AGENT_MEMORY_FTS_POLICY_VERSION,
          Date.now(),
          AGENT_MEMORY_FTS_META_KEY,
          PREVIOUS_AGENT_MEMORY_FTS_POLICY_VERSION
        )
    }
    const stats = this.db
      .prepare(
        'SELECT normalized_legacy_status_count AS count FROM agent_memory_v42_migration_stats'
      )
      .get() as { count: number } | undefined
    if ((stats?.count ?? 0) > 0) {
      logger.warn(`[Memory] v42 normalized legacy status rows: ${stats?.count ?? 0}`)
    }
    this.db.exec(`
      DROP TABLE agent_memory_v42_migration_stats;
      DROP TABLE agent_memory_v42_added_columns;
    `)
  }

  getMigrationSQL(version: number): string | null {
    if (version === 32) {
      // FTS5 objects are (re)built idempotently in ensureFtsIndex() because the tokenizer is
      // chosen from runtime capabilities; only columns land here for existing databases.
      // source_entry_ids first shipped without its own migration, so older tables lack it; it is
      // backfilled alongside embedding_model. Duplicate ADD COLUMN is ignored by the runner.
      return [
        'ALTER TABLE agent_memory ADD COLUMN embedding_model TEXT;',
        'ALTER TABLE agent_memory ADD COLUMN source_entry_ids TEXT;'
      ].join('\n')
    }
    if (version === 33) {
      return [
        'ALTER TABLE agent_memory ADD COLUMN confidence REAL;',
        'ALTER TABLE agent_memory ADD COLUMN last_consolidated_at INTEGER;',
        'ALTER TABLE agent_memory ADD COLUMN conflict_state TEXT;'
      ].join('\n')
    }
    if (version === 34) {
      return 'ALTER TABLE agent_memory ADD COLUMN persona_state TEXT;'
    }
    if (version === 35) {
      return [
        'ALTER TABLE agent_memory ADD COLUMN conflict_with TEXT;',
        AGENT_MEMORY_CONFLICT_INDEX_SQL
      ].join('\n')
    }
    if (version === 37) {
      return 'ALTER TABLE agent_memory ADD COLUMN category TEXT;'
    }
    if (version === 41) {
      return 'ALTER TABLE agent_memory ADD COLUMN decision_revision INTEGER NOT NULL DEFAULT 1;'
    }
    if (version === 42) {
      return [
        AGENT_MEMORY_V42_MARKER_SETUP_SQL,
        "ALTER TABLE agent_memory ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'archived', 'conflicted'));",
        "ALTER TABLE agent_memory ADD COLUMN embedding_state TEXT NOT NULL DEFAULT 'pending' CHECK (embedding_state IN ('pending', 'ready', 'error', 'fts_only', 'not_applicable'));",
        AGENT_MEMORY_V42_COMBINED_BACKFILL_SQL,
        AGENT_MEMORY_V42_TARGETED_LIFECYCLE_BACKFILL_SQL,
        AGENT_MEMORY_V42_TARGETED_EMBEDDING_BACKFILL_SQL,
        AGENT_MEMORY_SHADOW_RECONCILE_SQL,
        AGENT_MEMORY_RETIRED_INDEX_SQL,
        AGENT_MEMORY_CANONICAL_INDEX_SQL
      ].join('\n')
    }
    if (version === AGENT_MEMORY_TEMPORAL_SCHEMA_VERSION) {
      return [
        "ALTER TABLE agent_memory ADD COLUMN temporal_kind TEXT NOT NULL DEFAULT 'atemporal' CHECK (temporal_kind IN ('atemporal', 'state', 'event', 'plan', 'recurring'));",
        'ALTER TABLE agent_memory ADD COLUMN valid_from INTEGER;',
        'ALTER TABLE agent_memory ADD COLUMN valid_until INTEGER;',
        'ALTER TABLE agent_memory ADD COLUMN temporal_confidence REAL CHECK (temporal_confidence IS NULL OR (temporal_confidence >= 0 AND temporal_confidence <= 1));',
        "ALTER TABLE agent_memory ADD COLUMN temporal_precision TEXT CHECK (temporal_precision IS NULL OR temporal_precision IN ('exact', 'day', 'week', 'month', 'quarter', 'year', 'unknown'));",
        'ALTER TABLE agent_memory ADD COLUMN temporal_timezone TEXT CHECK (temporal_timezone IS NULL OR (length(temporal_timezone) BETWEEN 1 AND 128 AND temporal_timezone = trim(temporal_timezone)));'
      ].join('\n')
    }
    if (version === AGENT_MEMORY_TOMBSTONE_SCHEMA_VERSION) {
      return AGENT_MEMORY_TOMBSTONE_TABLE_SQL
    }
    if (version === AGENT_MEMORY_LINEAGE_SCHEMA_VERSION) {
      return [
        AGENT_MEMORY_DERIVATION_TABLE_SQL,
        AGENT_MEMORY_DIRTY_TABLE_SQL,
        AGENT_MEMORY_DIRTY_BACKFILL_SQL
      ].join('\n')
    }
    if (version === AGENT_MEMORY_REFLECTION_DIRTY_SCHEMA_VERSION) {
      return [AGENT_MEMORY_DIRTY_TRIGGER_DROP_SQL, AGENT_MEMORY_DIRTY_BACKFILL_SQL].join('\n')
    }
    if (version === AGENT_MEMORY_SCOPE_SCHEMA_VERSION) {
      return [
        "ALTER TABLE agent_memory ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'agent' CHECK (scope_type IN ('agent', 'user', 'project', 'session'));",
        `ALTER TABLE agent_memory ADD COLUMN scope_id TEXT CHECK (scope_id IS NULL OR (length(scope_id) BETWEEN 1 AND ${AGENT_MEMORY_SCOPE_ID_MAX_CHARS} AND scope_id = trim(scope_id)));`,
        AGENT_MEMORY_SCOPE_INDEX_SQL
      ].join('\n')
    }
    if (version === AGENT_MEMORY_RESUMABLE_CLEAR_SCHEMA_VERSION) {
      return AGENT_MEMORY_CLEAR_JOB_TABLE_SQL
    }
    return null
  }

  getLatestVersion(): number {
    return AGENT_MEMORY_SCHEMA_VERSION
  }

  repairCanonicalStateAfterSchemaRepair(addedColumns: ReadonlySet<string>): void {
    if (addedColumns.has('lifecycle_state')) {
      this.db.exec(AGENT_MEMORY_LIFECYCLE_BACKFILL_SQL)
    }
    if (addedColumns.has('embedding_state')) {
      this.db.exec(AGENT_MEMORY_EMBEDDING_BACKFILL_SQL)
    }
    if (addedColumns.has('lifecycle_state') || addedColumns.has('embedding_state')) {
      this.db.exec(AGENT_MEMORY_SHADOW_RECONCILE_SQL)
      this.db.exec(AGENT_MEMORY_RETIRED_INDEX_SQL)
      this.db.exec(AGENT_MEMORY_CANONICAL_INDEX_SQL)
      if (
        this.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'agent_memory_fts_meta'").get()
      ) {
        this.db.prepare("DELETE FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'").run()
      }
      this.replaceLegacyStatusBridge()
    }
    if (addedColumns.has('scope_type') || addedColumns.has('scope_id')) {
      this.ensureScopeArtifacts()
    }
    if (
      [
        'temporal_kind',
        'valid_from',
        'valid_until',
        'temporal_confidence',
        'temporal_precision',
        'temporal_timezone'
      ].some((column) => addedColumns.has(column))
    ) {
      this.temporalArtifactsEnsured = false
      this.ensureTemporalArtifacts()
    }
  }

  // Detects the best available FTS5 tokenizer once per connection. trigram gives substring
  // matching across languages (including CJK) but only indexes >=3 character fragments;
  // unicode61 is the word-boundary fallback; neither means FTS5 is unavailable.
  private detectFtsCapability(): FtsCapability {
    if (this.ftsCapability) return this.ftsCapability
    const probe = (tokenizer: string): boolean => {
      const name = `temp.fts5_probe_${tokenizer}`
      try {
        this.db.exec(
          `CREATE VIRTUAL TABLE IF NOT EXISTS ${name} USING fts5(c, tokenize='${tokenizer}');`
        )
        this.db.exec(`DROP TABLE IF EXISTS ${name};`)
        return true
      } catch {
        return false
      }
    }
    if (probe('trigram')) this.ftsCapability = { available: true, tokenizer: 'trigram' }
    else if (probe('unicode61')) this.ftsCapability = { available: true, tokenizer: 'unicode61' }
    else this.ftsCapability = { available: false, tokenizer: 'unicode61' }
    return this.ftsCapability
  }

  private ftsTableExists(): boolean {
    const row = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_memory_fts'`)
      .get()
    return !!row
  }

  private readFtsMeta():
    | {
        schema_version: number
        policy_version: number
        tokenizer: string
        mutation_generation: number
        indexed_generation: number
      }
    | undefined {
    return this.db
      .prepare(
        `SELECT schema_version, policy_version, tokenizer, mutation_generation, indexed_generation
         FROM agent_memory_fts_meta WHERE key = ?`
      )
      .get(AGENT_MEMORY_FTS_META_KEY) as
      | {
          schema_version: number
          policy_version: number
          tokenizer: string
          mutation_generation: number
          indexed_generation: number
        }
      | undefined
  }

  private writeFtsMeta(tokenizer: string, generation: number): void {
    this.db
      .prepare(
        `INSERT INTO agent_memory_fts_meta (
           key, schema_version, policy_version, tokenizer, mutation_generation, indexed_generation, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           schema_version = excluded.schema_version,
           policy_version = excluded.policy_version,
           tokenizer = excluded.tokenizer,
           mutation_generation = excluded.mutation_generation,
           indexed_generation = excluded.indexed_generation,
           updated_at = excluded.updated_at`
      )
      .run(
        AGENT_MEMORY_FTS_META_KEY,
        AGENT_MEMORY_FTS_META_VERSION,
        AGENT_MEMORY_FTS_POLICY_VERSION,
        tokenizer,
        generation,
        generation,
        Date.now()
      )
  }

  private markFtsDirty(): number {
    try {
      const result = this.db
        .prepare(
          `UPDATE agent_memory_fts_meta
           SET mutation_generation = mutation_generation + 1, updated_at = ?
           WHERE key = ?
           RETURNING mutation_generation`
        )
        .get(Date.now(), AGENT_MEMORY_FTS_META_KEY) as { mutation_generation: number } | undefined
      return result?.mutation_generation ?? -1
    } catch {
      this.ftsReady = false
      return -1
    }
  }

  private markFtsIndexed(generation: number): void {
    if (generation < 0) return
    this.db
      .prepare(
        `UPDATE agent_memory_fts_meta
         SET indexed_generation = ?, updated_at = ?
         WHERE key = ? AND mutation_generation = ?`
      )
      .run(generation, Date.now(), AGENT_MEMORY_FTS_META_KEY, generation)
  }

  private runRecallMutation<T>(input: {
    mutate: () => T
    didMutate: (result: T) => boolean
    maintainFts: (result: T) => void
  }): T {
    return this.db.transaction(() => {
      const result = input.mutate()
      if (!input.didMutate(result)) return result
      const generation = this.markFtsDirty()
      if (!this.ftsReady || generation < 0) return result
      try {
        this.db.transaction(() => input.maintainFts(result))()
        this.markFtsIndexed(generation)
      } catch {
        this.ftsReady = false
      }
      return result
    })()
  }

  private getFtsMirrorRow(id: string): FtsMirrorRow | undefined {
    return this.db.prepare('SELECT rowid, * FROM agent_memory WHERE id = ?').get(id) as
      | FtsMirrorRow
      | undefined
  }

  private deleteFtsMirrorRow(row: FtsMirrorRow | undefined, force = false): void {
    if (!row || (!force && !isRecallableFtsRow(row))) return
    this.db
      .prepare(
        `INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, agent_id)
         VALUES ('delete', ?, ?, ?)`
      )
      .run(row.rowid, row.content, agentFtsScope(row.agent_id))
  }

  private insertFtsMirrorRow(row: FtsMirrorRow | undefined): void {
    if (!isRecallableFtsRow(row)) return
    this.db
      .prepare('INSERT INTO agent_memory_fts(rowid, content, agent_id) VALUES (?, ?, ?)')
      .run(row.rowid, row.content, agentFtsScope(row.agent_id))
  }

  private replaceFtsMirrorRow(before: FtsMirrorRow | undefined, afterId: string): void {
    this.deleteFtsMirrorRow(before)
    this.insertFtsMirrorRow(this.getFtsMirrorRow(afterId))
  }

  private runRecallBulkDelete<T>(deleteMirror: () => void, mutation: () => T): T {
    return this.db.transaction(() => {
      const generation = this.markFtsDirty()
      let mirrorUpdated = false
      if (this.ftsReady && generation >= 0) {
        try {
          this.db.transaction(deleteMirror)()
          mirrorUpdated = true
        } catch {
          this.ftsReady = false
        }
      }
      const result = mutation()
      if (mirrorUpdated) this.markFtsIndexed(generation)
      return result
    })()
  }

  private dropFtsIndex(): void {
    this.db.exec(`
      DROP TRIGGER IF EXISTS agent_memory_fts_ai;
      DROP TRIGGER IF EXISTS agent_memory_fts_ad;
      DROP TRIGGER IF EXISTS agent_memory_fts_au;
      DROP TABLE IF EXISTS agent_memory_fts;
    `)
  }

  // Creates a filtered external-content FTS5 mirror. Authoritative mutations maintain the mirror
  // explicitly behind a nested savepoint so a rebuildable FTS failure cannot abort the main row.
  private ensureFtsIndex(): void {
    const capability = this.detectFtsCapability()
    if (!capability.available) {
      this.ftsReady = false
      if (process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE === '1') {
        throw new Error('[Memory] native SQLite FTS5 support is required')
      }
      return
    }
    if (capability.tokenizer !== 'trigram') {
      try {
        this.dropFtsIndex()
      } catch {}
      this.ftsReady = false
      return
    }
    try {
      this.db.transaction(() => {
        const metaColumns = this.db
          .prepare('PRAGMA table_info(agent_memory_fts_meta)')
          .all() as Array<{ name: string }>
        if (
          metaColumns.length > 0 &&
          (!metaColumns.some((column) => column.name === 'policy_version') ||
            !metaColumns.some((column) => column.name === 'mutation_generation') ||
            !metaColumns.some((column) => column.name === 'indexed_generation'))
        ) {
          this.db.exec('DROP TABLE IF EXISTS agent_memory_fts_meta;')
        }
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS agent_memory_fts_meta (
            key TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL,
            policy_version INTEGER NOT NULL,
            tokenizer TEXT NOT NULL,
            mutation_generation INTEGER NOT NULL,
            indexed_generation INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
        `)
        const meta = this.readFtsMeta()
        const alreadyBuilt = this.ftsTableExists()
        if (
          alreadyBuilt &&
          (!meta ||
            meta.schema_version !== AGENT_MEMORY_FTS_META_VERSION ||
            meta.policy_version !== AGENT_MEMORY_FTS_POLICY_VERSION ||
            meta.tokenizer !== capability.tokenizer ||
            meta.mutation_generation !== meta.indexed_generation)
        ) {
          this.dropFtsIndex()
        }
        const shouldBackfill = !this.ftsTableExists()
        // Retired trigger names are removed idempotently so older derived schemas cannot keep
        // mutating FTS outside the authoritative transaction/savepoint boundary.
        this.db.exec(`
          DROP TRIGGER IF EXISTS agent_memory_fts_ai;
          DROP TRIGGER IF EXISTS agent_memory_fts_ad;
          DROP TRIGGER IF EXISTS agent_memory_fts_au;
        `)
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(
            content,
            agent_id,
            content='agent_memory',
            content_rowid='rowid',
            tokenize='${capability.tokenizer}'
          );
        `)
        if (shouldBackfill) {
          this.db.exec(
            `INSERT INTO agent_memory_fts(rowid, content, agent_id)
             SELECT rowid, content, ${buildAgentFtsScopeSql('agent_id')} FROM agent_memory
             WHERE ${buildRecallablePredicate()};`
          )
        }
        this.writeFtsMeta(capability.tokenizer, meta?.mutation_generation ?? 0)
      })()
      this.ftsReady = true
    } catch (error) {
      try {
        this.dropFtsIndex()
      } catch {}
      this.ftsReady = false
      if (process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE === '1') throw error
    }
  }

  private recoverFtsIfNeeded(): void {
    if (this.ftsReady || this.ftsCapability?.tokenizer === 'unicode61') return
    const now = Date.now()
    if (now < this.ftsRecoveryAfter) return
    this.ftsRecoveryAfter = now + AGENT_MEMORY_FTS_RECOVERY_COOLDOWN_MS
    try {
      this.ensureFtsIndex()
      if (this.ftsReady) this.ftsRecoveryAfter = 0
    } catch {
      this.ftsReady = false
    }
  }

  insert(input: AgentMemoryInsertInput): AgentMemoryRow {
    const status = input.status ?? 'pending_embedding'
    if ((input.lifecycleState === undefined) !== (input.embeddingState === undefined)) {
      throw new Error('Memory inserts must provide both canonical state fields or neither')
    }
    const canonicalState =
      input.lifecycleState && input.embeddingState
        ? { lifecycleState: input.lifecycleState, embeddingState: input.embeddingState }
        : deriveCanonicalStateFromLegacy({ status, kind: input.kind })
    if (input.lifecycleState !== undefined && input.embeddingState !== undefined) {
      assertValidMemoryInsertState({
        kind: input.kind,
        lifecycleState: canonicalState.lifecycleState,
        embeddingState: canonicalState.embeddingState,
        conflictWith: input.conflictWith ?? null
      })
    }
    const temporal = normalizeMemoryTemporalMetadata(input.temporal)
    const scope = normalizeMemoryScope(input.scope)
    const row: AgentMemoryRow = {
      id: input.id,
      agent_id: input.agentId,
      user_scope: legacyUserScopeForMemoryScope(scope),
      scope_type: scope.type,
      scope_id: scope.type === 'agent' ? null : scope.id,
      kind: input.kind,
      category: input.category ?? null,
      content: input.content,
      importance: input.importance ?? 0.5,
      status: projectLegacyStatus(canonicalState.lifecycleState, canonicalState.embeddingState),
      lifecycle_state: canonicalState.lifecycleState,
      embedding_state: canonicalState.embeddingState,
      embedding_id: null,
      embedding_dim: null,
      embedding_model: null,
      source_session: input.sourceSession ?? null,
      provenance_key: input.provenanceKey ?? null,
      is_anchor: input.isAnchor ? 1 : 0,
      superseded_by: null,
      created_at: input.createdAt ?? Date.now(),
      last_accessed: null,
      access_count: 0,
      decay_score: null,
      source_entry_ids: serializeAgentMemorySourceEntryIds(input.sourceEntryIds),
      confidence: null,
      temporal_kind: temporal.temporalKind,
      valid_from: temporal.validFrom,
      valid_until: temporal.validUntil,
      temporal_confidence: temporal.temporalConfidence,
      temporal_precision: temporal.temporalPrecision,
      temporal_timezone: temporal.temporalTimeZone,
      last_consolidated_at: null,
      conflict_state: null,
      conflict_with: input.conflictWith ?? null,
      persona_state: input.personaState ?? null,
      decision_revision: 1
    }

    this.runRecallMutation({
      mutate: () =>
        this.db
          .prepare(
            `INSERT INTO agent_memory (
           id,
           agent_id,
           user_scope,
           scope_type,
           scope_id,
           kind,
           category,
           content,
           importance,
           status,
           embedding_id,
           embedding_dim,
           embedding_model,
           source_session,
           provenance_key,
           is_anchor,
           superseded_by,
           created_at,
           last_accessed,
           access_count,
           decay_score,
           source_entry_ids,
           confidence,
           temporal_kind,
           valid_from,
           valid_until,
           temporal_confidence,
           temporal_precision,
           temporal_timezone,
           last_consolidated_at,
           conflict_state,
           conflict_with,
           persona_state,
           decision_revision,
           lifecycle_state,
           embedding_state
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            row.id,
            row.agent_id,
            row.user_scope,
            row.scope_type,
            row.scope_id,
            row.kind,
            row.category,
            row.content,
            row.importance,
            row.status,
            row.embedding_id,
            row.embedding_dim,
            row.embedding_model,
            row.source_session,
            row.provenance_key,
            row.is_anchor,
            row.superseded_by,
            row.created_at,
            row.last_accessed,
            row.access_count,
            row.decay_score,
            row.source_entry_ids,
            row.confidence,
            row.temporal_kind,
            row.valid_from,
            row.valid_until,
            row.temporal_confidence,
            row.temporal_precision,
            row.temporal_timezone,
            row.last_consolidated_at,
            row.conflict_state,
            row.conflict_with,
            row.persona_state,
            row.decision_revision,
            row.lifecycle_state,
            row.embedding_state
          ),
      didMutate: (result) => result.changes === 1,
      maintainFts: () => this.insertFtsMirrorRow(this.getFtsMirrorRow(row.id))
    })

    return row
  }

  insertInternalMemory(input: InternalMemoryInsertInput): AgentMemoryRow {
    if (input.kind !== 'persona' && input.kind !== 'working') {
      throw new Error(`[Memory] unsupported internal memory kind: ${String(input.kind)}`)
    }
    return this.insert(input)
  }

  insertClaimUnlessTombstoned(input: AgentMemoryInsertInput): AgentMemoryRow | null {
    return this.db.transaction(() => {
      if (
        this.hasTombstoneForClaim({
          agentId: input.agentId,
          kind: input.kind,
          content: input.content,
          provenanceKey: input.provenanceKey,
          scope: normalizeMemoryScope(input.scope)
        })
      ) {
        return null
      }
      return this.insert(input)
    })()
  }

  insertExplicitlyReauthorizedClaim(input: AgentMemoryInsertInput): AgentMemoryRow | null {
    return this.db.transaction(() => {
      const identities = this.findTombstoneIdentitiesForClaim({
        agentId: input.agentId,
        kind: input.kind,
        content: input.content,
        provenanceKey: input.provenanceKey,
        scope: normalizeMemoryScope(input.scope)
      })
      if (identities.length === 0) return null
      const remove = this.db.prepare(
        `DELETE FROM agent_memory_tombstone
         WHERE agent_id = ? AND identity_kind = ? AND identity_hash = ?`
      )
      let released = 0
      for (const identity of identities) {
        released += remove.run(input.agentId, identity.identityKind, identity.identityHash).changes
      }
      if (released !== identities.length) {
        throw new Error('[Memory] exact tombstone release lost transactional consistency')
      }
      return this.insert(input)
    })()
  }

  insertDerivations(inputs: readonly MemoryDerivationInsertInput[]): number {
    if (!inputs.length) return 0
    const insert = this.db.prepare(
      `INSERT INTO agent_memory_derivation (
         agent_id, parent_memory_id, child_memory_id, derivation_kind, created_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (agent_id, parent_memory_id, child_memory_id, derivation_kind) DO NOTHING`
    )
    return this.db.transaction(() => {
      let inserted = 0
      const seen = new Set<string>()
      for (const input of inputs) {
        if (input.parentMemoryId === input.childMemoryId) continue
        const key = JSON.stringify([
          input.agentId,
          input.parentMemoryId,
          input.childMemoryId,
          input.derivationKind
        ])
        if (seen.has(key)) continue
        seen.add(key)
        inserted += insert.run(
          input.agentId,
          input.parentMemoryId,
          input.childMemoryId,
          input.derivationKind,
          input.createdAt
        ).changes
      }
      return inserted
    })()
  }

  listDerivationsByChild(agentId: string, childMemoryId: string): AgentMemoryDerivationRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory_derivation INDEXED BY idx_agent_memory_derivation_child_v1
         WHERE agent_id = ? AND child_memory_id = ?
           AND parent_memory_id != child_memory_id
         ORDER BY created_at ASC, parent_memory_id ASC, derivation_kind ASC`
      )
      .all(agentId, childMemoryId) as AgentMemoryDerivationRow[]
  }

  listDerivationsByParent(agentId: string, parentMemoryId: string): AgentMemoryDerivationRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory_derivation
         WHERE agent_id = ? AND parent_memory_id = ?
           AND parent_memory_id != child_memory_id
         ORDER BY created_at ASC, child_memory_id ASC, derivation_kind ASC`
      )
      .all(agentId, parentMemoryId) as AgentMemoryDerivationRow[]
  }

  listDirtySeeds(agentId: string, limit: number): MemoryDirtySeed[] {
    const cappedLimit = Number.isFinite(limit)
      ? Math.min(DIRTY_SEED_REPOSITORY_LIMIT, Math.max(0, Math.floor(limit)))
      : limit === Number.POSITIVE_INFINITY
        ? DIRTY_SEED_REPOSITORY_LIMIT
        : 0
    if (cappedLimit === 0) return []
    return this.db
      .prepare(
        `SELECT memory_id AS memoryId,
                generation,
                claim_revision AS claimRevision,
                enqueued_at AS enqueuedAt
         FROM agent_memory_dirty INDEXED BY idx_agent_memory_dirty_order_v1
         WHERE agent_id = ?
         ORDER BY enqueued_at ASC, memory_id ASC
         LIMIT ?`
      )
      .all(agentId, cappedLimit) as MemoryDirtySeed[]
  }

  settleDirtySeeds(agentId: string, seeds: readonly MemoryDirtySeed[]): number {
    if (!seeds.length) return 0
    const unique = [
      ...new Map(
        seeds.map((seed) => [JSON.stringify([seed.memoryId, seed.generation]), seed] as const)
      ).values()
    ].slice(0, DIRTY_SEED_REPOSITORY_LIMIT)
    const remove = this.db.prepare(
      `DELETE FROM agent_memory_dirty
       WHERE agent_id = ? AND memory_id = ? AND generation = ?`
    )
    return this.db.transaction(() =>
      unique.reduce(
        (removed, seed) => removed + remove.run(agentId, seed.memoryId, seed.generation).changes,
        0
      )
    )()
  }

  deferDirtySeeds(agentId: string, seeds: readonly MemoryDirtySeed[], deferredAt: number): number {
    if (!seeds.length || !Number.isFinite(deferredAt)) return 0
    const unique = [
      ...new Map(
        seeds.map((seed) => [JSON.stringify([seed.memoryId, seed.generation]), seed] as const)
      ).values()
    ].slice(0, DIRTY_SEED_REPOSITORY_LIMIT)
    const normalizedDeferredAt = Math.max(0, Math.floor(deferredAt))
    const defer = this.db.prepare(
      `UPDATE agent_memory_dirty
       SET enqueued_at = max(
         ?,
         (
           SELECT COALESCE(max(queued.enqueued_at), -1) + 1
           FROM agent_memory_dirty AS queued
           WHERE queued.agent_id = ?
         )
       )
       WHERE agent_id = ? AND memory_id = ? AND generation = ?`
    )
    return this.db.transaction(() =>
      unique.reduce(
        (deferred, seed) =>
          deferred +
          defer.run(normalizedDeferredAt, agentId, agentId, seed.memoryId, seed.generation).changes,
        0
      )
    )()
  }

  countDirtySeeds(agentId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM agent_memory_dirty WHERE agent_id = ?')
      .get(agentId) as { count: number } | undefined
    return row?.count ?? 0
  }

  getById(id: string): AgentMemoryRow | undefined {
    return this.db.prepare('SELECT * FROM agent_memory WHERE id = ?').get(id) as
      | AgentMemoryRow
      | undefined
  }

  getByProvenanceKey(agentId: string, provenanceKey: string): AgentMemoryRow | undefined {
    return this.db
      .prepare('SELECT * FROM agent_memory WHERE agent_id = ? AND provenance_key = ? LIMIT 1')
      .get(agentId, provenanceKey) as AgentMemoryRow | undefined
  }

  rekeyProvenance(agentId: string, id: string, expectedKey: string, nextKey: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE agent_memory SET provenance_key = ?
         WHERE id = ? AND agent_id = ? AND provenance_key = ?`
      )
      .run(nextKey, id, agentId, expectedKey)
    return result.changes === 1
  }

  listByIds(agentId: string, ids: string[]): AgentMemoryRow[] {
    const uniqueIds = [...new Set(ids.filter((id) => id.length > 0))]
    if (uniqueIds.length === 0) return []
    const placeholders = uniqueIds.map(() => '?').join(', ')
    return this.db
      .prepare(`SELECT * FROM agent_memory WHERE agent_id = ? AND id IN (${placeholders})`)
      .all(agentId, ...uniqueIds) as AgentMemoryRow[]
  }

  listApplicableByIds(
    agentId: string,
    ids: string[],
    scopeFilter: readonly MemoryScope[] = AGENT_MEMORY_AGENT_SCOPE_FILTER
  ): AgentMemoryRow[] {
    const uniqueIds = [...new Set(ids.filter((id) => id.length > 0))]
    if (uniqueIds.length === 0) return []
    const scopes = normalizeMemoryScopeFilter(scopeFilter)
    const scopePredicate = buildMemoryScopePredicateSql('am', scopes)
    const placeholders = uniqueIds.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT am.*
         FROM agent_memory am
         WHERE am.agent_id = ?
           AND am.id IN (${placeholders})
           AND ${scopePredicate.sql}`
      )
      .all(agentId, ...uniqueIds, ...scopePredicate.params) as AgentMemoryRow[]
  }

  getCognitiveMaintenanceInput(
    agentId: string,
    options: { kinds: AgentMemoryKind[]; watermark: number; limit: number }
  ): {
    eligibleCount: number
    importanceAfterWatermark: number
    maxCreatedAt: number
    topRows: AgentMemoryRow[]
  } {
    const kinds = [...new Set(options.kinds)]
    const limit = Math.max(0, Math.floor(options.limit))
    if (!kinds.length || limit === 0) {
      return { eligibleCount: 0, importanceAfterWatermark: 0, maxCreatedAt: 0, topRows: [] }
    }
    const placeholders = kinds.map(() => '?').join(', ')
    const predicate = `agent_id = ?
      AND superseded_by IS NULL
      AND lifecycle_state = 'active'
      AND scope_type = 'agent'
      AND scope_id IS NULL
      AND kind IN ('episodic', 'semantic', 'reflection')
      AND kind IN (${placeholders})`
    const aggregate = this.db
      .prepare(
        `SELECT COUNT(*) AS eligibleCount,
                COALESCE(SUM(CASE
                  WHEN created_at > ? THEN min(1.0, max(0.0, importance))
                  ELSE 0
                END), 0) AS importanceAfterWatermark,
                COALESCE(MAX(created_at), 0) AS maxCreatedAt
         FROM agent_memory
         WHERE ${predicate}`
      )
      .get(options.watermark, agentId, ...kinds) as
      | {
          eligibleCount: number
          importanceAfterWatermark: number
          maxCreatedAt: number
        }
      | undefined
    const topRows = this.db
      .prepare(
        `SELECT *
         FROM agent_memory INDEXED BY idx_agent_memory_cognitive_top_v3
         WHERE ${predicate}
         ORDER BY importance DESC, created_at DESC, id DESC
         LIMIT ?`
      )
      .all(agentId, ...kinds, limit) as AgentMemoryRow[]
    return {
      eligibleCount: aggregate?.eligibleCount ?? 0,
      importanceAfterWatermark: aggregate?.importanceAfterWatermark ?? 0,
      maxCreatedAt: aggregate?.maxCreatedAt ?? 0,
      topRows
    }
  }

  listByAgent(agentId: string, options: AgentMemoryListOptions = {}): AgentMemoryRow[] {
    const where: string[] = ['agent_id = ?']
    const params: Array<string | number> = [agentId]

    if (!options.includeSuperseded) {
      where.push('superseded_by IS NULL')
    }
    if (!options.includeArchived && !options.statuses?.includes('archived')) {
      where.push("lifecycle_state != 'archived'")
    }
    if (!options.statuses?.includes('conflicted')) {
      where.push("lifecycle_state != 'conflicted'")
    }
    if (options.kinds?.length) {
      where.push(`kind IN (${options.kinds.map(() => '?').join(', ')})`)
      params.push(...options.kinds)
    } else {
      // The working-memory cache row is internal; hide it from every generic listing (recall feeds,
      // consolidation, decay, management UI). Callers that need it ask for it via `kinds`.
      where.push("kind != 'working'")
    }
    if (options.statuses?.length) {
      where.push(buildCanonicalStatusFilter(options.statuses))
    }

    let sql = `SELECT * FROM agent_memory WHERE ${where.join(' AND ')} ORDER BY created_at DESC`
    if (Number.isFinite(options.limit)) {
      sql += ' LIMIT ?'
      params.push(Math.max(1, Math.floor(options.limit as number)))
    }

    return this.db.prepare(sql).all(...params) as AgentMemoryRow[]
  }

  listManagementPage(
    agentId: string,
    cursor: { createdAt: number; id: string } | null,
    limit: number
  ): AgentMemoryRow[] {
    const cappedLimit = Math.min(MEMORY_PAGE_MAX_LIMIT + 1, Math.max(1, Math.floor(limit)))
    const params: Array<string | number> = [agentId]
    if (cursor) params.push(cursor.createdAt, cursor.createdAt, cursor.id)
    params.push(cappedLimit)
    return this.db
      .prepare(buildManagementPageSelectSql(Boolean(cursor)))
      .all(...params) as AgentMemoryRow[]
  }

  listManagementVisibleByIds(agentId: string, ids: string[]): AgentMemoryRow[] {
    const uniqueIds = [...new Set(ids.filter((id) => id.length > 0))]
    if (uniqueIds.length === 0) return []
    const placeholders = uniqueIds.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory
         WHERE agent_id = ?
           AND id IN (${placeholders})
           AND superseded_by IS NULL
           AND lifecycle_state != 'conflicted'
           AND kind NOT IN ('persona', 'working')`
      )
      .all(agentId, ...uniqueIds) as AgentMemoryRow[]
  }

  // Active = the approved self-model. A draft persona also has superseded_by IS NULL, so the state
  // must be checked explicitly; legacy rows (persona_state NULL) stay active only while not
  // superseded. The superseded_by guard on legacy rows is load-bearing: a row left with a later
  // created_at by an old rollback must not resurface, so COALESCE(persona_state,'active') alone is wrong.
  getActivePersona(agentId: string): AgentMemoryRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE agent_id = ? AND kind = 'persona'
           AND scope_type = 'agent' AND scope_id IS NULL
           AND (
             persona_state = 'active'
             OR (persona_state IS NULL AND superseded_by IS NULL)
           )
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(agentId) as AgentMemoryRow | undefined
  }

  getDraftPersona(agentId: string): AgentMemoryRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE agent_id = ? AND kind = 'persona' AND persona_state = 'draft'
           AND scope_type = 'agent' AND scope_id IS NULL
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(agentId) as AgentMemoryRow | undefined
  }

  // Persona state-machine transition. superseded_by is only written when supersededBy is passed
  // (including an explicit null to clear it on re-activation); omitting it leaves the link untouched.
  setPersonaState(id: string, state: AgentMemoryPersonaState, supersededBy?: string | null): void {
    if (supersededBy === undefined) {
      this.db
        .prepare(
          'UPDATE agent_memory SET persona_state = ?, decision_revision = decision_revision + 1 WHERE id = ?'
        )
        .run(state, id)
      return
    }
    this.db
      .prepare(
        'UPDATE agent_memory SET persona_state = ?, superseded_by = ?, decision_revision = decision_revision + 1 WHERE id = ?'
      )
      .run(state, supersededBy, id)
  }

  setAnchor(id: string, anchored: boolean): void {
    this.db
      .prepare(
        'UPDATE agent_memory SET is_anchor = ?, decision_revision = decision_revision + 1 WHERE id = ?'
      )
      .run(anchored ? 1 : 0, id)
  }

  listPersonaVersions(agentId: string): AgentMemoryRow[] {
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE agent_id = ? AND kind = 'persona'
           AND scope_type = 'agent' AND scope_id IS NULL
         ORDER BY created_at DESC`
      )
      .all(agentId) as AgentMemoryRow[]
  }

  // Safe trigram queries stay entirely on the FTS index: BM25 supplies lexical ranking and a
  // second query with the exact same MATCH supplies the importance/recency candidates used by
  // downstream fusion. Every other tokenizer/query shape takes exactly one bounded LIKE path.
  search(
    agentId: string,
    query: string,
    limit: number = 20,
    options: { matchMode?: SearchMatchMode; scopeFilter?: readonly MemoryScope[] } = {}
  ): AgentMemoryRow[] {
    return this.searchWithStrategy(agentId, query, limit, options).rows
  }

  searchWithStrategy(
    agentId: string,
    query: string,
    limit: number = 20,
    options: { matchMode?: SearchMatchMode; scopeFilter?: readonly MemoryScope[] } = {}
  ): AgentMemorySearchResult {
    this.recoverFtsIfNeeded()
    this.perfObserver?.increment('repositoryCalls')
    const finish = (result: AgentMemorySearchResult): AgentMemorySearchResult => {
      this.perfObserver?.increment('materializedRows', result.rows.length)
      return result
    }
    const normalized = query.trim()
    if (!normalized) {
      return finish({ rows: [], strategy: this.ftsReady ? 'fts-only' : 'like-fallback' })
    }
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), MEMORY_RETRIEVAL_MAX_CANDIDATES)
    const matchMode = options.matchMode ?? 'all'
    const scopeFilter = normalizeMemoryScopeFilter(options.scopeFilter)
    if (!scopeFilter.length) {
      return finish({ rows: [], strategy: this.ftsReady ? 'fts-only' : 'like-fallback' })
    }
    const terms = tokenizeSearchQuery(normalized)
    if (!terms.length) {
      return finish({ rows: [], strategy: this.ftsReady ? 'fts-only' : 'like-fallback' })
    }
    const capability = this.ftsCapability
    const safeTrigramQuery =
      this.ftsReady &&
      capability?.available === true &&
      capability.tokenizer === 'trigram' &&
      terms.every((term) => unicodeCodePointLength(term) >= 3)
    if (!safeTrigramQuery) {
      return finish({
        rows: this.searchLike(agentId, terms, cappedLimit, matchMode, scopeFilter),
        strategy: 'like-fallback'
      })
    }

    try {
      const match = this.buildFtsMatch(agentId, terms, matchMode)
      return finish({
        rows: this.searchFts(agentId, match, cappedLimit, scopeFilter),
        strategy: 'fts-only'
      })
    } catch (error) {
      if (!isTransientFtsError(error)) {
        this.ftsReady = false
        this.markFtsDirty()
      }
      return finish({
        rows: this.searchLike(agentId, terms, cappedLimit, matchMode, scopeFilter),
        strategy: 'like-fallback'
      })
    }
  }

  private buildFtsMatch(agentId: string, terms: string[], matchMode: SearchMatchMode): string {
    // Quote each token so user text cannot inject FTS5 operators; the caller chooses whether
    // all terms or any term must match.
    const operator = matchMode === 'any' ? ' OR ' : ' AND '
    const contentMatch = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(operator)
    // Keep the selective content postings first. FTS5 evaluates the expression left-to-right for
    // this shape; leading with the per-agent scope would walk every row for a large single agent.
    return `content : (${contentMatch}) AND agent_id : "${agentFtsScope(agentId)}"`
  }

  private searchFts(
    agentId: string,
    match: string,
    limit: number,
    scopeFilter: readonly MemoryScope[] = AGENT_MEMORY_AGENT_SCOPE_FILTER
  ): AgentMemoryRow[] {
    const lexicalScanLimit = Math.min(MEMORY_RETRIEVAL_MAX_CANDIDATES, Math.max(1, limit))
    const importanceCandidateLimit = Math.min(800, Math.max(64, limit * 8))
    const scopePredicate = buildMemoryScopePredicateSql('am', scopeFilter)
    const importanceCandidates = buildScopedImportanceCandidatesSql(
      agentId,
      scopeFilter,
      importanceCandidateLimit
    )
    return this.db
      .prepare(
        `WITH lexical_hits AS MATERIALIZED (
           SELECT am.rowid AS memory_rowid,
                  am.id,
                  am.importance,
                  am.created_at,
                  bm25(agent_memory_fts, 1.0, 0.0) AS lexical_score
           FROM agent_memory_fts
           CROSS JOIN agent_memory am NOT INDEXED
           WHERE agent_memory_fts MATCH ?
             AND am.rowid = agent_memory_fts.rowid
             AND am.agent_id = ?
             AND ${buildRecallablePredicate('am')}
             AND ${scopePredicate.sql}
           ORDER BY lexical_score ASC,
                    am.importance DESC,
                    am.created_at DESC,
                    am.id ASC
           LIMIT ?
         ), lexical AS MATERIALIZED (
           SELECT memory_rowid,
                  id,
                  importance,
                  created_at,
                  lexical_score
           FROM lexical_hits
           ORDER BY lexical_score ASC,
                    importance DESC,
                    created_at DESC,
                    id ASC
           LIMIT ?
         ), importance_candidates AS MATERIALIZED (
           ${importanceCandidates.sql}
         ), importance AS MATERIALIZED (
           SELECT candidate.memory_rowid,
                  candidate.id,
                  candidate.importance,
                  candidate.created_at
           FROM agent_memory_fts f
           CROSS JOIN importance_candidates candidate
           WHERE agent_memory_fts MATCH ?
             AND f.rowid = candidate.memory_rowid
           ORDER BY candidate.importance DESC,
                    candidate.created_at DESC,
                    candidate.id ASC
           LIMIT ?
         ), combined AS (
           SELECT memory_rowid, 0 AS source_order, lexical_score, importance, created_at, id
           FROM lexical
           UNION ALL
           SELECT importance.memory_rowid, 1, NULL, importance.importance,
                  importance.created_at, importance.id
           FROM importance
           WHERE NOT EXISTS (
             SELECT 1 FROM lexical WHERE lexical.memory_rowid = importance.memory_rowid
           )
         )
         SELECT am.*
         FROM combined
         JOIN agent_memory am ON am.rowid = combined.memory_rowid
         ORDER BY combined.source_order ASC,
                  combined.lexical_score ASC,
                  combined.importance DESC,
                  combined.created_at DESC,
                  combined.id ASC`
      )
      .all(
        match,
        agentId,
        ...scopePredicate.params,
        lexicalScanLimit,
        limit,
        ...importanceCandidates.params,
        match,
        limit
      ) as AgentMemoryRow[]
  }

  private searchLike(
    agentId: string,
    terms: string[],
    limit: number,
    matchMode: SearchMatchMode,
    scopeFilter: readonly MemoryScope[] = AGENT_MEMORY_AGENT_SCOPE_FILTER
  ): AgentMemoryRow[] {
    if (!terms.length) return []
    const clauses = terms.map(() => "am.content LIKE ? ESCAPE '\\'")
    const params = terms.map((term) => `%${escapeLikePattern(term)}%`)
    const operator = matchMode === 'any' ? ' OR ' : ' AND '
    const scopePredicate = buildMemoryScopePredicateSql('am', scopeFilter)
    return this.db
      .prepare(
        `SELECT am.* FROM agent_memory am
         WHERE am.agent_id = ?
           AND ${buildRecallablePredicate('am')}
           AND ${scopePredicate.sql}
           AND (${clauses.join(operator)})
         ORDER BY am.importance DESC, am.created_at DESC
         LIMIT ?`
      )
      .all(agentId, ...scopePredicate.params, ...params, limit) as AgentMemoryRow[]
  }

  listPendingEmbedding(limit: number = 50, agentId?: string): AgentMemoryRow[] {
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 500)
    if (agentId) {
      return this.db
        .prepare(buildPendingEmbeddingSelectSql(true))
        .all(agentId, cappedLimit) as AgentMemoryRow[]
    }
    return this.db
      .prepare(buildPendingEmbeddingSelectSql(false))
      .all(cappedLimit) as AgentMemoryRow[]
  }

  countPendingEmbedding(agentId?: string): number {
    const row = agentId
      ? (this.db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM agent_memory INDEXED BY idx_agent_memory_embedding_pending_agent_v2
             WHERE lifecycle_state = 'active'
               AND embedding_state = 'pending'
               AND superseded_by IS NULL
               AND kind NOT IN ('persona', 'working')
               AND agent_id = ?`
          )
          .get(agentId) as { count: number })
      : (this.db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM agent_memory INDEXED BY idx_agent_memory_embedding_pending_global_v2
             WHERE lifecycle_state = 'active'
               AND embedding_state = 'pending'
               AND superseded_by IS NULL
               AND kind NOT IN ('persona', 'working')`
          )
          .get() as { count: number })
    return row.count
  }

  restoreArchivedMemory(input: MemoryTransitionTarget): boolean {
    const before = this.getFtsMirrorRow(input.id)
    if (
      !before ||
      before.agent_id !== input.agentId ||
      before.decision_revision !== input.expectedRevision ||
      before.lifecycle_state !== 'archived' ||
      before.superseded_by !== null ||
      before.conflict_state !== null ||
      before.conflict_with !== null ||
      before.kind === 'persona' ||
      before.kind === 'working'
    ) {
      return false
    }
    if (
      this.hasTombstoneForClaim({
        agentId: input.agentId,
        kind: before.kind,
        content: before.content,
        provenanceKey: before.provenance_key,
        scope: memoryScopeFromRow(before)
      })
    ) {
      return false
    }
    assertValidMemoryTransition(
      transitionSnapshot(before),
      transitionSnapshot(before, {
        lifecycleState: 'active',
        embeddingState: 'pending',
        embeddingRefsState: 'none'
      }),
      'restore_archived'
    )
    const result = this.runRecallMutation({
      mutate: () =>
        this.db
          .prepare(
            `UPDATE agent_memory AS memory
             SET lifecycle_state = 'active', embedding_state = 'pending',
                 status = 'pending_embedding',
                 embedding_id = NULL, embedding_dim = NULL, embedding_model = NULL,
                 decision_revision = decision_revision + 1
             WHERE memory.agent_id = ? AND memory.id = ? AND memory.decision_revision = ?
               AND memory.lifecycle_state = 'archived'
               AND memory.superseded_by IS NULL
               AND memory.conflict_state IS NULL
               AND memory.conflict_with IS NULL
               AND memory.kind NOT IN ('persona', 'working')
               AND NOT EXISTS (
                 SELECT 1 FROM agent_memory challenger
                 WHERE challenger.agent_id = memory.agent_id
                   AND challenger.lifecycle_state = 'conflicted'
                   AND challenger.superseded_by IS NULL
                   AND challenger.conflict_with = memory.id
                   AND challenger.scope_type = memory.scope_type
                   AND challenger.scope_id IS memory.scope_id
               )`
          )
          .run(input.agentId, input.id, input.expectedRevision),
      didMutate: (mutationResult) => mutationResult.changes === 1,
      maintainFts: () => this.replaceFtsMirrorRow(before, input.id)
    })
    return result.changes === 1
  }

  reviveSupersededMemory(input: ReviveSupersededTransition): boolean {
    if (!input.retiredHead) return this.reviveSupersededRow(input)
    if (input.retiredHead.id === input.id) return false
    const rejected = new Error('supersession transition rejected')
    try {
      this.db.transaction(() => {
        if (
          !this.markSupersededIfRevision(
            input.agentId,
            input.retiredHead!.id,
            input.retiredHead!.expectedRevision,
            input.id
          )
        ) {
          throw rejected
        }
        if (!this.reviveSupersededRow(input)) throw rejected
      })()
      return true
    } catch (error) {
      if (error === rejected) return false
      throw error
    }
  }

  private reviveSupersededRow(input: MemoryTransitionTarget): boolean {
    const before = this.getFtsMirrorRow(input.id)
    if (
      !before ||
      before.agent_id !== input.agentId ||
      before.decision_revision !== input.expectedRevision ||
      before.lifecycle_state !== 'active' ||
      before.superseded_by === null ||
      before.conflict_state !== null ||
      before.conflict_with !== null ||
      before.kind === 'persona' ||
      before.kind === 'working'
    ) {
      return false
    }
    if (
      this.hasTombstoneForClaim({
        agentId: input.agentId,
        kind: before.kind,
        content: before.content,
        provenanceKey: before.provenance_key,
        scope: memoryScopeFromRow(before)
      })
    ) {
      return false
    }
    assertValidMemoryTransition(
      transitionSnapshot(before),
      transitionSnapshot(before, {
        embeddingState: 'pending',
        embeddingRefsState: 'none',
        supersededBy: null
      }),
      'revive_superseded'
    )
    const result = this.runRecallMutation({
      mutate: () =>
        this.db
          .prepare(
            `UPDATE agent_memory
             SET superseded_by = NULL,
                 embedding_state = 'pending', status = 'pending_embedding',
                 embedding_id = NULL, embedding_dim = NULL, embedding_model = NULL,
                 decision_revision = decision_revision + 1
             WHERE agent_id = ? AND id = ? AND decision_revision = ?
               AND lifecycle_state = 'active'
               AND superseded_by IS NOT NULL
               AND conflict_state IS NULL
               AND conflict_with IS NULL
               AND kind NOT IN ('persona', 'working')`
          )
          .run(input.agentId, input.id, input.expectedRevision),
      didMutate: (mutationResult) => mutationResult.changes === 1,
      maintainFts: () => this.replaceFtsMirrorRow(before, input.id)
    })
    return result.changes === 1
  }

  activateResolvedChallenger(input: ResolveChallengerTransition): boolean {
    const before = this.getFtsMirrorRow(input.id)
    if (
      !before ||
      before.agent_id !== input.agentId ||
      before.decision_revision !== input.expectedRevision ||
      before.lifecycle_state !== 'conflicted' ||
      before.conflict_with !== input.targetId ||
      before.superseded_by !== null ||
      before.conflict_state !== null ||
      before.kind === 'persona' ||
      before.kind === 'working'
    ) {
      return false
    }
    if (
      this.hasTombstoneForClaim({
        agentId: input.agentId,
        kind: before.kind,
        content: input.content ?? before.content,
        provenanceKey:
          input.content === undefined ? before.provenance_key : (input.provenanceKey ?? null),
        scope: memoryScopeFromRow(before)
      })
    ) {
      return false
    }
    assertValidMemoryTransition(
      transitionSnapshot(before),
      transitionSnapshot(before, {
        lifecycleState: 'active',
        embeddingState: 'pending',
        embeddingRefsState: 'none',
        conflictWith: null
      }),
      'activate_challenger'
    )
    const updateContent = input.content !== undefined
    const updateCategory = updateContent && Object.prototype.hasOwnProperty.call(input, 'category')
    const temporal = updateContent
      ? input.temporal
        ? normalizeMemoryTemporalMetadata(input.temporal)
        : temporalMetadataFromRow(before)
      : null
    const contentSql = updateContent
      ? `, content = ?, provenance_key = ?${
          updateCategory ? ', category = ?' : ''
        }, last_accessed = ?,
           temporal_kind = ?, valid_from = ?, valid_until = ?,
           temporal_confidence = ?, temporal_precision = ?, temporal_timezone = ?`
      : ''
    const params: unknown[] = []
    if (updateContent && temporal) {
      params.push(input.content, input.provenanceKey)
      if (updateCategory) params.push(input.category ?? null)
      params.push(
        input.at,
        temporal.temporalKind,
        temporal.validFrom,
        temporal.validUntil,
        temporal.temporalConfidence,
        temporal.temporalPrecision,
        temporal.temporalTimeZone
      )
    }
    params.push(input.agentId, input.id, input.expectedRevision, input.targetId)
    const result = this.runRecallMutation({
      mutate: () =>
        this.db
          .prepare(
            `UPDATE agent_memory AS challenger
             SET lifecycle_state = 'active', embedding_state = 'pending',
                 status = 'pending_embedding', conflict_with = NULL,
                 embedding_id = NULL, embedding_dim = NULL, embedding_model = NULL,
                 decision_revision = decision_revision + 1${contentSql}
             WHERE challenger.agent_id = ? AND challenger.id = ?
               AND challenger.decision_revision = ?
               AND challenger.lifecycle_state = 'conflicted'
               AND challenger.superseded_by IS NULL
               AND challenger.conflict_with = ?
               AND challenger.kind NOT IN ('persona', 'working')
               AND EXISTS (
                 SELECT 1 FROM agent_memory target
                 WHERE target.agent_id = challenger.agent_id
                   AND target.id = challenger.conflict_with
                   AND target.scope_type = challenger.scope_type
                   AND target.scope_id IS challenger.scope_id
                   AND target.lifecycle_state = 'active'
                   AND target.conflict_state = 'challenged'
                   AND target.superseded_by IS NULL
               )`
          )
          .run(...params),
      didMutate: (mutationResult) => mutationResult.changes === 1,
      maintainFts: () => this.replaceFtsMirrorRow(before, input.id)
    })
    return result.changes === 1
  }

  archiveResolvedChallenger(input: ArchiveChallengerTransition): boolean {
    const before = this.getFtsMirrorRow(input.id)
    if (
      !before ||
      before.agent_id !== input.agentId ||
      before.decision_revision !== input.expectedRevision ||
      before.lifecycle_state !== 'conflicted' ||
      before.conflict_with !== input.targetId ||
      before.superseded_by !== null ||
      before.conflict_state !== null ||
      before.kind === 'persona' ||
      before.kind === 'working'
    ) {
      return false
    }
    assertValidMemoryTransition(
      transitionSnapshot(before),
      transitionSnapshot(before, {
        lifecycleState: 'archived',
        supersededBy: input.winnerId,
        conflictWith: null
      }),
      'archive_challenger'
    )
    const result = this.db
      .prepare(
        `UPDATE agent_memory AS challenger
         SET lifecycle_state = 'archived', status = 'archived',
             conflict_with = NULL, superseded_by = ?,
             decision_revision = decision_revision + 1
         WHERE challenger.agent_id = ? AND challenger.id = ?
           AND challenger.decision_revision = ?
           AND challenger.lifecycle_state = 'conflicted'
           AND challenger.superseded_by IS NULL
           AND challenger.conflict_with = ?
           AND challenger.kind NOT IN ('persona', 'working')
           AND EXISTS (
             SELECT 1 FROM agent_memory target
             WHERE target.agent_id = challenger.agent_id
               AND target.id = challenger.conflict_with
               AND target.scope_type = challenger.scope_type
               AND target.scope_id IS challenger.scope_id
               AND target.lifecycle_state = 'active'
               AND target.conflict_state = 'challenged'
               AND target.superseded_by IS NULL
           )
           AND EXISTS (
             SELECT 1 FROM agent_memory winner
             WHERE winner.agent_id = challenger.agent_id
               AND winner.id = ?
               AND winner.id != challenger.id
               AND winner.scope_type = challenger.scope_type
               AND winner.scope_id IS challenger.scope_id
           )`
      )
      .run(
        input.winnerId,
        input.agentId,
        input.id,
        input.expectedRevision,
        input.targetId,
        input.winnerId
      )
    return result.changes === 1
  }

  archiveResolvedConflictTarget(input: ArchiveConflictTargetTransition): boolean {
    const before = this.getFtsMirrorRow(input.id)
    if (
      !before ||
      before.agent_id !== input.agentId ||
      before.decision_revision !== input.expectedRevision ||
      before.lifecycle_state !== 'active' ||
      before.conflict_state !== 'challenged' ||
      before.conflict_with !== null ||
      before.superseded_by !== null ||
      before.kind === 'persona' ||
      before.kind === 'working'
    ) {
      return false
    }
    assertValidMemoryTransition(
      transitionSnapshot(before),
      transitionSnapshot(before, {
        lifecycleState: 'archived',
        supersededBy: input.challengerId,
        conflictState: null
      }),
      'archive_conflict_target'
    )
    const result = this.runRecallMutation({
      mutate: () =>
        this.db
          .prepare(
            `UPDATE agent_memory AS target
             SET lifecycle_state = 'archived', status = 'archived',
                 conflict_state = NULL, superseded_by = ?,
                 decision_revision = decision_revision + 1
             WHERE target.agent_id = ? AND target.id = ?
               AND target.decision_revision = ?
               AND target.lifecycle_state = 'active'
               AND target.conflict_state = 'challenged'
               AND target.superseded_by IS NULL
               AND EXISTS (
                 SELECT 1 FROM agent_memory challenger
                 WHERE challenger.agent_id = target.agent_id
                   AND challenger.id = ?
                   AND challenger.scope_type = target.scope_type
                   AND challenger.scope_id IS target.scope_id
                   AND challenger.lifecycle_state = 'active'
                   AND challenger.superseded_by IS NULL
                   AND challenger.conflict_state IS NULL
                   AND challenger.conflict_with IS NULL
               )`
          )
          .run(
            input.challengerId,
            input.agentId,
            input.id,
            input.expectedRevision,
            input.challengerId
          ),
      didMutate: (mutationResult) => mutationResult.changes === 1,
      maintainFts: () => this.deleteFtsMirrorRow(before)
    })
    return result.changes === 1
  }

  markPendingEmbeddingsReady(
    agentId: string,
    updates: ReadonlyArray<{
      id: string
      expectedRevision: number
      embeddingId: string
      embeddingDim: number
      embeddingModel: string
    }>
  ): string[] {
    if (!updates.length) return []
    const { valuesSql, params } = buildRevisionAwareEmbeddingValues(updates, (update) => [
      update.embeddingId,
      update.embeddingDim,
      update.embeddingModel
    ])
    const rows = this.db
      .prepare(
        `WITH updates(id, expected_revision, embedding_id, embedding_dim, embedding_model) AS (
           VALUES ${valuesSql}
         )
         UPDATE agent_memory
         SET embedding_state = 'ready', status = 'embedded',
             embedding_id = (SELECT embedding_id FROM updates WHERE updates.id = agent_memory.id),
             embedding_dim = (SELECT embedding_dim FROM updates WHERE updates.id = agent_memory.id),
             embedding_model = (SELECT embedding_model FROM updates WHERE updates.id = agent_memory.id)
         WHERE agent_id = ?
           AND lifecycle_state = 'active'
           AND embedding_state = 'pending'
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')
           AND EXISTS (
             SELECT 1
             FROM updates
             WHERE updates.id = agent_memory.id
               AND updates.expected_revision = agent_memory.decision_revision
           )
         RETURNING id`
      )
      .all(...params, agentId) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  markPendingEmbeddingsError(
    agentId: string,
    updates: ReadonlyArray<{ id: string; expectedRevision: number }>,
    status: Extract<AgentMemoryStatus, 'error' | 'fts_only'> = 'error'
  ): string[] {
    if (!updates.length) return []
    const { valuesSql, params } = buildRevisionAwareEmbeddingValues(updates)
    const rows = this.db
      .prepare(
        `WITH updates(id, expected_revision) AS (
           VALUES ${valuesSql}
         )
         UPDATE agent_memory
         SET embedding_state = ?, status = ?,
             embedding_id = NULL,
             embedding_dim = NULL,
             embedding_model = NULL
         WHERE agent_id = ?
           AND lifecycle_state = 'active'
           AND embedding_state = 'pending'
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')
           AND EXISTS (
             SELECT 1
             FROM updates
             WHERE updates.id = agent_memory.id
               AND updates.expected_revision = agent_memory.decision_revision
           )
         RETURNING id`
      )
      .all(...params, status, status, agentId) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  // Resets the embedding state of the agent's non-superseded rows in `statuses` back to
  // pending_embedding in a single statement (no per-row round trips), so a reindex/backfill can
  // re-queue a whole corpus without blocking. persona and working rows are excluded: the self-model
  // is injected verbatim and the working blob is an internal open-session cache, so neither is
  // vector-recalled and both must stay out of the vector store. Requeuing them would strand the row
  // in pending_embedding forever, since listPendingEmbedding never returns those kinds. Status
  // changes do not affect recallability or content, so derived FTS maintenance is unnecessary.
  // Returns the number of rows changed.
  requeueForEmbedding(
    agentId: string,
    states: AgentMemoryEmbeddingState[],
    limit?: number,
    afterId?: string | null
  ): number {
    if (!states.length) return 0
    const placeholders = states.map(() => '?').join(', ')
    if (limit !== undefined) {
      const cappedLimit = Math.max(0, Math.floor(limit))
      if (cappedLimit === 0) return 0
      const afterSql = afterId ? 'AND id > ?' : ''
      const params: unknown[] = [agentId, ...states]
      if (afterId) params.push(afterId)
      params.push(cappedLimit)
      const result = this.db
        .prepare(
          `UPDATE agent_memory
           SET embedding_state = 'pending', status = 'pending_embedding',
               embedding_id = NULL,
               embedding_dim = NULL,
               embedding_model = NULL
           WHERE id IN (
             SELECT id
             FROM agent_memory
             WHERE agent_id = ?
               AND superseded_by IS NULL
               AND kind NOT IN ('persona', 'working')
               AND lifecycle_state = 'active'
               AND embedding_state IN (${placeholders})
               ${afterSql}
             ORDER BY id ASC
             LIMIT ?
           )`
        )
        .run(...params)
      return result.changes
    }
    const result = this.db
      .prepare(
        `UPDATE agent_memory
         SET embedding_state = 'pending', status = 'pending_embedding',
             embedding_id = NULL,
             embedding_dim = NULL,
             embedding_model = NULL
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')
           AND lifecycle_state = 'active'
           AND embedding_state IN (${placeholders})`
      )
      .run(agentId, ...states)
    return result.changes
  }

  listEmbeddingStateIds(
    agentId: string,
    states: AgentMemoryEmbeddingState[],
    limit: number,
    afterId?: string | null
  ): string[] {
    if (!states.length) return []
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    const placeholders = states.map(() => '?').join(', ')
    const afterSql = afterId ? 'AND id > ?' : ''
    const params: unknown[] = [agentId, ...states]
    if (afterId) params.push(afterId)
    params.push(cappedLimit)
    const rows = this.db
      .prepare(
        `SELECT id
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')
           AND lifecycle_state = 'active'
           AND embedding_state IN (${placeholders})
           ${afterSql}
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(...params) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  listCurrentEmbeddedIds(
    agentId: string,
    embeddingDim: number,
    embeddingModel: string,
    afterId: string | null,
    limit: number
  ): string[] {
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    const afterSql = afterId === null ? '' : 'AND id > ?'
    const params: Array<string | number> = [agentId, embeddingDim, embeddingModel]
    if (afterId !== null) params.push(afterId)
    params.push(cappedLimit)
    const rows = this.db
      .prepare(
        `SELECT id
         FROM agent_memory
         WHERE agent_id = ?
           AND lifecycle_state = 'active'
           AND embedding_state = 'ready'
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')
           AND embedding_dim = ?
           AND embedding_model = ?
           ${afterSql}
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(...params) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  markSupersededIfRevision(
    agentId: string,
    id: string,
    expectedRevision: number,
    supersededBy: string
  ): boolean {
    const before = this.getFtsMirrorRow(id)
    const result = this.runRecallMutation({
      mutate: () =>
        this.db
          .prepare(
            `UPDATE agent_memory AS memory
         SET superseded_by = ?, decision_revision = decision_revision + 1
         WHERE memory.id = ? AND memory.agent_id = ? AND memory.decision_revision = ?
           AND memory.superseded_by IS NULL
           AND memory.conflict_state IS NULL AND memory.conflict_with IS NULL
           AND memory.kind NOT IN ('persona', 'working')
           AND memory.lifecycle_state = 'active'
           AND EXISTS (
             SELECT 1 FROM agent_memory successor
             WHERE successor.id = ?
               AND successor.id != memory.id
               AND successor.agent_id = memory.agent_id
               AND successor.scope_type = memory.scope_type
               AND successor.scope_id IS memory.scope_id
           )`
          )
          .run(supersededBy, id, agentId, expectedRevision, supersededBy),
      didMutate: (mutationResult) => mutationResult.changes === 1,
      maintainFts: () => this.replaceFtsMirrorRow(before, id)
    })
    return result.changes === 1
  }

  recordAccess(id: string, accessedAt: number = Date.now()): void {
    this.db
      .prepare(
        `UPDATE agent_memory AS memory
         SET last_accessed = ?, access_count = access_count + 1
         WHERE memory.id = ?
           AND ${AGENT_MEMORY_CLEAR_BOOKKEEPING_FENCE_SQL}`
      )
      .run(accessedAt, id)
  }

  recordAccessBatch(ids: string[], accessedAt: number = Date.now()): void {
    const uniqueIds = [...new Set(ids.filter((id) => id.trim()))]
    if (!uniqueIds.length) return
    const placeholders = uniqueIds.map(() => '?').join(', ')
    this.db
      .prepare(
        `UPDATE agent_memory AS memory
         SET last_accessed = ?, access_count = access_count + 1
         WHERE memory.id IN (${placeholders})
           AND ${AGENT_MEMORY_CLEAR_BOOKKEEPING_FENCE_SQL}`
      )
      .run(accessedAt, ...uniqueIds)
  }

  // Omitting `consolidatedAt` (COALESCE keeps the prior value) leaves the LLM consolidation marker
  // untouched for callers that only refresh decay.
  updateDecayScore(
    id: string,
    decayScore: number | null,
    consolidatedAt: number | null = null
  ): void {
    this.db
      .prepare(
        `UPDATE agent_memory AS memory
         SET decay_score = ?, last_consolidated_at = COALESCE(?, last_consolidated_at)
         WHERE memory.id = ?
           AND ${AGENT_MEMORY_CLEAR_BOOKKEEPING_FENCE_SQL}`
      )
      .run(decayScore, consolidatedAt, id)
  }

  updateInternalContent(input: InternalContentTransition): boolean {
    const before = this.getFtsMirrorRow(input.id)
    if (
      !before ||
      before.agent_id !== input.agentId ||
      before.decision_revision !== input.expectedRevision ||
      before.lifecycle_state !== 'active' ||
      before.superseded_by !== null ||
      before.conflict_state !== null ||
      before.conflict_with !== null ||
      (before.kind !== 'persona' && before.kind !== 'working')
    ) {
      return false
    }
    assertValidMemoryTransition(
      transitionSnapshot(before),
      transitionSnapshot(before, {
        embeddingState: 'not_applicable',
        embeddingRefsState: 'none'
      }),
      'internal_content'
    )
    const result = this.db
      .prepare(
        `UPDATE agent_memory
         SET content = ?, provenance_key = ?, last_accessed = ?,
             lifecycle_state = 'active', embedding_state = 'not_applicable', status = 'fts_only',
             embedding_id = NULL, embedding_dim = NULL, embedding_model = NULL,
             decision_revision = decision_revision + 1
         WHERE agent_id = ? AND id = ? AND decision_revision = ?
           AND lifecycle_state = 'active'
           AND superseded_by IS NULL
           AND conflict_state IS NULL
           AND conflict_with IS NULL
           AND kind IN ('persona', 'working')`
      )
      .run(
        input.content,
        input.provenanceKey,
        input.at,
        input.agentId,
        input.id,
        input.expectedRevision
      )
    return result.changes === 1
  }

  updateUserContentAndInvalidateEmbedding(
    input: UserContentTransition
  ): MemoryClaimContentUpdateResult {
    return this.db.transaction((): MemoryClaimContentUpdateResult => {
      const before = this.getFtsMirrorRow(input.id)
      if (
        !before ||
        before.agent_id !== input.agentId ||
        before.decision_revision !== input.expectedRevision ||
        before.lifecycle_state !== 'active' ||
        before.superseded_by !== null ||
        before.conflict_state !== null ||
        before.conflict_with !== null ||
        before.kind === 'persona' ||
        before.kind === 'working'
      ) {
        return { action: 'suppressed', reason: 'concurrent-update' }
      }
      if (
        this.hasTombstoneForClaim({
          agentId: input.agentId,
          kind: before.kind,
          content: input.content,
          provenanceKey: input.provenanceKey,
          scope: memoryScopeFromRow(before)
        })
      ) {
        return { action: 'suppressed', reason: 'forgotten' }
      }
      assertValidMemoryTransition(
        transitionSnapshot(before),
        transitionSnapshot(before, {
          embeddingState: 'pending',
          embeddingRefsState: 'none'
        }),
        'user_content'
      )
      const categorySql = input.category === undefined ? '' : ', category = ?'
      const importanceSql = input.importance === undefined ? '' : ', importance = ?'
      const temporal =
        input.temporal === undefined ? null : normalizeMemoryTemporalMetadata(input.temporal)
      const temporalSql =
        temporal === null
          ? ''
          : `, temporal_kind = ?, valid_from = ?, valid_until = ?,
               temporal_confidence = ?, temporal_precision = ?, temporal_timezone = ?`
      const params: unknown[] = [input.content, input.provenanceKey, input.at]
      if (input.category !== undefined) params.push(input.category)
      if (input.importance !== undefined) params.push(input.importance)
      if (temporal !== null) {
        params.push(
          temporal.temporalKind,
          temporal.validFrom,
          temporal.validUntil,
          temporal.temporalConfidence,
          temporal.temporalPrecision,
          temporal.temporalTimeZone
        )
      }
      params.push(input.id, input.agentId, input.expectedRevision)
      const result = this.runRecallMutation({
        mutate: () =>
          this.db
            .prepare(
              `UPDATE agent_memory
               SET content = ?, provenance_key = ?, last_accessed = ?${categorySql}${importanceSql}${temporalSql},
                   embedding_state = 'pending', status = 'pending_embedding',
                   embedding_id = NULL, embedding_dim = NULL, embedding_model = NULL,
                   decision_revision = decision_revision + 1
               WHERE id = ? AND agent_id = ? AND decision_revision = ?
                 AND lifecycle_state = 'active'
                 AND superseded_by IS NULL
                 AND conflict_state IS NULL
                 AND conflict_with IS NULL
                 AND kind NOT IN ('persona', 'working')`
            )
            .run(...params),
        didMutate: (mutationResult) => mutationResult.changes === 1,
        maintainFts: () => this.replaceFtsMirrorRow(before, input.id)
      })
      return result.changes === 1
        ? { action: 'updated' }
        : { action: 'suppressed', reason: 'concurrent-update' }
    })()
  }

  updateUserMetadataIfRevision(input: UserMetadataTransition): boolean {
    const sets: string[] = []
    const params: unknown[] = []
    if (Object.prototype.hasOwnProperty.call(input, 'category')) {
      sets.push('category = ?')
      params.push(input.category ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(input, 'importance')) {
      sets.push('importance = ?')
      params.push(input.importance)
    }
    if (Object.prototype.hasOwnProperty.call(input, 'lastAccessedAt')) {
      sets.push('last_accessed = ?')
      params.push(input.lastAccessedAt)
    }
    if (input.temporal !== undefined) {
      const temporal = normalizeMemoryTemporalMetadata(input.temporal)
      sets.push(
        'temporal_kind = ?',
        'valid_from = ?',
        'valid_until = ?',
        'temporal_confidence = ?',
        'temporal_precision = ?',
        'temporal_timezone = ?'
      )
      params.push(
        temporal.temporalKind,
        temporal.validFrom,
        temporal.validUntil,
        temporal.temporalConfidence,
        temporal.temporalPrecision,
        temporal.temporalTimeZone
      )
    }
    if (!sets.length) return false
    sets.push('decision_revision = decision_revision + 1')
    params.push(input.agentId, input.id, input.expectedRevision)
    const result = this.db
      .prepare(
        `UPDATE agent_memory
         SET ${sets.join(', ')}
         WHERE agent_id = ? AND id = ? AND decision_revision = ?
           AND lifecycle_state = 'active'
           AND superseded_by IS NULL
           AND conflict_state IS NULL
           AND conflict_with IS NULL
           AND kind NOT IN ('persona', 'working')`
      )
      .run(...params)
    return result.changes === 1
  }

  // Confidence only ever rises: NULL seeds the first value, otherwise keep the larger.
  setConfidence(id: string, confidence: number): void {
    this.db
      .prepare(
        `UPDATE agent_memory AS memory
         SET confidence = CASE WHEN confidence IS NULL THEN ? ELSE max(confidence, ?) END
         WHERE memory.id = ?
           AND ${AGENT_MEMORY_CLEAR_BOOKKEEPING_FENCE_SQL}`
      )
      .run(confidence, confidence, id)
  }

  markConflictIfRevision(
    agentId: string,
    id: string,
    expectedRevision: number,
    state: AgentMemoryConflictState
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE agent_memory
         SET conflict_state = ?, decision_revision = decision_revision + 1
         WHERE id = ? AND agent_id = ? AND decision_revision = ?
           AND superseded_by IS NULL AND conflict_state IS NULL
           AND lifecycle_state = 'active'`
      )
      .run(state, id, agentId, expectedRevision)
    return result.changes === 1
  }

  setLastConsolidatedAt(id: string, at: number = Date.now()): void {
    this.db
      .prepare(
        `UPDATE agent_memory AS memory
         SET last_consolidated_at = ?
         WHERE memory.id = ?
           AND ${AGENT_MEMORY_CLEAR_BOOKKEEPING_FENCE_SQL}`
      )
      .run(at, id)
  }

  // Most recent row-level LLM consolidation timestamp across the agent's rows.
  getLastConsolidatedAt(agentId: string): number | null {
    const row = this.db
      .prepare(
        `SELECT MAX(last_consolidated_at) AS at FROM agent_memory
         WHERE agent_id = ? AND last_consolidated_at IS NOT NULL`
      )
      .get(agentId) as { at: number | null } | undefined
    return row?.at ?? null
  }

  getCurrentEmbeddingDimension(agentId: string, fingerprint: string): number | null {
    const row = this.db
      .prepare(
        `SELECT embedding_dim AS dim
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND lifecycle_state = 'active'
           AND embedding_state = 'ready'
           AND kind NOT IN ('persona', 'working')
           AND embedding_model = ?
           AND embedding_dim IS NOT NULL
           AND embedding_dim > 0
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`
      )
      .get(agentId, fingerprint) as { dim: number | null } | undefined
    return row?.dim ?? null
  }

  getHealthStats(agentId: string): AgentMemoryHealthStats {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS totalRows,
           ${buildCountCaseAggregates('kind', 'kind', AGENT_MEMORY_HEALTH_KIND_KEYS)},
           ${buildCountCaseAggregates('category', 'category', AGENT_MEMORY_CATEGORIES)},
           SUM(
             CASE
               WHEN category IS NULL OR category NOT IN (
                 ${AGENT_MEMORY_CATEGORIES.map(sqlLiteral).join(',\n                 ')}
               ) THEN 1
               ELSE 0
             END
           ) AS categoryUncategorized,
           ${buildCountCaseAggregates(buildLegacyStatusProjectionSql(), 'status', AGENT_MEMORY_HEALTH_STATUS_KEYS)},
           SUM(CASE WHEN access_count = 0 THEN 1 ELSE 0 END) AS neverAccessed,
           AVG(importance) AS importanceAvg,
           AVG(confidence) AS confidenceAvg,
           SUM(CASE WHEN lifecycle_state = 'conflicted' THEN 1 ELSE 0 END) AS conflicted,
           SUM(
             CASE WHEN conflict_state = 'challenged' AND superseded_by IS NULL THEN 1 ELSE 0 END
           ) AS challenged
         FROM agent_memory
         WHERE agent_id = ?`
      )
      .get(agentId) as Record<string, unknown> | undefined
    const totalRows = readAggregateNumber(row?.totalRows)

    return {
      totalRows,
      byKind: readAggregateRecord(row, 'kind', AGENT_MEMORY_HEALTH_KIND_KEYS),
      byCategory: {
        ...readAggregateRecord(row, 'category', AGENT_MEMORY_CATEGORIES),
        uncategorized: readAggregateNumber(row?.categoryUncategorized)
      },
      byStatus: readAggregateRecord(row, 'status', AGENT_MEMORY_HEALTH_STATUS_KEYS),
      neverAccessed: readAggregateNumber(row?.neverAccessed),
      importanceAvg: readAggregateNullableNumber(row?.importanceAvg),
      importanceMedian: this.getImportanceMedian(agentId, totalRows),
      confidenceAvg: readAggregateNullableNumber(row?.confidenceAvg),
      conflicted: readAggregateNumber(row?.conflicted),
      challenged: readAggregateNumber(row?.challenged)
    }
  }

  private getImportanceMedian(agentId: string, totalRows: number): number | null {
    if (totalRows <= 0) return null
    const limit = totalRows % 2 === 0 ? 2 : 1
    const offset = Math.floor((totalRows - 1) / 2)
    const rows = this.db
      .prepare(
        `SELECT importance
         FROM agent_memory
         WHERE agent_id = ?
         ORDER BY importance ASC
         LIMIT ? OFFSET ?`
      )
      .all(agentId, limit, offset) as Array<{ importance: number }>
    if (!rows.length) return null
    return rows.reduce((sum, item) => sum + item.importance, 0) / rows.length
  }

  hasStaleEmbeddings(agentId: string, currentDim: number, fingerprint: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS stale
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND lifecycle_state = 'active'
           AND embedding_state = 'ready'
           AND kind NOT IN ('persona', 'working')
           AND (
             embedding_dim IS NULL OR
             embedding_dim != ? OR
             embedding_model IS NULL OR
             embedding_model != ?
           )
         LIMIT 1`
      )
      .get(agentId, currentDim, fingerprint) as { stale: number } | undefined
    return row !== undefined
  }

  countStaleEmbeddings(agentId: string, currentDim: number, fingerprint: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND lifecycle_state = 'active'
           AND embedding_state = 'ready'
           AND kind NOT IN ('persona', 'working')
           AND (
             embedding_dim IS NULL OR
             embedding_dim != ? OR
             embedding_model IS NULL OR
             embedding_model != ?
           )`
      )
      .get(agentId, currentDim, fingerprint) as { count: number } | undefined
    return row?.count ?? 0
  }

  // Soft delete: archived rows stay on disk (and in the vector store) but drop out of recall.
  archiveActiveMemory(input: MemoryTransitionTarget): boolean {
    const before = this.getFtsMirrorRow(input.id)
    if (
      !before ||
      before.agent_id !== input.agentId ||
      before.decision_revision !== input.expectedRevision ||
      before.lifecycle_state !== 'active' ||
      before.superseded_by !== null ||
      before.conflict_state !== null ||
      before.conflict_with !== null ||
      before.kind === 'persona' ||
      before.kind === 'working'
    ) {
      return false
    }
    assertValidMemoryTransition(
      transitionSnapshot(before),
      transitionSnapshot(before, { lifecycleState: 'archived' }),
      'archive_active'
    )
    const result = this.runRecallMutation({
      mutate: () =>
        this.db
          .prepare(
            `UPDATE agent_memory AS memory
             SET lifecycle_state = 'archived', status = 'archived',
                 decision_revision = decision_revision + 1
             WHERE memory.agent_id = ? AND memory.id = ? AND memory.decision_revision = ?
               AND memory.lifecycle_state = 'active'
               AND memory.superseded_by IS NULL
               AND memory.conflict_state IS NULL
               AND memory.conflict_with IS NULL
               AND memory.kind NOT IN ('persona', 'working')
               AND NOT EXISTS (
                 SELECT 1 FROM agent_memory challenger
                 WHERE challenger.agent_id = memory.agent_id
                   AND challenger.lifecycle_state = 'conflicted'
                   AND challenger.superseded_by IS NULL
                   AND challenger.conflict_with = memory.id
                   AND challenger.scope_type = memory.scope_type
                   AND challenger.scope_id IS memory.scope_id
               )`
          )
          .run(input.agentId, input.id, input.expectedRevision),
      didMutate: (mutationResult) => mutationResult.changes === 1,
      maintainFts: () => this.deleteFtsMirrorRow(before)
    })
    return result.changes === 1
  }

  archiveEligibleBatch(
    agentId: string,
    options: {
      now: number
      createdBefore: number
      minimumBaseAgeMs: number
      limit: number
    }
  ): string[] {
    const limit = Math.max(0, Math.floor(options.limit))
    if (limit === 0) return []
    let rows: Array<{ id: string }> = []
    this.runRecallMutation({
      mutate: () => {
        rows = this.db
          .prepare(
            `WITH eligible AS (
           SELECT id
           FROM agent_memory INDEXED BY idx_agent_memory_archive_eligible_v3
           WHERE agent_id = ?
             AND superseded_by IS NULL
             AND conflict_state IS NULL
             AND lifecycle_state = 'active'
             AND is_anchor = 0
             AND kind NOT IN ('persona', 'working')
             AND created_at < ?
             AND COALESCE(last_accessed, created_at) < ? - ?
             AND (? - COALESCE(last_accessed, created_at)) >
               ? * (1 + min(1.0, max(0.0, importance)))
           ORDER BY COALESCE(last_accessed, created_at) ASC, created_at ASC, id ASC
           LIMIT ?
         )
         UPDATE agent_memory
         SET lifecycle_state = 'archived', status = 'archived',
             decision_revision = decision_revision + 1
         WHERE id IN (SELECT id FROM eligible)
         RETURNING id`
          )
          .all(
            agentId,
            options.createdBefore,
            options.now,
            options.minimumBaseAgeMs,
            options.now,
            options.minimumBaseAgeMs,
            limit
          ) as Array<{ id: string }>
        return rows
      },
      didMutate: (archivedRows) => archivedRows.length > 0,
      maintainFts: (archivedRows) => {
        for (const row of archivedRows) {
          this.deleteFtsMirrorRow(this.getFtsMirrorRow(row.id), true)
        }
      }
    })
    return rows.map((row) => row.id)
  }

  countArchiveEligible(
    agentId: string,
    options: { now: number; createdBefore: number; minimumBaseAgeMs: number }
  ): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_memory INDEXED BY idx_agent_memory_archive_eligible_v3
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND conflict_state IS NULL
           AND lifecycle_state = 'active'
           AND is_anchor = 0
           AND kind NOT IN ('persona', 'working')
           AND created_at < ?
           AND COALESCE(last_accessed, created_at) < ? - ?
           AND (? - COALESCE(last_accessed, created_at)) >
             ? * (1 + min(1.0, max(0.0, importance)))`
      )
      .get(
        agentId,
        options.createdBefore,
        options.now,
        options.minimumBaseAgeMs,
        options.now,
        options.minimumBaseAgeMs
      ) as { count: number } | undefined
    return row?.count ?? 0
  }

  listArchiveCandidateLifecycleRows(
    agentId: string,
    before: number,
    limit: number
  ): AgentMemoryLifecycleRow[] {
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    return this.db
      .prepare(
        `SELECT id,
                agent_id,
                kind,
                importance,
                lifecycle_state,
                embedding_state,
                is_anchor,
                superseded_by,
                created_at,
                last_accessed,
                access_count,
                decay_score,
                confidence,
                conflict_state
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND conflict_state IS NULL
           AND lifecycle_state = 'active'
           AND is_anchor = 0
           AND kind NOT IN ('persona', 'working')
           AND created_at < ?
         ORDER BY COALESCE(last_accessed, created_at) ASC, created_at ASC, id ASC
         LIMIT ?`
      )
      .all(agentId, before, cappedLimit) as AgentMemoryLifecycleRow[]
  }

  listTopAccessed(agentId: string, limit: number): AgentMemoryRow[] {
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND lifecycle_state = 'active'
           AND kind != 'working'
           AND access_count > 0
         ORDER BY access_count DESC, last_accessed DESC
         LIMIT ?`
      )
      .all(agentId, cappedLimit) as AgentMemoryRow[]
  }

  delete(id: string): void {
    const before = this.getFtsMirrorRow(id)
    this.runRecallMutation({
      mutate: () => this.db.prepare('DELETE FROM agent_memory WHERE id = ?').run(id),
      didMutate: (result) => result.changes === 1,
      maintainFts: () => this.deleteFtsMirrorRow(before)
    })
  }

  deleteInternalMemory(agentId: string, id: string): boolean {
    const row = this.getById(id)
    if (!row || row.agent_id !== agentId || (row.kind !== 'persona' && row.kind !== 'working')) {
      return false
    }
    this.delete(id)
    return this.getById(id) === undefined
  }

  tombstoneAndDelete(input: MemoryTombstoneDeleteInput): AgentMemoryRow | null {
    return this.db.transaction(() => {
      const row = this.getById(input.id)
      if (
        !row ||
        row.agent_id !== input.agentId ||
        row.decision_revision !== input.expectedRevision ||
        !isTombstoneEligibleMemoryKind(row.kind) ||
        this.isUnresolvedConflictParticipant(input.agentId, input.id)
      ) {
        return null
      }
      this.insertTombstonesForRows([row], input.createdAt, 'selective_delete')
      this.delete(row.id)
      if (this.getById(row.id)) {
        throw new Error(`[Memory] tombstoned row was not deleted: ${row.id}`)
      }
      return row
    })()
  }

  clearByAgent(agentId: string): number {
    const result = this.runRecallBulkDelete(
      () =>
        this.db
          .prepare(
            `INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, agent_id)
             SELECT 'delete', rowid, content, ${buildAgentFtsScopeSql('agent_id')}
             FROM agent_memory
             WHERE agent_id = ? AND ${buildRecallablePredicate()}`
          )
          .run(agentId),
      () => this.db.prepare('DELETE FROM agent_memory WHERE agent_id = ?').run(agentId)
    )
    return result.changes
  }

  listPendingMemoryClearJobs(): MemoryClearJob[] {
    return (
      this.db
        .prepare(
          `SELECT agent_id, cutoff_rowid, created_at, removed_count, phase
           FROM agent_memory_clear_job
           ORDER BY created_at, agent_id`
        )
        .all() as MemoryClearJobRow[]
    ).map(toMemoryClearJob)
  }

  beginMemoryClear(agentId: string, createdAt: number): MemoryClearJob {
    return this.db.transaction(() => {
      const cutoff = (
        this.db
          .prepare(
            `SELECT COALESCE(MAX(rowid), 0) AS cutoff_rowid
             FROM agent_memory
             WHERE agent_id = ?`
          )
          .get(agentId) as { cutoff_rowid: number }
      ).cutoff_rowid
      this.db
        .prepare(
          `INSERT INTO agent_memory_clear_job (
             agent_id, cutoff_rowid, created_at, removed_count, phase
           )
           VALUES (?, ?, ?, 0, 'claims')
           ON CONFLICT (agent_id) DO NOTHING`
        )
        .run(agentId, cutoff, createdAt)
      const row = this.db
        .prepare(
          `SELECT agent_id, cutoff_rowid, created_at, removed_count, phase
           FROM agent_memory_clear_job
           WHERE agent_id = ?`
        )
        .get(agentId) as MemoryClearJobRow | undefined
      if (!row) throw new Error(`[Memory] failed to create clear job for ${agentId}`)
      return toMemoryClearJob(row)
    })()
  }

  processMemoryClearBatch(agentId: string): MemoryClearBatchResult | null {
    return this.db.transaction(() => {
      const current = this.db
        .prepare(
          `SELECT agent_id, cutoff_rowid, created_at, removed_count, phase
           FROM agent_memory_clear_job
           WHERE agent_id = ?`
        )
        .get(agentId) as MemoryClearJobRow | undefined
      if (!current) return null
      if (current.phase === 'vectors') {
        return { job: toMemoryClearJob(current), removedInBatch: 0 }
      }

      const rows = this.db
        .prepare(
          `SELECT rowid AS storage_rowid, agent_id, scope_type, scope_id,
                  kind, content, provenance_key
           FROM agent_memory NOT INDEXED
           WHERE agent_id = ? AND rowid <= ?
           ORDER BY rowid
           LIMIT ?`
        )
        .all(
          agentId,
          current.cutoff_rowid,
          AGENT_MEMORY_CLEAR_BATCH_SIZE
        ) as TombstoneSourcePageRow[]
      let removedInBatch = 0
      if (rows.length > 0) {
        this.insertTombstonesForRows(rows, current.created_at, 'agent_clear')
        const rowIds = rows.map((row) => row.storage_rowid)
        const placeholders = rowIds.map(() => '?').join(', ')
        const result = this.runRecallBulkDelete(
          () =>
            this.db
              .prepare(
                `INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, agent_id)
                 SELECT 'delete', rowid, content, ${buildAgentFtsScopeSql('agent_id')}
                 FROM agent_memory
                 WHERE agent_id = ?
                   AND rowid IN (${placeholders})
                   AND ${buildRecallablePredicate()}`
              )
              .run(agentId, ...rowIds),
          () =>
            this.db
              .prepare(
                `DELETE FROM agent_memory
                 WHERE agent_id = ? AND rowid IN (${placeholders})`
              )
              .run(agentId, ...rowIds)
        )
        removedInBatch = result.changes
        this.db
          .prepare(
            `UPDATE agent_memory_clear_job
             SET removed_count = removed_count + ?
             WHERE agent_id = ? AND phase = 'claims'`
          )
          .run(removedInBatch, agentId)
      }

      if (rows.length < AGENT_MEMORY_CLEAR_BATCH_SIZE) {
        this.db.prepare('DELETE FROM agent_memory_derivation WHERE agent_id = ?').run(agentId)
        this.db.prepare('DELETE FROM agent_memory_dirty WHERE agent_id = ?').run(agentId)
        this.db
          .prepare(
            `UPDATE agent_memory_clear_job
             SET phase = 'vectors'
             WHERE agent_id = ? AND phase = 'claims'`
          )
          .run(agentId)
      }

      const updated = this.db
        .prepare(
          `SELECT agent_id, cutoff_rowid, created_at, removed_count, phase
           FROM agent_memory_clear_job
           WHERE agent_id = ?`
        )
        .get(agentId) as MemoryClearJobRow | undefined
      if (!updated) return null
      return { job: toMemoryClearJob(updated), removedInBatch }
    })()
  }

  completeMemoryClear(agentId: string): boolean {
    return this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT phase
           FROM agent_memory_clear_job
           WHERE agent_id = ?`
        )
        .get(agentId) as Pick<MemoryClearJobRow, 'phase'> | undefined
      if (!row) return true
      if (row.phase !== 'vectors') return false
      return (
        this.db
          .prepare(
            `DELETE FROM agent_memory_clear_job
           WHERE agent_id = ? AND phase = 'vectors'`
          )
          .run(agentId).changes === 1
      )
    })()
  }

  retireAgentMemoryNamespace(agentId: string): number {
    return this.db.transaction(() => {
      const removed = this.clearByAgent(agentId)
      this.db.prepare('DELETE FROM agent_memory_tombstone WHERE agent_id = ?').run(agentId)
      this.db.prepare('DELETE FROM agent_memory_derivation WHERE agent_id = ?').run(agentId)
      this.db.prepare('DELETE FROM agent_memory_dirty WHERE agent_id = ?').run(agentId)
      this.db.prepare('DELETE FROM agent_memory_clear_job WHERE agent_id = ?').run(agentId)
      return removed
    })()
  }

  countByAgent(agentId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM agent_memory WHERE agent_id = ?')
      .get(agentId) as { count: number } | undefined
    return row?.count ?? 0
  }

  countStatusView(agentId: string): {
    total: number
    pendingEmbedding: number
    activeMemoryCount: number
    archivedMemoryCount: number
  } {
    const row = this.db
      .prepare(
        `SELECT
                SUM(CASE WHEN lifecycle_state = 'active' THEN 1 ELSE 0 END) AS activeMemoryCount,
                SUM(CASE WHEN lifecycle_state = 'archived' THEN 1 ELSE 0 END) AS archivedMemoryCount,
                SUM(CASE
                  WHEN lifecycle_state = 'active' AND embedding_state = 'pending' THEN 1
                  ELSE 0
                END) AS pendingEmbedding
         FROM agent_memory
         WHERE agent_id = ?
           AND lifecycle_state != 'conflicted'
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')`
      )
      .get(agentId) as
      | {
          activeMemoryCount: number | null
          archivedMemoryCount: number | null
          pendingEmbedding: number | null
        }
      | undefined
    const activeMemoryCount = row?.activeMemoryCount ?? 0
    const archivedMemoryCount = row?.archivedMemoryCount ?? 0
    return {
      total: activeMemoryCount,
      pendingEmbedding: row?.pendingEmbedding ?? 0,
      activeMemoryCount,
      archivedMemoryCount
    }
  }

  // Mirrors the pair-validity predicate in ConflictService.listConflicts exactly (challenger is a
  // live 'conflicted' row; its conflict_with target belongs to the same agent, is still
  // 'challenged', and hasn't itself been superseded). Keep both in sync.
  countConflictPairs(agentId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_memory challenger
         JOIN agent_memory target ON target.id = challenger.conflict_with
         WHERE challenger.agent_id = ?
           AND challenger.lifecycle_state = 'conflicted'
           AND challenger.superseded_by IS NULL
           AND target.agent_id = challenger.agent_id
           AND target.scope_type = challenger.scope_type
           AND target.scope_id IS challenger.scope_id
           AND target.conflict_state = 'challenged'
           AND target.superseded_by IS NULL`
      )
      .get(agentId) as { count: number } | undefined
    return row?.count ?? 0
  }

  isUnresolvedConflictParticipant(agentId: string, memoryId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found
         FROM agent_memory candidate
         WHERE candidate.agent_id = ?
           AND candidate.id = ?
           AND (
             (candidate.lifecycle_state = 'conflicted' AND candidate.conflict_with IS NOT NULL)
             OR EXISTS (
               SELECT 1
               FROM agent_memory challenger
               WHERE challenger.agent_id = candidate.agent_id
                 AND challenger.lifecycle_state = 'conflicted'
                 AND challenger.superseded_by IS NULL
                 AND challenger.conflict_with = candidate.id
                 AND challenger.scope_type = candidate.scope_type
                 AND challenger.scope_id IS candidate.scope_id
             )
           )
         LIMIT 1`
      )
      .get(agentId, memoryId) as { found: number } | undefined
    return row?.found === 1
  }

  listConflictIntegrityRows(agentId: string): AgentMemoryRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory
         WHERE agent_id = ?
           AND (
             lifecycle_state = 'conflicted' OR conflict_with IS NOT NULL OR conflict_state IS NOT NULL
           )
         ORDER BY created_at ASC, id ASC`
      )
      .all(agentId) as AgentMemoryRow[]
  }

  listConflictChallengersForMaintenance(agentId: string, limit: number): AgentMemoryRow[] {
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    return this.db
      .prepare(
        `SELECT challenger.*
         FROM agent_memory challenger INDEXED BY idx_agent_memory_conflict_fairness_v3
         WHERE challenger.agent_id = ?
           AND challenger.lifecycle_state = 'conflicted'
           AND challenger.superseded_by IS NULL
           AND EXISTS (
             SELECT 1
             FROM agent_memory target
             WHERE target.id = challenger.conflict_with
               AND target.agent_id = challenger.agent_id
               AND target.scope_type = challenger.scope_type
               AND target.scope_id IS challenger.scope_id
               AND target.conflict_state = 'challenged'
               AND target.superseded_by IS NULL
           )
         ORDER BY COALESCE(challenger.last_consolidated_at, 0) ASC,
                  challenger.created_at ASC,
                  challenger.id ASC
         LIMIT ?`
      )
      .all(agentId, cappedLimit) as AgentMemoryRow[]
  }

  listConflictSiblings(
    agentId: string,
    targetId: string,
    excludeChallengerId: string
  ): AgentMemoryRow[] {
    return this.db
      .prepare(
        `SELECT sibling.*
         FROM agent_memory sibling
         JOIN agent_memory target ON target.id = ?
         WHERE sibling.agent_id = ?
           AND target.agent_id = sibling.agent_id
           AND sibling.scope_type = target.scope_type
           AND sibling.scope_id IS target.scope_id
           AND sibling.conflict_with = target.id
           AND sibling.lifecycle_state = 'conflicted'
           AND sibling.superseded_by IS NULL
           AND sibling.id != ?
         ORDER BY sibling.created_at ASC, sibling.id ASC`
      )
      .all(targetId, agentId, excludeChallengerId) as AgentMemoryRow[]
  }

  retireConflictSiblings(
    agentId: string,
    targetId: string,
    excludeChallengerId: string,
    winnerId: string,
    _at: number
  ): number {
    return this.db
      .prepare(
        `UPDATE agent_memory
         SET conflict_with = NULL,
             superseded_by = ?,
             lifecycle_state = 'archived',
             status = 'archived',
             decision_revision = decision_revision + 1
         WHERE agent_id = ?
           AND conflict_with = ?
           AND lifecycle_state = 'conflicted'
           AND superseded_by IS NULL
           AND id != ?
           AND EXISTS (
             SELECT 1
             FROM agent_memory target
             WHERE target.id = ?
               AND target.agent_id = agent_memory.agent_id
               AND target.scope_type = agent_memory.scope_type
               AND target.scope_id IS agent_memory.scope_id
           )
           AND EXISTS (
             SELECT 1
             FROM agent_memory winner
             WHERE winner.id = ?
               AND winner.id != agent_memory.id
               AND winner.agent_id = agent_memory.agent_id
               AND winner.scope_type = agent_memory.scope_type
               AND winner.scope_id IS agent_memory.scope_id
               AND winner.lifecycle_state = 'active'
               AND winner.superseded_by IS NULL
           )`
      )
      .run(winnerId, agentId, targetId, excludeChallengerId, targetId, winnerId).changes
  }

  clearTargetConflictIfNoChallengers(agentId: string, targetId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE agent_memory AS target
         SET conflict_state = NULL, decision_revision = decision_revision + 1
         WHERE target.agent_id = ?
           AND target.id = ?
           AND target.conflict_state = 'challenged'
           AND NOT EXISTS (
             SELECT 1
             FROM agent_memory challenger
             WHERE challenger.agent_id = target.agent_id
               AND challenger.conflict_with = target.id
               AND challenger.lifecycle_state = 'conflicted'
               AND challenger.superseded_by IS NULL
               AND challenger.scope_type = target.scope_type
               AND challenger.scope_id IS target.scope_id
           )`
      )
      .run(agentId, targetId)
    return result.changes === 1
  }

  repairConflictIntegrityBatch(
    agentId: string,
    limit: number
  ): {
    repairedTargets: number
    archivedChallengers: number
    clearedTargets: number
    clearedLinks: number
  } {
    const cappedLimit = Math.max(0, Math.min(256, Math.floor(limit)))
    const empty = {
      repairedTargets: 0,
      archivedChallengers: 0,
      clearedTargets: 0,
      clearedLinks: 0
    }
    if (cappedLimit === 0) return empty
    const perClassLimit = Math.ceil(cappedLimit / 4)

    return this.db.transaction(() => {
      this.db.exec(
        `CREATE TEMP TABLE IF NOT EXISTS memory_conflict_repair_batch (
           id TEXT PRIMARY KEY
         ) WITHOUT ROWID`
      )
      this.db.exec('DELETE FROM memory_conflict_repair_batch')
      this.db
        .prepare(
          `INSERT INTO memory_conflict_repair_batch (id)
           SELECT id FROM (
             SELECT id FROM (
               SELECT id
               FROM agent_memory INDEXED BY idx_agent_memory_conflict_target_v2
               WHERE agent_id = ? AND lifecycle_state != 'conflicted' AND conflict_with IS NOT NULL
               LIMIT ?
             )
             UNION ALL
             SELECT id FROM (
               SELECT challenger.id
               FROM agent_memory challenger
               WHERE challenger.agent_id = ? AND challenger.lifecycle_state = 'conflicted'
                 AND (
                   challenger.superseded_by IS NOT NULL
                   OR challenger.conflict_with IS NULL
                   OR challenger.conflict_with = challenger.id
                   OR NOT EXISTS (
                     SELECT 1 FROM agent_memory target
                     WHERE target.id = challenger.conflict_with
                       AND target.agent_id = challenger.agent_id
                       AND target.scope_type = challenger.scope_type
                       AND target.scope_id IS challenger.scope_id
                       AND target.lifecycle_state = 'active'
                       AND target.superseded_by IS NULL
                   )
                 )
               LIMIT ?
             )
             UNION ALL
             SELECT id FROM (
               SELECT target.id
               FROM agent_memory target
               WHERE target.agent_id = ? AND target.conflict_state IS NOT 'challenged'
                 AND EXISTS (
                   SELECT 1 FROM agent_memory challenger
                   WHERE challenger.agent_id = target.agent_id
                     AND challenger.conflict_with = target.id
                     AND challenger.lifecycle_state = 'conflicted'
                     AND challenger.superseded_by IS NULL
                     AND challenger.scope_type = target.scope_type
                     AND challenger.scope_id IS target.scope_id
                 )
               LIMIT ?
             )
             UNION ALL
             SELECT id FROM (
               SELECT target.id
               FROM agent_memory target INDEXED BY idx_agent_memory_conflict_state_anomaly_v2
               WHERE target.agent_id = ? AND target.conflict_state = 'challenged'
                 AND NOT EXISTS (
                   SELECT 1 FROM agent_memory challenger
                   WHERE challenger.agent_id = target.agent_id
                     AND challenger.conflict_with = target.id
                     AND challenger.lifecycle_state = 'conflicted'
                     AND challenger.superseded_by IS NULL
                     AND challenger.scope_type = target.scope_type
                     AND challenger.scope_id IS target.scope_id
                 )
               LIMIT ?
             )
           )
           LIMIT ?`
        )
        .run(
          agentId,
          perClassLimit,
          agentId,
          perClassLimit,
          agentId,
          perClassLimit,
          agentId,
          perClassLimit,
          cappedLimit
        )

      const clearedLinks = this.db
        .prepare(
          `UPDATE agent_memory
           SET conflict_with = NULL, decision_revision = decision_revision + 1
           WHERE id IN (SELECT id FROM memory_conflict_repair_batch)
             AND agent_id = ?
             AND lifecycle_state != 'conflicted'
             AND conflict_with IS NOT NULL`
        )
        .run(agentId).changes
      const archivedChallengers = this.db
        .prepare(
          `UPDATE agent_memory AS challenger
           SET conflict_with = NULL,
               lifecycle_state = 'archived',
               status = 'archived',
               decision_revision = decision_revision + 1
           WHERE challenger.id IN (SELECT id FROM memory_conflict_repair_batch)
             AND challenger.agent_id = ?
             AND challenger.lifecycle_state = 'conflicted'
             AND (
               challenger.superseded_by IS NOT NULL
               OR challenger.conflict_with IS NULL
               OR challenger.conflict_with = challenger.id
               OR NOT EXISTS (
                 SELECT 1
                 FROM agent_memory target
                 WHERE target.id = challenger.conflict_with
                   AND target.agent_id = challenger.agent_id
                   AND target.scope_type = challenger.scope_type
                   AND target.scope_id IS challenger.scope_id
                   AND target.lifecycle_state = 'active'
                   AND target.superseded_by IS NULL
               )
             )`
        )
        .run(agentId).changes
      const repairedTargets = this.db
        .prepare(
          `UPDATE agent_memory AS target
           SET conflict_state = 'challenged', decision_revision = decision_revision + 1
           WHERE target.agent_id = ?
             AND target.id IN (SELECT id FROM memory_conflict_repair_batch)
             AND target.conflict_state IS NOT 'challenged'
             AND EXISTS (
               SELECT 1
               FROM agent_memory challenger
               WHERE challenger.agent_id = target.agent_id
                 AND challenger.conflict_with = target.id
                 AND challenger.lifecycle_state = 'conflicted'
                 AND challenger.superseded_by IS NULL
                 AND challenger.scope_type = target.scope_type
                 AND challenger.scope_id IS target.scope_id
             )`
        )
        .run(agentId).changes
      const clearedTargets = this.db
        .prepare(
          `UPDATE agent_memory AS target
           SET conflict_state = NULL, decision_revision = decision_revision + 1
           WHERE target.id IN (SELECT id FROM memory_conflict_repair_batch)
             AND target.agent_id = ?
             AND target.conflict_state = 'challenged'
             AND NOT EXISTS (
               SELECT 1
               FROM agent_memory challenger
               WHERE challenger.agent_id = target.agent_id
                 AND challenger.conflict_with = target.id
                 AND challenger.lifecycle_state = 'conflicted'
                 AND challenger.superseded_by IS NULL
                 AND challenger.scope_type = target.scope_type
                 AND challenger.scope_id IS target.scope_id
             )`
        )
        .run(agentId).changes

      return { repairedTargets, archivedChallengers, clearedTargets, clearedLinks }
    })()
  }

  getPersonaCounts(agentId: string): { total: number; draft: number } {
    const row = this.db
      .prepare(
        `SELECT
           SUM(CASE
             WHEN persona_state IS NULL OR persona_state IN ('active', 'superseded') THEN 1
             ELSE 0
           END) AS total,
           SUM(CASE WHEN persona_state = 'draft' THEN 1 ELSE 0 END) AS draft
         FROM agent_memory
         WHERE agent_id = ? AND kind = 'persona'`
      )
      .get(agentId) as { total: number | null; draft: number | null } | undefined
    return { total: row?.total ?? 0, draft: row?.draft ?? 0 }
  }

  countLegacyShadowMismatches(agentId?: string): number {
    const agentPredicate = agentId === undefined ? '' : 'AND agent_id = ?'
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_memory
         WHERE status != ${buildLegacyStatusProjectionSql()}
           ${agentPredicate}`
      )
      .get(...(agentId === undefined ? [] : [agentId])) as { count: number } | undefined
    return row?.count ?? 0
  }

  runInTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  listWorkingCandidates(
    agentId: string,
    limit: number,
    after?: AgentMemoryWorkingCandidateCursor
  ): AgentMemoryRow[] {
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    const cursorSql = after
      ? `AND (
           importance < ?
           OR (importance = ? AND access_count < ?)
           OR (importance = ? AND access_count = ? AND created_at < ?)
           OR (importance = ? AND access_count = ? AND created_at = ? AND id < ?)
         )`
      : ''
    const params: unknown[] = [agentId]
    if (after) {
      params.push(
        after.importance,
        after.importance,
        after.accessCount,
        after.importance,
        after.accessCount,
        after.createdAt,
        after.importance,
        after.accessCount,
        after.createdAt,
        after.id
      )
    }
    params.push(cappedLimit)
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory
         WHERE agent_id = ?
           AND scope_type = 'agent'
           AND scope_id IS NULL
           AND superseded_by IS NULL
           AND lifecycle_state = 'active'
           AND kind IN ('semantic', 'reflection', 'episodic')
           ${cursorSql}
         ORDER BY importance DESC, access_count DESC, created_at DESC, id DESC
         LIMIT ?`
      )
      .all(...params) as AgentMemoryRow[]
  }

  hasActiveMemory(agentId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS present
         FROM agent_memory
         WHERE agent_id = ? AND lifecycle_state != 'archived'
         LIMIT 1`
      )
      .get(agentId) as { present: number } | undefined
    return row !== undefined
  }

  listAgentIdsWithMemories(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT agent_id
         FROM agent_memory
         WHERE lifecycle_state != 'archived'`
      )
      .all() as Array<{ agent_id: string }>
    return rows.map((row) => row.agent_id)
  }

  listRecentlyActiveAgentIds(candidateAgentIds: readonly string[], limit: number): string[] {
    const candidates = [...new Set(candidateAgentIds.filter((agentId) => agentId.length > 0))]
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0 || candidates.length === 0) return []
    const values = candidates.map(() => '(?)').join(', ')
    const rows = this.db
      .prepare(
        `WITH candidates(agent_id) AS (VALUES ${values}), activity AS (
           SELECT candidates.agent_id,
                  (
                    SELECT COALESCE(memory.last_accessed, memory.created_at)
                    FROM agent_memory memory INDEXED BY idx_agent_memory_recent_activity_v3
                    WHERE memory.agent_id = candidates.agent_id
                      AND memory.lifecycle_state != 'archived'
                    ORDER BY COALESCE(memory.last_accessed, memory.created_at) DESC
                    LIMIT 1
                  ) AS activity_at
           FROM candidates
         )
         SELECT agent_id
         FROM activity
         WHERE activity_at IS NOT NULL
         ORDER BY activity_at DESC, agent_id ASC
         LIMIT ?`
      )
      .all(...candidates, cappedLimit) as Array<{ agent_id: string }>
    return rows.map((row) => row.agent_id)
  }

  repairInternalKindStatuses(agentId: string): number {
    const result = this.db
      .prepare(
        `UPDATE agent_memory
         SET embedding_state = 'not_applicable', status = 'fts_only'
         WHERE agent_id = ?
           AND kind IN ('persona', 'working')
           AND embedding_state != 'not_applicable'`
      )
      .run(agentId)
    return result.changes
  }

  listPrunableVectorRefs(
    agentId: string,
    options: { limit: number; embeddingModel?: string; embeddingDim?: number }
  ): Array<{ id: string; embeddingDim: number; embeddingModel: string }> {
    const cappedLimit = Math.max(0, Math.floor(options.limit))
    if (cappedLimit === 0) return []
    const params: Array<string | number> = [agentId]
    const embeddingModelClause = options.embeddingModel ? 'AND embedding_model = ?' : ''
    if (options.embeddingModel) params.push(options.embeddingModel)
    const embeddingDimClause = options.embeddingDim !== undefined ? 'AND embedding_dim = ?' : ''
    if (options.embeddingDim !== undefined) params.push(options.embeddingDim)
    params.push(cappedLimit)
    const rows = this.db
      .prepare(
        `SELECT id,
                embedding_dim AS embeddingDim,
                embedding_model AS embeddingModel
         FROM agent_memory
         WHERE agent_id = ?
           AND embedding_id IS NOT NULL
           AND embedding_dim IS NOT NULL
           AND embedding_dim > 0
           AND embedding_model IS NOT NULL
           ${embeddingModelClause}
           ${embeddingDimClause}
           AND (
             kind IN ('persona', 'working') OR
             superseded_by IS NOT NULL OR
             lifecycle_state = 'archived'
           )
         ORDER BY created_at ASC, id ASC
         LIMIT ?`
      )
      .all(...params) as Array<{
      id: string
      embeddingDim: number
      embeddingModel: string
    }>
    return rows
  }

  filterPrunableVectorRefs(
    agentId: string,
    ids: string[],
    embeddingDim: number,
    embeddingModel: string
  ): string[] {
    const uniqueIds = [...new Set(ids.filter((id) => id.trim()))]
    if (!uniqueIds.length) return []
    const placeholders = uniqueIds.map(() => '?').join(', ')
    const existingRows = this.db
      .prepare(
        `SELECT id,
                embedding_id,
                embedding_dim,
                embedding_model,
                kind,
                superseded_by,
                lifecycle_state
         FROM agent_memory
         WHERE agent_id = ?
           AND id IN (${placeholders})`
      )
      .all(agentId, ...uniqueIds) as Array<{
      id: string
      embedding_id: string | null
      embedding_dim: number | null
      embedding_model: string | null
      kind: AgentMemoryKind
      superseded_by: string | null
      lifecycle_state: AgentMemoryRow['lifecycle_state']
    }>
    const existingIds = new Set(existingRows.map((row) => row.id))
    const prunableIds = new Set(
      existingRows
        .filter(
          (row) =>
            row.embedding_id !== null &&
            row.embedding_dim === embeddingDim &&
            row.embedding_model === embeddingModel &&
            (row.kind === 'persona' ||
              row.kind === 'working' ||
              row.superseded_by !== null ||
              row.lifecycle_state === 'archived')
        )
        .map((row) => row.id)
    )
    return uniqueIds.filter((id) => !existingIds.has(id) || prunableIds.has(id))
  }

  clearPrunableEmbeddingRefs(
    agentId: string,
    ids: string[],
    embeddingDim: number,
    embeddingModel: string
  ): number {
    const uniqueIds = [...new Set(ids.filter((id) => id.trim()))]
    if (!uniqueIds.length) return 0
    const placeholders = uniqueIds.map(() => '?').join(', ')
    const result = this.db
      .prepare(
        `UPDATE agent_memory
         SET embedding_id = NULL,
             embedding_dim = NULL,
             embedding_model = NULL
         WHERE agent_id = ?
           AND id IN (${placeholders})
           AND embedding_id IS NOT NULL
           AND embedding_dim = ?
           AND embedding_model = ?
           AND (
             kind IN ('persona', 'working') OR
             superseded_by IS NOT NULL OR
             lifecycle_state = 'archived'
           )`
      )
      .run(agentId, ...uniqueIds, embeddingDim, embeddingModel)
    return result.changes
  }
}
