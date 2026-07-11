#!/usr/bin/env node

import Database from 'better-sqlite3-multiple-ciphers'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const BASE_TIME = 1_700_000_000_000
const PAGE_SIZE = 50
const PRODUCTION_SOURCES = {
  pendingRecovery: 'src/main/presenter/sqlitePresenter/tables/deepchatMessages.ts#getByStatus',
  sessionNormalization:
    'src/main/presenter/agentSessionPresenter/index.ts#runMainlineNormalizationBackfill',
  messageNormalization:
    'src/main/presenter/agentSessionPresenter/index.ts#runMainlineNormalizationBackfill',
  usageBackfill:
    'src/main/presenter/sqlitePresenter/tables/deepchatMessages.ts#listAssistantUsageCandidatesPage',
  sessionList: 'src/main/presenter/sqlitePresenter/tables/newSessions.ts#listPage',
  claimedInputs: 'src/main/presenter/sqlitePresenter/tables/deepchatPendingInputs.ts#listClaimed',
  sessionMetadata: 'src/main/presenter/agentSessionPresenter/sessionManager.ts#mapRowToRecord'
}

if (!process.versions.electron) {
  throw new Error(
    'Run with ELECTRON_RUN_AS_NODE=1 pnpm exec electron scripts/database-query-baseline.mjs'
  )
}

const CURRENT_SCHEMA_SQL = `
  CREATE TABLE new_sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    title TEXT NOT NULL,
    project_dir TEXT,
    is_pinned INTEGER DEFAULT 0,
    is_draft INTEGER NOT NULL DEFAULT 0,
    active_skills TEXT NOT NULL DEFAULT '[]',
    disabled_agent_tools TEXT NOT NULL DEFAULT '[]',
    subagent_enabled INTEGER NOT NULL DEFAULT 0,
    session_kind TEXT NOT NULL DEFAULT 'regular',
    parent_session_id TEXT,
    subagent_meta_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_new_sessions_agent ON new_sessions(agent_id);
  CREATE INDEX idx_new_sessions_updated ON new_sessions(updated_at DESC);

  CREATE TABLE deepchat_sessions (
    id TEXT PRIMARY KEY,
    provider_id TEXT,
    model_id TEXT
  );

  CREATE TABLE deepchat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    order_seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    is_context_edge INTEGER DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_deepchat_messages_session
    ON deepchat_messages(session_id, order_seq);

  CREATE TABLE deepchat_pending_inputs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    payload_json TEXT NOT NULL,
    queue_order INTEGER,
    claimed_at INTEGER,
    consumed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_deepchat_pending_inputs_session
    ON deepchat_pending_inputs(session_id, state, mode, queue_order, created_at);

  CREATE TABLE deepchat_session_metadata (
    session_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_deepchat_session_metadata_source
    ON deepchat_session_metadata(source, updated_at DESC);
`

const DB_CORE_INDEXES = [
  {
    name: 'candidate_messages_pending_updated_partial',
    sql: `CREATE INDEX candidate_messages_pending_updated_partial
      ON deepchat_messages(updated_at DESC) WHERE status = 'pending'`
  },
  {
    name: 'candidate_messages_created_id',
    sql: `CREATE INDEX candidate_messages_created_id
      ON deepchat_messages(created_at ASC, id ASC)`
  },
  {
    name: 'candidate_inputs_claimed_session_created_partial',
    sql: `CREATE INDEX candidate_inputs_claimed_session_created_partial
      ON deepchat_pending_inputs(session_id ASC, created_at ASC) WHERE state = 'claimed'`
  }
]

const PARTIAL_SUITE_INDEXES = [
  ...DB_CORE_INDEXES,
  {
    name: 'candidate_sessions_updated_id',
    sql: `CREATE INDEX candidate_sessions_updated_id
      ON new_sessions(updated_at DESC, id DESC)`
  },
  {
    name: 'drop_replaced_sessions_updated',
    sql: 'DROP INDEX idx_new_sessions_updated'
  },
  {
    name: 'candidate_sessions_kind_updated_id',
    sql: `CREATE INDEX candidate_sessions_kind_updated_id
      ON new_sessions(session_kind, updated_at DESC, id DESC)`
  }
]

const SCENARIOS = [
  { name: 'current', indexOperations: [] },
  { name: 'dbCore', indexOperations: DB_CORE_INDEXES },
  { name: 'partialSuite', indexOperations: PARTIAL_SUITE_INDEXES },
  {
    name: 'assistantPartial',
    indexOperations: [
      ...PARTIAL_SUITE_INDEXES,
      {
        name: 'candidate_messages_assistant_created_partial',
        sql: `CREATE INDEX candidate_messages_assistant_created_partial
          ON deepchat_messages(created_at ASC, id ASC) WHERE role = 'assistant'`
      }
    ]
  },
  {
    name: 'fullComposite',
    indexOperations: [
      {
        name: 'candidate_messages_status_updated',
        sql: `CREATE INDEX candidate_messages_status_updated
          ON deepchat_messages(status, updated_at DESC)`
      },
      {
        name: 'candidate_messages_created_id',
        sql: `CREATE INDEX candidate_messages_created_id
          ON deepchat_messages(created_at ASC, id ASC)`
      },
      {
        name: 'candidate_messages_role_created_id',
        sql: `CREATE INDEX candidate_messages_role_created_id
          ON deepchat_messages(role, created_at ASC, id ASC)`
      },
      {
        name: 'candidate_sessions_updated_id',
        sql: `CREATE INDEX candidate_sessions_updated_id
          ON new_sessions(updated_at DESC, id DESC)`
      },
      {
        name: 'drop_replaced_sessions_updated',
        sql: 'DROP INDEX idx_new_sessions_updated'
      },
      {
        name: 'candidate_sessions_kind_updated_id',
        sql: `CREATE INDEX candidate_sessions_kind_updated_id
          ON new_sessions(session_kind, updated_at DESC, id DESC)`
      },
      {
        name: 'candidate_sessions_agent_kind_updated_id',
        sql: `CREATE INDEX candidate_sessions_agent_kind_updated_id
          ON new_sessions(agent_id, session_kind, updated_at DESC, id DESC)`
      },
      {
        name: 'candidate_pending_inputs_state_session_created',
        sql: `CREATE INDEX candidate_pending_inputs_state_session_created
          ON deepchat_pending_inputs(state, session_id ASC, created_at ASC)`
      }
    ]
  }
]

function parsePositiveInteger(value, label, max = 1_000_000) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${label} must be an integer in 1..${max}`)
  }
  return parsed
}

function parseArgs(argv) {
  const options = {
    rows: [10_000, 100_000],
    samples: 15,
    warmups: 3,
    writeRows: 5_000,
    output: null
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const value = argv[index + 1]
    if (argument === '--rows') {
      if (!value) throw new Error('--rows requires a comma-separated value')
      options.rows = [
        ...new Set(value.split(',').map((item) => parsePositiveInteger(item, 'rows')))
      ]
      index += 1
    } else if (argument === '--samples') {
      if (!value) throw new Error('--samples requires a value')
      options.samples = parsePositiveInteger(value, 'samples', 1_000)
      index += 1
    } else if (argument === '--warmups') {
      if (!value) throw new Error('--warmups requires a value')
      options.warmups = parsePositiveInteger(value, 'warmups', 1_000)
      index += 1
    } else if (argument === '--write-rows') {
      if (!value) throw new Error('--write-rows requires a value')
      options.writeRows = parsePositiveInteger(value, 'write-rows')
      index += 1
    } else if (argument === '--output') {
      if (!value) throw new Error('--output requires a path')
      options.output = resolve(REPO_ROOT, value)
      index += 1
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  return options
}

function pad(value) {
  return String(value).padStart(8, '0')
}

function openDatabase(path) {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  return db
}

function checkpoint(db) {
  const startedAt = performance.now()
  db.pragma('wal_checkpoint(TRUNCATE)')
  return performance.now() - startedAt
}

function storageStats(db, path) {
  const pageSize = db.pragma('page_size', { simple: true })
  const pageCount = db.pragma('page_count', { simple: true })
  const freelistCount = db.pragma('freelist_count', { simple: true })
  const walPath = `${path}-wal`
  const shmPath = `${path}-shm`
  return {
    pageSize,
    pageCount,
    freelistCount,
    allocatedBytes: pageSize * pageCount,
    databaseFileBytes: statSync(path).size,
    walFileBytes: existsSync(walPath) ? statSync(walPath).size : 0,
    shmFileBytes: existsSync(shmPath) ? statSync(shmPath).size : 0
  }
}

function groupedCounts(db, table, column) {
  return Object.fromEntries(
    db
      .prepare(`SELECT ${column} AS value, COUNT(*) AS total FROM ${table} GROUP BY ${column}`)
      .all()
      .map((row) => [row.value, row.total])
  )
}

function createFixture(path, rowCount) {
  const db = openDatabase(path)
  try {
    db.exec(CURRENT_SCHEMA_SQL)

    const insertSession = db.prepare(`INSERT INTO new_sessions (
    id, agent_id, title, project_dir, is_pinned, is_draft, active_skills,
    disabled_agent_tools, subagent_enabled, session_kind, parent_session_id,
    subagent_meta_json, created_at, updated_at
  ) VALUES (?, ?, ?, NULL, 0, 0, '[]', '[]', 0, ?, NULL, NULL, ?, ?)`)
    const insertDeepChatSession = db.prepare(
      'INSERT INTO deepchat_sessions (id, provider_id, model_id) VALUES (?, ?, ?)'
    )
    const insertMessage = db.prepare(`INSERT INTO deepchat_messages (
    id, session_id, order_seq, role, content, status, is_context_edge,
    metadata, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 0, '{}', ?, ?)`)
    const insertPendingInput = db.prepare(`INSERT INTO deepchat_pending_inputs (
    id, session_id, mode, state, payload_json, queue_order, claimed_at,
    consumed_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, '{"text":"fixture"}', ?, ?, ?, ?, ?)`)
    const insertMetadata = db.prepare(`INSERT INTO deepchat_session_metadata (
    session_id, source, metadata_json, created_at, updated_at
  ) VALUES (?, 'cron_job', ?, ?, ?)`)
    const populate = db.transaction(() => {
      for (let index = 0; index < rowCount; index += 1) {
        const suffix = pad(index)
        const sessionId = `session-${suffix}`
        const createdAt = BASE_TIME + Math.floor(index / 10)
        const updatedAt = createdAt + (index % 3)
        const sessionKind = index % 10 === 0 ? 'subagent' : 'regular'
        const agentId = `agent-${Math.floor(index / 10) % 10}`
        const role = index % 2 === 0 ? 'user' : 'assistant'
        const messageStatus = index % 1_000 === 0 ? 'pending' : 'sent'
        const inputState =
          index % 1_000 === 0 ? 'claimed' : index % 5 === 0 ? 'pending' : 'consumed'
        const mode = index % 2 === 0 ? 'queue' : 'steer'

        insertSession.run(
          sessionId,
          agentId,
          `Session ${suffix}`,
          sessionKind,
          createdAt,
          updatedAt
        )
        insertDeepChatSession.run(sessionId, `provider-${index % 4}`, `model-${index % 8}`)
        insertMessage.run(
          `message-${suffix}`,
          sessionId,
          1,
          role,
          `Message ${suffix}`,
          messageStatus,
          createdAt,
          updatedAt
        )
        insertPendingInput.run(
          `input-${suffix}`,
          sessionId,
          mode,
          inputState,
          mode === 'queue' ? index : null,
          inputState === 'claimed' ? updatedAt : null,
          inputState === 'consumed' ? updatedAt : null,
          createdAt,
          updatedAt
        )

        if (index % 10 === 1) {
          insertMetadata.run(
            sessionId,
            JSON.stringify({
              source: 'cron_job',
              cronJobId: `job-${index % 100}`,
              cronJobRunId: `run-${suffix}`,
              scheduledAt: createdAt
            }),
            createdAt,
            updatedAt
          )
        }
      }
    })

    const startedAt = performance.now()
    populate()
    const populateMs = performance.now() - startedAt
    const checkpointMs = checkpoint(db)
    const storage = storageStats(db, path)
    const counts = Object.fromEntries(
      ['new_sessions', 'deepchat_sessions', 'deepchat_messages', 'deepchat_pending_inputs'].map(
        (table) => [table, db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total]
      )
    )

    for (const [table, count] of Object.entries(counts)) {
      if (count !== rowCount) {
        throw new Error(`Fixture count mismatch for ${table}: expected ${rowCount}, got ${count}`)
      }
    }

    const distribution = {
      sessionKind: groupedCounts(db, 'new_sessions', 'session_kind'),
      sessionAgent: groupedCounts(db, 'new_sessions', 'agent_id'),
      messageRole: groupedCounts(db, 'deepchat_messages', 'role'),
      messageStatus: groupedCounts(db, 'deepchat_messages', 'status'),
      pendingInputState: groupedCounts(db, 'deepchat_pending_inputs', 'state'),
      pendingInputMode: groupedCounts(db, 'deepchat_pending_inputs', 'mode'),
      sessionMetadata: db.prepare('SELECT COUNT(*) AS total FROM deepchat_session_metadata').get()
        .total
    }

    return { populateMs, checkpointMs, storage, counts, distribution }
  } finally {
    db.close()
  }
}

function rowAtOffset(db, sql, args, offset) {
  const row = db.prepare(`${sql} LIMIT 1 OFFSET ?`).get(...args, offset)
  if (!row) throw new Error(`Unable to build cursor for offset ${offset}`)
  return row
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function resultSignature(rows) {
  const normalizedRows = rows.map((row) =>
    Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right)))
  )
  return {
    count: rows.length,
    orderedRowsHash: hash(normalizedRows)
  }
}

function metadataIdSignature(rows) {
  const ids = rows
    .map((row) => row.metadata_session_id ?? row.session_id ?? null)
    .filter((value) => typeof value === 'string')
    .sort()
  return {
    count: ids.length,
    sortedIdsHash: hash(ids)
  }
}

function queryCase(name, sql, args, queryCount = 1) {
  return {
    name,
    planSql: sql,
    planArgs: args,
    queryCount,
    run: (db) => db.prepare(sql).all(...args)
  }
}

function cursorsAtDepths(db, sql, args, rowCount) {
  return Object.fromEntries(
    [50, 90, 99].map((depth) => [
      depth,
      rowAtOffset(db, sql, args, Math.min(rowCount - 1, Math.floor(rowCount * (depth / 100))))
    ])
  )
}

function buildQueryCases(db, rowCount) {
  const sessionCursors = cursorsAtDepths(
    db,
    'SELECT updated_at, id FROM new_sessions ORDER BY updated_at ASC, id ASC',
    [],
    rowCount
  )
  const messageCursors = cursorsAtDepths(
    db,
    'SELECT created_at, id FROM deepchat_messages ORDER BY created_at ASC, id ASC',
    [],
    rowCount
  )
  const assistantCount = db
    .prepare("SELECT COUNT(*) AS total FROM deepchat_messages WHERE role = 'assistant'")
    .get().total
  const usageCursors = cursorsAtDepths(
    db,
    "SELECT created_at, id FROM deepchat_messages WHERE role = 'assistant' ORDER BY created_at ASC, id ASC",
    [],
    assistantCount
  )
  const regularCount = db
    .prepare("SELECT COUNT(*) AS total FROM new_sessions WHERE session_kind = 'regular'")
    .get().total
  const regularCursors = cursorsAtDepths(
    db,
    "SELECT updated_at, id FROM new_sessions WHERE session_kind = 'regular' ORDER BY updated_at DESC, id DESC",
    [],
    regularCount
  )
  const agentId = 'agent-3'
  const agentCount = db
    .prepare(
      "SELECT COUNT(*) AS total FROM new_sessions WHERE agent_id = ? AND session_kind = 'regular'"
    )
    .get(agentId).total
  const agentCursors = cursorsAtDepths(
    db,
    "SELECT updated_at, id FROM new_sessions WHERE agent_id = ? AND session_kind = 'regular' ORDER BY updated_at DESC, id DESC",
    [agentId],
    agentCount
  )

  const usageBase = `SELECT
    m.id, m.session_id, m.metadata, m.created_at, m.updated_at,
    s.provider_id, s.model_id
  FROM deepchat_messages m
  LEFT JOIN deepchat_sessions s ON s.id = m.session_id
  WHERE m.role = 'assistant'`
  const regularBase = `SELECT * FROM new_sessions WHERE session_kind = 'regular'`
  const agentBase = `SELECT * FROM new_sessions
    WHERE agent_id = ? AND session_kind = 'regular'`

  const cases = [
    queryCase(
      'pendingRecovery',
      'SELECT * FROM deepchat_messages WHERE status = ? ORDER BY updated_at DESC',
      ['pending']
    ),
    queryCase(
      'sessionNormalizationPage1',
      'SELECT id, title, updated_at FROM new_sessions ORDER BY updated_at ASC, id ASC LIMIT ?',
      [PAGE_SIZE]
    ),
    queryCase(
      'messageNormalizationPage1',
      `SELECT id, session_id, role, status, content, updated_at, created_at
       FROM deepchat_messages ORDER BY created_at ASC, id ASC LIMIT ?`,
      [PAGE_SIZE]
    ),
    queryCase('usageBackfillPage1', `${usageBase} ORDER BY m.created_at ASC, m.id ASC LIMIT ?`, [
      PAGE_SIZE
    ]),
    queryCase(
      'sessionRegularPage1',
      `${regularBase} ORDER BY updated_at DESC, id DESC LIMIT ?`,
      [31]
    ),
    queryCase('sessionAgentPage1', `${agentBase} ORDER BY updated_at DESC, id DESC LIMIT ?`, [
      agentId,
      31
    ]),
    queryCase(
      'claimedInputs',
      `SELECT * FROM deepchat_pending_inputs
       WHERE state = 'claimed'
       ORDER BY session_id ASC, created_at ASC`,
      []
    )
  ]

  for (const depth of [50, 90, 99]) {
    const sessionCursor = sessionCursors[depth]
    const messageCursor = messageCursors[depth]
    const usageCursor = usageCursors[depth]
    const regularCursor = regularCursors[depth]
    const agentCursor = agentCursors[depth]
    cases.push(
      queryCase(
        `sessionNormalizationDepth${depth}`,
        `SELECT id, title, updated_at FROM new_sessions
         WHERE updated_at > ? OR (updated_at = ? AND id > ?)
         ORDER BY updated_at ASC, id ASC LIMIT ?`,
        [sessionCursor.updated_at, sessionCursor.updated_at, sessionCursor.id, PAGE_SIZE]
      ),
      queryCase(
        `sessionNormalizationRowValueDepth${depth}`,
        `SELECT id, title, updated_at FROM new_sessions
         WHERE (updated_at, id) > (?, ?)
         ORDER BY updated_at ASC, id ASC LIMIT ?`,
        [sessionCursor.updated_at, sessionCursor.id, PAGE_SIZE]
      ),
      queryCase(
        `messageNormalizationDepth${depth}`,
        `SELECT id, session_id, role, status, content, updated_at, created_at
         FROM deepchat_messages
         WHERE created_at > ? OR (created_at = ? AND id > ?)
         ORDER BY created_at ASC, id ASC LIMIT ?`,
        [messageCursor.created_at, messageCursor.created_at, messageCursor.id, PAGE_SIZE]
      ),
      queryCase(
        `messageNormalizationRowValueDepth${depth}`,
        `SELECT id, session_id, role, status, content, updated_at, created_at
         FROM deepchat_messages
         WHERE (created_at, id) > (?, ?)
         ORDER BY created_at ASC, id ASC LIMIT ?`,
        [messageCursor.created_at, messageCursor.id, PAGE_SIZE]
      ),
      queryCase(
        `usageBackfillDepth${depth}`,
        `${usageBase}
         AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
         ORDER BY m.created_at ASC, m.id ASC LIMIT ?`,
        [usageCursor.created_at, usageCursor.created_at, usageCursor.id, PAGE_SIZE]
      ),
      queryCase(
        `usageBackfillRowValueDepth${depth}`,
        `${usageBase}
         AND (m.created_at, m.id) > (?, ?)
         ORDER BY m.created_at ASC, m.id ASC LIMIT ?`,
        [usageCursor.created_at, usageCursor.id, PAGE_SIZE]
      ),
      queryCase(
        `sessionRegularDepth${depth}`,
        `${regularBase}
         AND (updated_at < ? OR (updated_at = ? AND id < ?))
         ORDER BY updated_at DESC, id DESC LIMIT ?`,
        [regularCursor.updated_at, regularCursor.updated_at, regularCursor.id, 31]
      ),
      queryCase(
        `sessionRegularRowValueDepth${depth}`,
        `${regularBase}
         AND (updated_at, id) < (?, ?)
         ORDER BY updated_at DESC, id DESC LIMIT ?`,
        [regularCursor.updated_at, regularCursor.id, 31]
      ),
      queryCase(
        `sessionAgentDepth${depth}`,
        `${agentBase}
         AND (updated_at < ? OR (updated_at = ? AND id < ?))
         ORDER BY updated_at DESC, id DESC LIMIT ?`,
        [agentId, agentCursor.updated_at, agentCursor.updated_at, agentCursor.id, 31]
      ),
      queryCase(
        `sessionAgentRowValueDepth${depth}`,
        `${agentBase}
         AND (updated_at, id) < (?, ?)
         ORDER BY updated_at DESC, id DESC LIMIT ?`,
        [agentId, agentCursor.updated_at, agentCursor.id, 31]
      )
    )
  }

  const pageIds = db
    .prepare(`${regularBase} ORDER BY updated_at DESC, id DESC LIMIT 30`)
    .all()
    .map((row) => row.id)
  const placeholders = pageIds.map(() => '?').join(', ')
  const metadataLookupSql = 'SELECT * FROM deepchat_session_metadata WHERE session_id = ?'
  const metadataBatchSql = `SELECT * FROM deepchat_session_metadata
    WHERE session_id IN (${placeholders})`
  const metadataJoinSql = `SELECT s.id, md.session_id AS metadata_session_id
    FROM new_sessions s
    LEFT JOIN deepchat_session_metadata md ON md.session_id = s.id
    WHERE s.session_kind = 'regular'
    ORDER BY s.updated_at DESC, s.id DESC
    LIMIT 30`

  cases.push(
    {
      name: 'sessionMetadataNPlusOne',
      planSql: metadataLookupSql,
      planArgs: [pageIds[0]],
      queryCount: pageIds.length,
      totalPageQueryCount: pageIds.length + 1,
      signature: metadataIdSignature,
      run: (targetDb) => {
        const rows = []
        for (const sessionId of pageIds) {
          const row = targetDb.prepare(metadataLookupSql).get(sessionId)
          if (row) rows.push(row)
        }
        return rows
      }
    },
    {
      name: 'sessionMetadataBatch',
      planSql: metadataBatchSql,
      planArgs: pageIds,
      queryCount: 1,
      totalPageQueryCount: 2,
      signature: metadataIdSignature,
      run: (targetDb) => targetDb.prepare(metadataBatchSql).all(...pageIds)
    },
    {
      name: 'sessionPageWithMetadataJoin',
      planSql: metadataJoinSql,
      planArgs: [],
      queryCount: 1,
      totalPageQueryCount: 1,
      run: (targetDb) => targetDb.prepare(metadataJoinSql).all(),
      signature: metadataIdSignature
    }
  )

  return cases
}

function percentile(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right)
  const q1Ms = percentile(sorted, 0.25)
  const q3Ms = percentile(sorted, 0.75)
  return {
    minMs: sorted[0],
    q1Ms,
    p50Ms: percentile(sorted, 0.5),
    q3Ms,
    iqrMs: q3Ms - q1Ms,
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1),
    meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length
  }
}

function explain(db, sql, args) {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...args)
    .map((row) => ({ id: row.id, parent: row.parent, detail: row.detail }))
}

function capturePlans(db, rowCount) {
  return Object.fromEntries(
    buildQueryCases(db, rowCount).map((item) => [
      item.name,
      explain(db, item.planSql, item.planArgs)
    ])
  )
}

function measureQueries(db, rowCount, samples, warmups) {
  const results = {}
  for (const item of buildQueryCases(db, rowCount)) {
    const firstRunStartedAt = performance.now()
    const firstRows = item.run(db)
    const firstMeasuredRunMs = performance.now() - firstRunStartedAt
    const signature = item.signature ? item.signature(firstRows) : resultSignature(firstRows)
    for (let index = 0; index < warmups; index += 1) item.run(db)
    const rawSamples = []
    for (let index = 0; index < samples; index += 1) {
      const startedAt = performance.now()
      item.run(db)
      rawSamples.push(performance.now() - startedAt)
    }
    results[item.name] = {
      sql: item.planSql,
      args: item.planArgs,
      queryCount: item.queryCount,
      ...(item.totalPageQueryCount ? { totalPageQueryCount: item.totalPageQueryCount } : {}),
      firstMeasuredRunMs,
      plan: explain(db, item.planSql, item.planArgs),
      result: signature,
      samplesMs: rawSamples,
      summary: summarize(rawSamples)
    }
  }

  if (
    JSON.stringify(results.sessionMetadataNPlusOne.result) !==
    JSON.stringify(results.sessionMetadataBatch.result)
  ) {
    throw new Error('Metadata N+1 and batch results diverged')
  }
  if (
    JSON.stringify(results.sessionMetadataNPlusOne.result) !==
    JSON.stringify(results.sessionPageWithMetadataJoin.result)
  ) {
    throw new Error('Metadata N+1 and join results diverged')
  }
  for (const depth of [50, 90, 99]) {
    for (const family of [
      'sessionNormalization',
      'messageNormalization',
      'usageBackfill',
      'sessionRegular',
      'sessionAgent'
    ]) {
      const expanded = results[`${family}Depth${depth}`].result
      const rowValue = results[`${family}RowValueDepth${depth}`].result
      if (JSON.stringify(expanded) !== JSON.stringify(rowValue)) {
        throw new Error(`${family} row-value result diverged at depth ${depth}`)
      }
    }
  }
  return results
}

function createIndexOperations(db, indexOperations) {
  const perIndex = []
  const applyIndexes = db.transaction(() => {
    for (const candidate of indexOperations) {
      const startedAt = performance.now()
      db.exec(candidate.sql)
      perIndex.push({ name: candidate.name, durationMs: performance.now() - startedAt })
    }
  })
  const startedAt = performance.now()
  applyIndexes()
  return {
    totalDurationMs: performance.now() - startedAt,
    perIndex
  }
}

function appendRows(db, rowCount, writeRows) {
  const insertSession = db.prepare(`INSERT INTO new_sessions (
    id, agent_id, title, project_dir, is_pinned, is_draft, active_skills,
    disabled_agent_tools, subagent_enabled, session_kind, parent_session_id,
    subagent_meta_json, created_at, updated_at
  ) VALUES (?, ?, ?, NULL, 0, 0, '[]', '[]', 0, ?, NULL, NULL, ?, ?)`)
  const insertDeepChatSession = db.prepare(
    'INSERT INTO deepchat_sessions (id, provider_id, model_id) VALUES (?, ?, ?)'
  )
  const insertMessage = db.prepare(`INSERT INTO deepchat_messages (
    id, session_id, order_seq, role, content, status, is_context_edge,
    metadata, created_at, updated_at
  ) VALUES (?, ?, 1, ?, ?, ?, 0, '{}', ?, ?)`)
  const insertPendingInput = db.prepare(`INSERT INTO deepchat_pending_inputs (
    id, session_id, mode, state, payload_json, queue_order, claimed_at,
    consumed_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, '{"text":"append"}', ?, ?, ?, ?, ?)`)
  const insertMetadata = db.prepare(`INSERT INTO deepchat_session_metadata (
    session_id, source, metadata_json, created_at, updated_at
  ) VALUES (?, 'cron_job', ?, ?, ?)`)
  const updateSession = db.prepare(
    'UPDATE new_sessions SET title = ?, is_pinned = 1, updated_at = ? WHERE id = ?'
  )
  const finalizeMessage = db.prepare(
    "UPDATE deepchat_messages SET content = ?, status = 'sent', updated_at = ? WHERE id = ?"
  )
  const claimInput = db.prepare(
    "UPDATE deepchat_pending_inputs SET state = 'claimed', claimed_at = ?, updated_at = ? WHERE id = ?"
  )
  const consumeInput = db.prepare(
    "UPDATE deepchat_pending_inputs SET state = 'consumed', consumed_at = ?, updated_at = ? WHERE id = ?"
  )
  const deleteInput = db.prepare('DELETE FROM deepchat_pending_inputs WHERE id = ?')

  const write = db.transaction(() => {
    for (let offset = 0; offset < writeRows; offset += 1) {
      const index = rowCount + offset
      const suffix = pad(index)
      const sessionId = `append-session-${suffix}`
      const createdAt = BASE_TIME + rowCount + Math.floor(offset / 10)
      const updatedAt = createdAt + (offset % 3)
      const sessionKind = offset % 10 === 0 ? 'subagent' : 'regular'
      const agentId = `agent-${Math.floor(offset / 10) % 10}`
      const role = offset % 2 === 0 ? 'user' : 'assistant'
      const mode = offset % 2 === 0 ? 'queue' : 'steer'
      const messageId = `append-message-${suffix}`
      const inputId = `append-input-${suffix}`

      insertSession.run(sessionId, agentId, `Append ${suffix}`, sessionKind, createdAt, updatedAt)
      insertDeepChatSession.run(sessionId, `provider-${offset % 4}`, `model-${offset % 8}`)
      insertMessage.run(
        messageId,
        sessionId,
        role,
        `Append message ${suffix}`,
        'pending',
        createdAt,
        updatedAt
      )
      insertPendingInput.run(
        inputId,
        sessionId,
        mode,
        'pending',
        mode === 'queue' ? index : null,
        null,
        null,
        createdAt,
        updatedAt
      )
      if (offset % 10 === 1) {
        insertMetadata.run(
          sessionId,
          JSON.stringify({
            source: 'cron_job',
            cronJobId: `job-${offset % 100}`,
            cronJobRunId: `append-run-${suffix}`,
            scheduledAt: createdAt
          }),
          createdAt,
          updatedAt
        )
      }

      const settledAt = updatedAt + 10_000
      updateSession.run(`Renamed ${suffix}`, settledAt, sessionId)
      finalizeMessage.run(`Final ${suffix}`, settledAt, messageId)
      claimInput.run(settledAt, settledAt, inputId)
      if (mode === 'queue') {
        deleteInput.run(inputId)
      } else {
        consumeInput.run(settledAt + 1, settledAt + 1, inputId)
      }
    }
  })

  const startedAt = performance.now()
  write()
  return performance.now() - startedAt
}

function runScenario(path, rowCount, options, scenario) {
  const db = openDatabase(path)
  try {
    const storageBeforeIndexes = storageStats(db, path)
    const indexMigration =
      scenario.indexOperations.length > 0
        ? createIndexOperations(db, scenario.indexOperations)
        : null
    const indexCheckpointMs = indexMigration ? checkpoint(db) : 0
    const storageAfterIndexes = storageStats(db, path)
    const plansBeforeAnalyze = capturePlans(db, rowCount)
    const analyzeStartedAt = performance.now()
    db.exec('ANALYZE')
    const analyzeMs = performance.now() - analyzeStartedAt
    const analyzeCheckpointMs = checkpoint(db)
    const storageBeforeQueries = storageStats(db, path)
    const queries = measureQueries(db, rowCount, options.samples, options.warmups)
    const storageBeforeWrite = storageStats(db, path)
    const transactionMs = appendRows(db, rowCount, options.writeRows)
    const writeCheckpointMs = checkpoint(db)
    const storageAfterWrite = storageStats(db, path)
    return {
      storageBeforeIndexes,
      indexMigration: indexMigration
        ? { ...indexMigration, checkpointMs: indexCheckpointMs }
        : null,
      storageAfterIndexes,
      plansBeforeAnalyze,
      analyze: { durationMs: analyzeMs, checkpointMs: analyzeCheckpointMs },
      storageBeforeQueries,
      queries,
      incrementalWrite: {
        rowsPerPrimaryTable: options.writeRows,
        transactionMs,
        checkpointMs: writeCheckpointMs,
        storageBefore: storageBeforeWrite,
        storageAfter: storageAfterWrite,
        allocatedBytesDelta: storageAfterWrite.allocatedBytes - storageBeforeWrite.allocatedBytes
      }
    }
  } finally {
    db.close()
  }
}

function assertScenarioEquivalence(current, candidate) {
  for (const [name, currentResult] of Object.entries(current.queries)) {
    const candidateResult = candidate.queries[name]
    if (!candidateResult) throw new Error(`Candidate result missing query ${name}`)
    if (JSON.stringify(currentResult.result) !== JSON.stringify(candidateResult.result)) {
      throw new Error(`Current/candidate query result diverged for ${name}`)
    }
  }
}

function packageVersion(name) {
  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
  return packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name] ?? 'unknown'
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
}

function environmentMetadata() {
  const database = new Database(':memory:')
  let sqliteVersion
  try {
    sqliteVersion = database.prepare('SELECT sqlite_version() AS version').get().version
  } finally {
    database.close()
  }
  const cpu = os.cpus()[0]
  return {
    generatedAt: new Date().toISOString(),
    gitCommit: git(['rev-parse', 'HEAD']),
    gitDirty: git(['status', '--porcelain']).length > 0,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: cpu?.model ?? 'unknown',
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
    nodeModuleAbi: process.versions.modules,
    sqliteVersion,
    betterSqliteVersion: packageVersion('better-sqlite3-multiple-ciphers')
  }
}

function printSummary(result) {
  for (const scale of result.scales) {
    const current = scale.scenarios.current
    console.log(`rows=${scale.rowCount}`)
    for (const [scenarioName, scenario] of Object.entries(scale.scenarios)) {
      if (scenarioName === 'current') continue
      console.log(`  scenario=${scenarioName}`)
      for (const name of Object.keys(current.queries)) {
        const currentMedian = current.queries[name].summary.p50Ms
        const scenarioMedian = scenario.queries[name].summary.p50Ms
        console.log(
          `    ${name}: current=${currentMedian.toFixed(3)}ms scenario=${scenarioMedian.toFixed(3)}ms ratio=${(currentMedian / scenarioMedian).toFixed(2)}x`
        )
      }
      console.log(
        `    indexBytes=${scenario.storageAfterIndexes.allocatedBytes - scenario.storageBeforeIndexes.allocatedBytes}`
      )
      console.log(
        `    writeMs current=${current.incrementalWrite.transactionMs.toFixed(3)} scenario=${scenario.incrementalWrite.transactionMs.toFixed(3)}`
      )
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const environment = environmentMetadata()
  const tempRoot = mkdtempSync(join(tmpdir(), 'deepchat-db-baseline-'))
  const result = {
    schemaVersion: 4,
    environment,
    config: {
      rows: options.rows,
      samples: options.samples,
      warmups: options.warmups,
      writeRows: options.writeRows,
      journalMode: 'WAL',
      pageSize: PAGE_SIZE,
      productionSources: PRODUCTION_SOURCES,
      scenarios: SCENARIOS
    },
    scales: []
  }

  try {
    for (const rowCount of options.rows) {
      const basePath = join(tempRoot, `base-${rowCount}.sqlite`)
      const fixture = createFixture(basePath, rowCount)
      const scenarios = {}
      for (const scenario of SCENARIOS) {
        const scenarioPath = join(tempRoot, `${scenario.name}-${rowCount}.sqlite`)
        copyFileSync(basePath, scenarioPath)
        scenarios[scenario.name] = runScenario(scenarioPath, rowCount, options, scenario)
      }
      for (const scenario of SCENARIOS.slice(1)) {
        assertScenarioEquivalence(scenarios.current, scenarios[scenario.name])
      }
      result.scales.push({
        rowCount,
        fixture,
        scenarios
      })
    }

    if (options.output) {
      mkdirSync(dirname(options.output), { recursive: true })
      writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`)
      console.log(`wrote ${options.output}`)
    }
    printSummary(result)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

main()
