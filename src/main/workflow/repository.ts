import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { JsonValue } from '@shared/contracts/common'
import {
  WORKFLOW_INVOCATION_STATUSES,
  WorkflowEffectStateSchema,
  WorkflowEffectEvidenceSchema,
  WorkflowInvocationFailureSchema,
  WorkflowInvocationSchema,
  WorkflowInvocationStatusSchema,
  WorkflowRunSchema,
  WorkflowTapeLinkReceiptSchema,
  WORKFLOW_STORED_EVIDENCE_MAX_BYTES,
  WORKFLOW_STORED_JSON_MAX_BYTES,
  WORKFLOW_STORED_METADATA_MAX_BYTES,
  type WorkflowEffectState,
  type WorkflowEffectEvidence,
  type WorkflowInvocation,
  type WorkflowInvocationCreateInput,
  type WorkflowInvocationFailure,
  type WorkflowInvocationStatus,
  type WorkflowRun,
  type WorkflowRunCreateInput,
  type WorkflowRunStatus
} from '@shared/workflow/domain'
import type { WorkflowInvocationCounts } from '@shared/workflow/projection'
import {
  WORKFLOW_DEFAULT_INVOCATION_TIMEOUT_MS,
  WORKFLOW_RUNTIME_API_VERSION,
  WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES,
  WorkflowGuestAgentRequestSchema,
  WorkflowInvocationErrorSchema,
  WorkflowRuntimeLimitsSchema
} from '@shared/workflow/runtimeProtocol'
import { canonicalizeWorkflowJson } from './domain/json'
import { createWorkflowChildCorrelationSlot } from './childIdentity'
import type { WorkflowDatabase } from './data/database'
import type { WorkflowInvocationRow } from './data/tables/workflowInvocations'
import type { WorkflowRunRow } from './data/tables/workflowRuns'

const MAX_METADATA_JSON_BYTES = WORKFLOW_STORED_METADATA_MAX_BYTES
const MAX_EVIDENCE_JSON_BYTES = WORKFLOW_STORED_EVIDENCE_MAX_BYTES
const MAX_STORED_JSON_BYTES = WORKFLOW_STORED_JSON_MAX_BYTES
const MAX_RUN_LIST_LIMIT = 500

const StoredIdSchema = z.string().trim().min(1).max(256)
const WorkspacePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => !value.includes('\0'), 'Workspace path cannot contain a NUL byte')
const HashSchema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]+$/)
const AllowedAgentIdsSchema = z.array(StoredIdSchema).min(1).max(32)
const TimestampSchema = z.number().int().nonnegative()
const RunListLimitSchema = z.number().int().min(1).max(MAX_RUN_LIST_LIMIT)

const RUN_TRANSITIONS: Record<WorkflowRunStatus, ReadonlySet<WorkflowRunStatus>> = {
  queued: new Set(['running', 'failed', 'cancelled', 'interrupted']),
  running: new Set([
    'waiting_interaction',
    'cancelling',
    'succeeded',
    'failed',
    'cancelled',
    'interrupted'
  ]),
  waiting_interaction: new Set(['running', 'cancelling', 'failed', 'cancelled', 'interrupted']),
  cancelling: new Set(['failed', 'cancelled', 'interrupted']),
  succeeded: new Set(),
  failed: new Set(['queued']),
  cancelled: new Set(),
  interrupted: new Set(['queued'])
}

const INVOCATION_TRANSITIONS: Record<
  WorkflowInvocationStatus,
  ReadonlySet<WorkflowInvocationStatus>
> = {
  queued: new Set(['admitted', 'failed', 'timed_out', 'cancelled', 'interrupted']),
  admitted: new Set(['running', 'failed', 'timed_out', 'cancelled', 'interrupted']),
  running: new Set([
    'waiting_interaction',
    'succeeded',
    'failed',
    'timed_out',
    'cancelled',
    'interrupted'
  ]),
  waiting_interaction: new Set([
    'running',
    'succeeded',
    'failed',
    'timed_out',
    'cancelled',
    'interrupted'
  ]),
  succeeded: new Set(),
  failed: new Set(),
  timed_out: new Set(),
  cancelled: new Set(),
  interrupted: new Set()
}
const ACTIVE_INVOCATION_STATUSES = new Set<WorkflowInvocationStatus>([
  'queued',
  'admitted',
  'running',
  'waiting_interaction'
])

const EFFECT_RANK: Record<WorkflowEffectState, number> = {
  none: 0,
  read: 1,
  unknown: 2,
  write: 3
}

export interface WorkflowReconciliationResult {
  runsInterrupted: number
  invocationsInterrupted: number
}

export interface WorkflowCancellationReconciliationResult {
  runsCancelled: number
  invocationsCancelled: number
}

export class WorkflowRepository {
  constructor(private readonly database: WorkflowDatabase) {}

  createRun(input: WorkflowRunCreateInput): WorkflowRun {
    const runId = StoredIdSchema.parse(input.id)
    const parentSessionId = StoredIdSchema.parse(input.parentSessionId)
    const parentMessageId =
      input.parentMessageId == null ? null : StoredIdSchema.parse(input.parentMessageId)
    const workspacePath =
      input.workspacePath === null ? null : WorkspacePathSchema.parse(input.workspacePath)
    const capabilityScopeHash = HashSchema.parse(input.capabilityScopeHash)
    const limits = WorkflowRuntimeLimitsSchema.parse(input.limits)
    const scriptSource = input.scriptSource
    const sourceBytes = Buffer.byteLength(scriptSource, 'utf8')
    if (
      sourceBytes === 0 ||
      sourceBytes > limits.maxScriptBytes ||
      sourceBytes > WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES
    ) {
      throw new Error(`Workflow source exceeds its ${limits.maxScriptBytes}-byte run limit.`)
    }

    const allowedAgentIds = [...new Set(AllowedAgentIdsSchema.parse(input.allowedAgentIds))].sort()
    const canonicalInput = canonicalizeWorkflowJson(input.input, {
      maxBytes: limits.maxInputBytes
    })
    const canonicalLimits = canonicalizeWorkflowJson(limits, {
      maxBytes: MAX_METADATA_JSON_BYTES
    })
    const canonicalAllowedAgentIds = canonicalizeWorkflowJson(allowedAgentIds, {
      maxBytes: MAX_METADATA_JSON_BYTES
    })
    const policy = canonicalizeWorkflowJson(
      {
        allowedAgentIds,
        capabilityScopeHash,
        limits,
        runtimeApiVersion: WORKFLOW_RUNTIME_API_VERSION,
        workspacePath
      },
      { maxBytes: MAX_METADATA_JSON_BYTES }
    )
    const budget =
      input.budget == null
        ? null
        : canonicalizeWorkflowJson(input.budget, {
            maxBytes: MAX_METADATA_JSON_BYTES
          }).json
    const namedWorkflowPath = input.namedWorkflowPath?.trim() || null
    if (namedWorkflowPath && namedWorkflowPath.length > 4_096) {
      throw new Error('Named workflow path exceeds 4096 characters.')
    }
    const now = parseTimestamp(input.now ?? Date.now(), 'workflow creation time')

    const db = this.database.getDatabase()
    const parentExists = db.prepare('SELECT 1 FROM new_sessions WHERE id = ?').get(parentSessionId)
    if (!parentExists) {
      throw new Error(`Workflow parent session does not exist: ${parentSessionId}`)
    }

    db.prepare(
      `INSERT INTO workflow_runs (
         run_id,
         parent_session_id,
         parent_message_id,
         named_workflow_path,
         workspace_path,
         capability_scope_hash,
         script_source,
         script_hash,
         input_json,
         runtime_api_version,
         limits_json,
         allowed_agent_ids_json,
         policy_hash,
         budget_json,
         status,
         execution_epoch,
         next_invocation_seq,
         phase_json,
         result_json,
         error_json,
         usage_json,
         cancellation_reason,
         interruption_reason,
         invalidated_from_seq,
         result_delivery_state,
         result_delivery_id,
         created_at,
         started_at,
         updated_at,
         completed_at,
         revision
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 1, 1, NULL, NULL, NULL, NULL,
                 NULL, NULL, NULL, 'not_ready', NULL, ?, NULL, ?, NULL, 0)`
    ).run(
      runId,
      parentSessionId,
      parentMessageId,
      namedWorkflowPath,
      workspacePath,
      capabilityScopeHash,
      scriptSource,
      hashString(scriptSource),
      canonicalInput.json,
      WORKFLOW_RUNTIME_API_VERSION,
      canonicalLimits.json,
      canonicalAllowedAgentIds.json,
      policy.sha256,
      budget,
      now,
      now
    )

    return this.requireRun(runId)
  }

  getRun(runId: string): WorkflowRun | null {
    const row = this.database.workflowRunsTable.get(runId)
    return row ? toWorkflowRun(row) : null
  }

  requireRun(runId: string): WorkflowRun {
    const run = this.getRun(runId)
    if (!run) {
      throw new Error(`Unknown workflow run: ${runId}`)
    }
    return run
  }

  listRunsByParent(parentSessionId: string, limit = 100): WorkflowRun[] {
    const normalizedLimit = RunListLimitSchema.parse(limit)
    return this.database.workflowRunsTable
      .listByParent(parentSessionId, normalizedLimit)
      .map(toWorkflowRun)
  }

  listPendingResultDeliveries(limit = 100): WorkflowRun[] {
    const normalizedLimit = RunListLimitSchema.parse(limit)
    return this.database.workflowRunsTable.listPendingDeliveries(normalizedLimit).map(toWorkflowRun)
  }

  listQueuedRunIds(limit = 100): string[] {
    const normalizedLimit = RunListLimitSchema.parse(limit)
    return this.database.workflowRunsTable.listQueuedIds(normalizedLimit)
  }

  startRun(runId: string, now = Date.now()): WorkflowRun {
    this.requireExecutableRun(runId)
    return this.transitionRun(runId, 'running', now)
  }

  setRunWaiting(runId: string, now = Date.now()): WorkflowRun {
    return this.transitionRun(runId, 'waiting_interaction', now)
  }

  setRunCancelling(runId: string, reason: string, now = Date.now()): WorkflowRun {
    return this.transitionRun(runId, 'cancelling', now, {
      cancellationReason: clampReason(reason)
    })
  }

  failRun(
    runId: string,
    error: z.input<typeof WorkflowInvocationErrorSchema>,
    now = Date.now()
  ): WorkflowRun {
    const parsedError = WorkflowInvocationErrorSchema.parse(error)
    return this.transitionRun(runId, 'failed', now, {
      errorJson: canonicalizeWorkflowJson(parsedError, {
        maxBytes: MAX_METADATA_JSON_BYTES
      }).json,
      completedAt: now
    })
  }

  cancelRun(runId: string, reason: string, now = Date.now()): WorkflowRun {
    return this.transitionRun(runId, 'cancelled', now, {
      cancellationReason: clampReason(reason),
      completedAt: now
    })
  }

  succeedRun(
    runId: string,
    result: JsonValue,
    resultDeliveryId: string,
    usage: JsonValue | null = null,
    now = Date.now()
  ): WorkflowRun {
    const run = this.requireRun(runId)
    const canonicalResult = canonicalizeWorkflowJson(result, {
      maxBytes: run.limits.maxResultBytes
    })
    const canonicalUsage =
      usage == null
        ? null
        : canonicalizeWorkflowJson(usage, {
            maxBytes: MAX_METADATA_JSON_BYTES
          }).json
    return this.transitionRun(runId, 'succeeded', now, {
      resultJson: canonicalResult.json,
      usageJson: canonicalUsage,
      resultDeliveryId: StoredIdSchema.parse(resultDeliveryId),
      resultDeliveryState: 'pending',
      completedAt: now
    })
  }

  resumeRun(runId: string, now = Date.now()): WorkflowRun {
    this.requireExecutableRun(runId)
    const timestamp = parseTimestamp(now, 'workflow resume time')
    const db = this.database.getDatabase()
    const result = db
      .prepare(
        `UPDATE workflow_runs
         SET status = 'running',
             execution_epoch = execution_epoch + 1,
             started_at = COALESCE(started_at, ?),
             updated_at = ?,
             completed_at = NULL,
             error_json = NULL,
             interruption_reason = NULL,
             cancellation_reason = NULL,
             revision = revision + 1
         WHERE run_id = ?
           AND (
             status IN ('failed', 'interrupted')
             OR (status = 'queued' AND started_at IS NOT NULL)
           )
           AND NOT EXISTS (
             SELECT 1
             FROM workflow_invocations
             WHERE workflow_invocations.run_id = workflow_runs.run_id
               AND workflow_invocations.status IN (
                 'queued',
                 'admitted',
                 'running',
                 'waiting_interaction'
               )
           )`
      )
      .run(timestamp, timestamp, runId)
    if (result.changes !== 1) {
      throw new Error(`Workflow run ${runId} cannot be resumed from its current status.`)
    }
    return this.requireRun(runId)
  }

  queueRunResume(runId: string, now = Date.now()): WorkflowRun {
    this.requireExecutableRun(runId)
    const timestamp = parseTimestamp(now, 'workflow resume queue time')
    const result = this.database
      .getDatabase()
      .prepare(
        `UPDATE workflow_runs
         SET status = 'queued',
             updated_at = ?,
             completed_at = NULL,
             phase_json = NULL,
             error_json = NULL,
             interruption_reason = NULL,
             cancellation_reason = NULL,
             revision = revision + 1
         WHERE run_id = ?
           AND status IN ('failed', 'interrupted')
           AND started_at IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
             FROM workflow_invocations
             WHERE workflow_invocations.run_id = workflow_runs.run_id
               AND workflow_invocations.status IN (
                 'queued',
                 'admitted',
                 'running',
                 'waiting_interaction'
               )
           )`
      )
      .run(timestamp, runId)
    if (result.changes !== 1) {
      throw new Error(`Workflow run ${runId} cannot queue a resume from its current status.`)
    }
    return this.requireRun(runId)
  }

  updatePhase(runId: string, phase: JsonValue, now = Date.now()): WorkflowRun {
    const timestamp = parseTimestamp(now, 'workflow phase update time')
    const canonical = canonicalizeWorkflowJson(phase, {
      maxBytes: MAX_METADATA_JSON_BYTES
    })
    const result = this.database
      .getDatabase()
      .prepare(
        `UPDATE workflow_runs
         SET phase_json = ?,
             updated_at = ?,
             revision = revision + 1
         WHERE run_id = ?
           AND status IN ('running', 'waiting_interaction', 'cancelling')`
      )
      .run(canonical.json, timestamp, runId)
    if (result.changes !== 1) {
      throw new Error(`Workflow run ${runId} cannot accept a phase update.`)
    }
    return this.requireRun(runId)
  }

  markResultDelivered(runId: string, deliveryId: string, now = Date.now()): boolean {
    const normalizedDeliveryId = StoredIdSchema.parse(deliveryId)
    const timestamp = parseTimestamp(now, 'workflow result delivery time')
    const db = this.database.getDatabase()
    const update = db
      .prepare(
        `UPDATE workflow_runs
         SET result_delivery_state = 'delivered',
             updated_at = ?,
             revision = revision + 1
         WHERE run_id = ?
           AND result_delivery_state = 'pending'
           AND result_delivery_id = ?`
      )
      .run(timestamp, runId, normalizedDeliveryId)
    if (update.changes === 1) {
      return true
    }

    const row = db
      .prepare(
        `SELECT result_delivery_state, result_delivery_id
         FROM workflow_runs
         WHERE run_id = ?`
      )
      .get(runId) as
      | {
          result_delivery_state: 'not_ready' | 'pending' | 'delivered'
          result_delivery_id: string | null
        }
      | undefined
    return (
      row?.result_delivery_state === 'delivered' && row.result_delivery_id === normalizedDeliveryId
    )
  }

  createInvocation(input: WorkflowInvocationCreateInput): WorkflowInvocation {
    const invocationId = StoredIdSchema.parse(input.id)
    const runId = StoredIdSchema.parse(input.runId)
    const boundedRequest = canonicalizeWorkflowJson(input.request, {
      maxBytes: MAX_STORED_JSON_BYTES
    })
    const request = WorkflowGuestAgentRequestSchema.parse(boundedRequest.value)
    const now = parseTimestamp(input.now ?? Date.now(), 'workflow invocation creation time')
    const db = this.database.getDatabase()

    const row = db.transaction(() => {
      const run = db
        .prepare(
          `SELECT
             status,
             execution_epoch,
             next_invocation_seq,
             policy_hash,
             runtime_api_version,
             workspace_path,
             capability_scope_hash,
             limits_json,
             allowed_agent_ids_json
           FROM workflow_runs
           WHERE run_id = ?`
        )
        .get(runId) as
        | {
            status: WorkflowRunStatus
            execution_epoch: number
            next_invocation_seq: number
            policy_hash: string
            runtime_api_version: number
            workspace_path: string | null
            capability_scope_hash: string
            limits_json: string
            allowed_agent_ids_json: string
          }
        | undefined
      if (!run) {
        throw new Error(`Unknown workflow run: ${runId}`)
      }
      if (run.status !== 'running') {
        throw new Error(`Workflow run ${runId} is not accepting invocations (${run.status}).`)
      }
      const limits = parseStoredJson(
        run.limits_json,
        WorkflowRuntimeLimitsSchema,
        MAX_METADATA_JSON_BYTES,
        'workflow run limits'
      )
      const allowedAgentIds = parseStoredJson(
        run.allowed_agent_ids_json,
        AllowedAgentIdsSchema,
        MAX_METADATA_JSON_BYTES,
        'workflow allowed agents'
      )
      const policy = canonicalizeWorkflowJson(
        {
          allowedAgentIds: [...allowedAgentIds].sort(),
          capabilityScopeHash: run.capability_scope_hash,
          limits,
          runtimeApiVersion: run.runtime_api_version,
          workspacePath: run.workspace_path
        },
        { maxBytes: MAX_METADATA_JSON_BYTES }
      )
      if (
        run.runtime_api_version !== WORKFLOW_RUNTIME_API_VERSION ||
        policy.sha256 !== run.policy_hash
      ) {
        throw new Error(`Stored workflow policy mismatch for run ${runId}.`)
      }
      if (request.options.agentId && !allowedAgentIds.includes(request.options.agentId)) {
        throw new Error(
          `Workflow agent ${request.options.agentId} is outside the launch allowlist.`
        )
      }
      if (boundedRequest.byteLength > limits.maxInputBytes) {
        throw new Error(
          `Workflow invocation request exceeds the ${limits.maxInputBytes}-byte run limit.`
        )
      }
      if (run.next_invocation_seq > limits.maxInvocations) {
        throw new Error(
          `Workflow run ${runId} exceeds its ${limits.maxInvocations}-invocation limit.`
        )
      }
      const activeInvocationCount = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM workflow_invocations
           WHERE run_id = ?
             AND status IN ('queued', 'admitted', 'running', 'waiting_interaction')`
        )
        .get(runId) as { count: number }
      if (activeInvocationCount.count >= limits.maxPendingInvocations) {
        throw new Error(
          `Workflow run ${runId} exceeds its ${limits.maxPendingInvocations}-pending-invocation limit.`
        )
      }

      const attemptRow = db
        .prepare(
          `SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt
           FROM workflow_invocations
           WHERE run_id = ? AND call_path = ?`
        )
        .get(runId, request.callPath) as { attempt: number }
      const childCorrelationSlot = createWorkflowChildCorrelationSlot(
        runId,
        request.callPath,
        attemptRow.attempt
      )

      db.prepare(
        `INSERT INTO workflow_invocations (
           invocation_id,
           run_id,
           seq,
           call_path,
           attempt,
           execution_epoch,
           request_json,
           input_hash,
           policy_hash,
           child_correlation_slot,
           child_session_id,
           status,
           timeout_deadline_at,
           result_json,
           error_json,
           effect_state,
           effect_evidence_json,
           usage_json,
           tape_link_receipt_json,
           invalidated_at,
           invalidation_reason,
           created_at,
           started_at,
           updated_at,
           completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'queued', ?, NULL, NULL, 'none',
                   NULL, NULL, NULL, NULL, NULL, ?, NULL, ?, NULL)`
      ).run(
        invocationId,
        runId,
        run.next_invocation_seq,
        request.callPath,
        attemptRow.attempt,
        run.execution_epoch,
        boundedRequest.json,
        boundedRequest.sha256,
        run.policy_hash,
        childCorrelationSlot,
        null,
        now,
        now
      )

      const sequenceUpdate = db
        .prepare(
          `UPDATE workflow_runs
           SET next_invocation_seq = next_invocation_seq + 1,
               updated_at = ?,
               revision = revision + 1
           WHERE run_id = ?
             AND next_invocation_seq = ?`
        )
        .run(now, runId, run.next_invocation_seq)
      if (sequenceUpdate.changes !== 1) {
        throw new Error(`Workflow invocation sequence changed concurrently for run ${runId}.`)
      }
      return this.database.workflowInvocationsTable.get(invocationId)
    })()

    if (!row) {
      throw new Error(`Failed to persist workflow invocation: ${invocationId}`)
    }
    return toWorkflowInvocation(row)
  }

  getInvocation(invocationId: string): WorkflowInvocation | null {
    const row = this.database.workflowInvocationsTable.get(invocationId)
    return row ? toWorkflowInvocation(row) : null
  }

  requireInvocation(invocationId: string): WorkflowInvocation {
    const invocation = this.getInvocation(invocationId)
    if (!invocation) {
      throw new Error(`Unknown workflow invocation: ${invocationId}`)
    }
    return invocation
  }

  getInvocationByCorrelationSlot(
    runId: string,
    childCorrelationSlot: string
  ): WorkflowInvocation | null {
    const row = this.database.workflowInvocationsTable.getByCorrelationSlot(
      StoredIdSchema.parse(runId),
      StoredIdSchema.parse(childCorrelationSlot)
    )
    return row ? toWorkflowInvocation(row) : null
  }

  getInvocationByChildSessionId(childSessionId: string): WorkflowInvocation | null {
    const row = this.database.workflowInvocationsTable.getByChildSessionId(
      StoredIdSchema.parse(childSessionId)
    )
    return row ? toWorkflowInvocation(row) : null
  }

  listInvocations(runId: string): WorkflowInvocation[] {
    return this.database.workflowInvocationsTable.listByRun(runId).map(toWorkflowInvocation)
  }

  getInvocationCounts(runIds: readonly string[]): Map<string, WorkflowInvocationCounts> {
    const normalizedRunIds = [...new Set(runIds.map((runId) => StoredIdSchema.parse(runId)))]
    if (normalizedRunIds.length > MAX_RUN_LIST_LIMIT) {
      throw new Error(
        `Workflow invocation counts are limited to ${MAX_RUN_LIST_LIMIT} runs per query.`
      )
    }
    const result = new Map(
      normalizedRunIds.map((runId) => [runId, createInvocationCounts()] as const)
    )
    if (normalizedRunIds.length === 0) {
      return result
    }

    const placeholders = normalizedRunIds.map(() => '?').join(', ')
    const rows = this.database
      .getDatabase()
      .prepare(
        `SELECT run_id, status, COUNT(*) AS count
         FROM workflow_invocations
         WHERE run_id IN (${placeholders})
         GROUP BY run_id, status`
      )
      .all(...normalizedRunIds) as Array<{ run_id: string; status: string; count: number }>
    for (const row of rows) {
      const counts = result.get(row.run_id)
      if (!counts || !Number.isSafeInteger(row.count) || row.count < 0) {
        throw new Error(`Stored workflow invocation count is invalid for run ${row.run_id}.`)
      }
      counts[WorkflowInvocationStatusSchema.parse(row.status)] = row.count
    }
    return result
  }

  findLatestAttempt(runId: string, callPath: string): WorkflowInvocation | null {
    const normalizedRunId = StoredIdSchema.parse(runId)
    const normalizedCallPath = WorkflowGuestAgentRequestSchema.shape.callPath.parse(callPath)
    const row = this.database
      .getDatabase()
      .prepare(
        `SELECT *
         FROM workflow_invocations
         WHERE run_id = ?
           AND call_path = ?
         ORDER BY attempt DESC
         LIMIT 1`
      )
      .get(normalizedRunId, normalizedCallPath) as WorkflowInvocationRow | undefined
    return row ? toWorkflowInvocation(row) : null
  }

  findReplayOutcome(
    runId: string,
    request: z.input<typeof WorkflowGuestAgentRequestSchema>
  ): WorkflowInvocation | null {
    const parsedRequest = WorkflowGuestAgentRequestSchema.parse(request)
    const run = this.requireRun(runId)
    const canonicalRequest = canonicalizeWorkflowJson(parsedRequest, {
      maxBytes: MAX_STORED_JSON_BYTES
    })
    const latest = this.findLatestAttempt(runId, parsedRequest.callPath)
    if (
      !latest ||
      latest.inputHash !== canonicalRequest.sha256 ||
      latest.policyHash !== run.policyHash ||
      latest.invalidatedAt !== null
    ) {
      return null
    }
    if (
      latest.status === 'succeeded' &&
      latest.childSessionId !== null &&
      latest.tapeLinkReceipt !== null
    ) {
      return latest
    }
    if ((latest.status === 'failed' || latest.status === 'timed_out') && latest.error !== null) {
      return latest
    }
    return null
  }

  attachChildSession(
    invocationId: string,
    childSessionId: string,
    now = Date.now()
  ): WorkflowInvocation {
    const normalizedChildSessionId = StoredIdSchema.parse(childSessionId)
    const timestamp = parseTimestamp(now, 'workflow child attachment time')
    const db = this.database.getDatabase()
    const childExists = db
      .prepare('SELECT 1 FROM new_sessions WHERE id = ?')
      .get(normalizedChildSessionId)
    if (!childExists) {
      throw new Error(`Workflow child session does not exist: ${normalizedChildSessionId}`)
    }
    const result = db
      .prepare(
        `UPDATE workflow_invocations
         SET child_session_id = ?,
             updated_at = ?
         WHERE invocation_id = ?
           AND (child_session_id IS NULL OR child_session_id = ?)`
      )
      .run(normalizedChildSessionId, timestamp, invocationId, normalizedChildSessionId)
    if (result.changes !== 1) {
      throw new Error(`Workflow invocation ${invocationId} already references another child.`)
    }
    return this.requireInvocation(invocationId)
  }

  markInvocationAdmitted(invocationId: string, now = Date.now()): WorkflowInvocation {
    const invocation = this.requireInvocation(invocationId)
    const timestamp = parseTimestamp(now, 'workflow invocation admission time')
    const timeoutMs = invocation.request.options.timeoutMs ?? WORKFLOW_DEFAULT_INVOCATION_TIMEOUT_MS
    const timeoutDeadlineAt = parseTimestamp(
      timestamp + timeoutMs,
      'workflow invocation timeout deadline'
    )
    return this.transitionInvocation(invocationId, 'admitted', timestamp, {
      timeoutDeadlineAt
    })
  }

  markInvocationRunning(invocationId: string, now = Date.now()): WorkflowInvocation {
    return this.transitionInvocation(invocationId, 'running', now)
  }

  setInvocationWaiting(invocationId: string, now = Date.now()): WorkflowInvocation {
    return this.transitionInvocation(invocationId, 'waiting_interaction', now)
  }

  recordEffectIntent(
    invocationId: string,
    effectState: Exclude<WorkflowEffectState, 'none'>,
    evidence: WorkflowEffectEvidence,
    now = Date.now()
  ): WorkflowInvocation {
    const requested = WorkflowEffectStateSchema.exclude(['none']).parse(effectState)
    const parsedEvidence = WorkflowEffectEvidenceSchema.parse(evidence)
    if (parsedEvidence.classification !== requested) {
      throw new Error('Workflow effect evidence classification does not match its requested state.')
    }
    const timestamp = parseTimestamp(now, 'workflow effect evidence time')
    const canonicalEvidence = canonicalizeWorkflowJson(parsedEvidence, {
      maxBytes: MAX_EVIDENCE_JSON_BYTES
    })
    const result = this.database
      .getDatabase()
      .prepare(
        `UPDATE workflow_invocations
         SET effect_state = CASE
               WHEN effect_state = 'write' THEN 'write'
               WHEN effect_state = 'unknown' AND ? != 'write' THEN 'unknown'
               WHEN effect_state = 'read' AND ? = 'read' THEN 'read'
               ELSE ?
             END,
             effect_evidence_json = CASE
               WHEN effect_state = 'write' AND ? != 'write' THEN effect_evidence_json
               WHEN effect_state = 'unknown' AND ? = 'read' THEN effect_evidence_json
               ELSE ?
             END,
             updated_at = ?
         WHERE invocation_id = ?
           AND status IN ('running', 'waiting_interaction')
           AND EXISTS (
             SELECT 1
             FROM workflow_runs
             WHERE workflow_runs.run_id = workflow_invocations.run_id
               AND workflow_runs.status IN ('running', 'waiting_interaction')
           )`
      )
      .run(
        requested,
        requested,
        requested,
        requested,
        requested,
        canonicalEvidence.json,
        timestamp,
        invocationId
      )
    if (result.changes !== 1) {
      throw new Error(
        `Workflow effect intent could not be persisted before tool execution: ${invocationId}`
      )
    }
    const invocation = this.requireInvocation(invocationId)
    if (EFFECT_RANK[invocation.effectState] < EFFECT_RANK[requested]) {
      throw new Error(`Workflow effect state failed to advance for invocation ${invocationId}.`)
    }
    return invocation
  }

  recordInvocationTapeReceipt(
    invocationId: string,
    tapeLinkReceipt: JsonValue,
    now = Date.now()
  ): WorkflowInvocation {
    const invocation = this.requireInvocation(invocationId)
    if (!invocation.childSessionId) {
      throw new Error(`Workflow invocation ${invocationId} has no durable child session identity.`)
    }
    const run = this.requireRun(invocation.runId)
    const parsedReceipt = WorkflowTapeLinkReceiptSchema.parse(tapeLinkReceipt)
    this.assertTapeReceiptMatches(invocation, run, parsedReceipt)
    const receiptJson = canonicalizeWorkflowJson(parsedReceipt, {
      maxBytes: MAX_EVIDENCE_JSON_BYTES
    }).json
    const timestamp = parseTimestamp(now, 'workflow Tape receipt time')
    const result = this.database
      .getDatabase()
      .prepare(
        `UPDATE workflow_invocations
         SET tape_link_receipt_json = ?,
             updated_at = ?
         WHERE invocation_id = ?
           AND (
             tape_link_receipt_json IS NULL
             OR tape_link_receipt_json = ?
           )`
      )
      .run(receiptJson, timestamp, invocationId, receiptJson)
    if (result.changes !== 1) {
      throw new Error(`Workflow invocation ${invocationId} already has another Tape receipt.`)
    }
    return this.requireInvocation(invocationId)
  }

  succeedInvocation(
    invocationId: string,
    result: JsonValue,
    tapeLinkReceipt: JsonValue,
    usage: JsonValue | null = null,
    now = Date.now()
  ): WorkflowInvocation {
    const invocation = this.requireInvocation(invocationId)
    if (!invocation.childSessionId) {
      throw new Error(`Workflow invocation ${invocationId} has no durable child session identity.`)
    }
    const run = this.requireRun(invocation.runId)
    const maxResultBytes = Math.min(
      invocation.request.options.maxOutputBytes ?? run.limits.maxResultBytes,
      run.limits.maxResultBytes
    )
    const resultJson = canonicalizeWorkflowJson(result, {
      maxBytes: maxResultBytes
    }).json
    const parsedReceipt = WorkflowTapeLinkReceiptSchema.parse(tapeLinkReceipt)
    this.assertTapeReceiptMatches(invocation, run, parsedReceipt)
    if (parsedReceipt.outcome !== 'completed') {
      throw new Error(`Workflow Tape receipt is not a completed outcome for ${invocationId}.`)
    }
    const receiptJson = canonicalizeWorkflowJson(parsedReceipt, {
      maxBytes: MAX_EVIDENCE_JSON_BYTES
    }).json
    if (
      invocation.tapeLinkReceipt !== null &&
      canonicalizeWorkflowJson(invocation.tapeLinkReceipt, {
        maxBytes: MAX_EVIDENCE_JSON_BYTES
      }).json !== receiptJson
    ) {
      throw new Error(`Workflow invocation ${invocationId} already has another Tape receipt.`)
    }
    const usageJson =
      usage == null
        ? null
        : canonicalizeWorkflowJson(usage, {
            maxBytes: MAX_METADATA_JSON_BYTES
          }).json
    return this.transitionInvocation(invocationId, 'succeeded', now, {
      resultJson,
      tapeLinkReceiptJson: receiptJson,
      usageJson,
      completedAt: now
    })
  }

  failInvocation(
    invocationId: string,
    failure: WorkflowInvocationFailure,
    now = Date.now(),
    usage: JsonValue | null = null
  ): WorkflowInvocation {
    const parsedFailure = WorkflowInvocationFailureSchema.parse(failure)
    const usageJson =
      usage == null
        ? null
        : canonicalizeWorkflowJson(usage, {
            maxBytes: MAX_METADATA_JSON_BYTES
          }).json
    return this.transitionInvocation(invocationId, parsedFailure.status, now, {
      errorJson: canonicalizeWorkflowJson(parsedFailure.error, {
        maxBytes: MAX_METADATA_JSON_BYTES
      }).json,
      usageJson,
      completedAt: now
    })
  }

  recordTerminalInvocationUsage(
    invocationId: string,
    usage: JsonValue,
    now = Date.now()
  ): WorkflowInvocation {
    const normalizedInvocationId = StoredIdSchema.parse(invocationId)
    const usageJson = canonicalizeWorkflowJson(usage, {
      maxBytes: MAX_METADATA_JSON_BYTES
    }).json
    const timestamp = parseTimestamp(now, 'workflow terminal usage time')
    const current = this.requireInvocation(normalizedInvocationId)
    if (ACTIVE_INVOCATION_STATUSES.has(current.status)) {
      throw new Error(
        `Workflow invocation ${normalizedInvocationId} is still active and cannot accept terminal usage.`
      )
    }
    if (current.usage !== null) {
      return current
    }
    this.database
      .getDatabase()
      .prepare(
        `UPDATE workflow_invocations
         SET usage_json = ?,
             updated_at = ?
         WHERE invocation_id = ?
           AND usage_json IS NULL
           AND status IN ('succeeded', 'failed', 'timed_out', 'cancelled', 'interrupted')`
      )
      .run(usageJson, timestamp, normalizedInvocationId)
    return this.requireInvocation(normalizedInvocationId)
  }

  invalidateFrom(runId: string, seq: number, reason: string, now = Date.now()): number {
    if (!Number.isInteger(seq) || seq < 1) {
      throw new Error('Workflow invalidation sequence must be a positive integer.')
    }
    const normalizedReason = clampReason(reason)
    const timestamp = parseTimestamp(now, 'workflow invalidation time')
    const db = this.database.getDatabase()
    return db.transaction(() => {
      const target = db
        .prepare(
          `SELECT workflow_runs.status
           FROM workflow_runs
           INNER JOIN workflow_invocations
             ON workflow_invocations.run_id = workflow_runs.run_id
           WHERE workflow_runs.run_id = ?
             AND workflow_invocations.seq = ?`
        )
        .get(runId, seq) as { status: WorkflowRunStatus } | undefined
      if (!target) {
        throw new Error(`Workflow run ${runId} has no invocation at sequence ${seq}.`)
      }
      if (target.status !== 'failed' && target.status !== 'interrupted') {
        throw new Error(`Workflow run ${runId} must be failed or interrupted before invalidation.`)
      }
      const update = db
        .prepare(
          `UPDATE workflow_invocations
           SET invalidated_at = COALESCE(invalidated_at, ?),
               invalidation_reason = COALESCE(invalidation_reason, ?),
               updated_at = ?
           WHERE run_id = ?
             AND seq >= ?`
        )
        .run(timestamp, normalizedReason, timestamp, runId, seq)
      const runUpdate = db
        .prepare(
          `UPDATE workflow_runs
           SET invalidated_from_seq = CASE
                 WHEN invalidated_from_seq IS NULL OR invalidated_from_seq > ? THEN ?
                 ELSE invalidated_from_seq
               END,
               updated_at = ?,
               revision = revision + 1
           WHERE run_id = ?`
        )
        .run(seq, seq, timestamp, runId)
      if (runUpdate.changes !== 1) {
        throw new Error(`Unknown workflow run: ${runId}`)
      }
      return update.changes
    })()
  }

  invalidateInvocation(
    runId: string,
    invocationId: string,
    reason: string,
    now = Date.now()
  ): WorkflowInvocation {
    const normalizedRunId = StoredIdSchema.parse(runId)
    const normalizedInvocationId = StoredIdSchema.parse(invocationId)
    const normalizedReason = clampReason(reason)
    const timestamp = parseTimestamp(now, 'workflow invocation invalidation time')
    const db = this.database.getDatabase()
    const result = db
      .prepare(
        `UPDATE workflow_invocations
         SET invalidated_at = COALESCE(invalidated_at, ?),
             invalidation_reason = COALESCE(invalidation_reason, ?),
             updated_at = ?
         WHERE invocation_id = ?
           AND run_id = ?
           AND EXISTS (
             SELECT 1
             FROM workflow_runs
             WHERE workflow_runs.run_id = workflow_invocations.run_id
               AND workflow_runs.status IN ('failed', 'interrupted')
           )`
      )
      .run(timestamp, normalizedReason, timestamp, normalizedInvocationId, normalizedRunId)
    if (result.changes !== 1) {
      throw new Error(
        `Workflow invocation ${normalizedInvocationId} cannot be invalidated for run ${normalizedRunId}.`
      )
    }
    return this.requireInvocation(normalizedInvocationId)
  }

  reconcileInterruptedRun(
    runId: string,
    reason: string,
    now = Date.now()
  ): WorkflowReconciliationResult {
    return this.reconcileInterrupted(reason, now, runId)
  }

  reconcileInterruptedRuns(reason: string, now = Date.now()): WorkflowReconciliationResult {
    return this.reconcileInterrupted(reason, now)
  }

  reconcileCancelledRun(
    runId: string,
    reason: string,
    now = Date.now()
  ): WorkflowCancellationReconciliationResult {
    const normalizedRunId = StoredIdSchema.parse(runId)
    const timestamp = parseTimestamp(now, 'workflow cancellation reconciliation time')
    const normalizedReason = clampReason(reason)
    const errorJson = canonicalizeWorkflowJson(
      {
        code: 'WORKFLOW_CANCELLED',
        message: normalizedReason,
        retriable: true
      },
      { maxBytes: MAX_METADATA_JSON_BYTES }
    ).json
    const db = this.database.getDatabase()
    return db.transaction(() => {
      const invocationResult = db
        .prepare(
          `UPDATE workflow_invocations
           SET status = 'cancelled',
               error_json = ?,
               completed_at = ?,
               updated_at = ?
           WHERE run_id = ?
             AND status IN ('queued', 'admitted', 'running', 'waiting_interaction')`
        )
        .run(errorJson, timestamp, timestamp, normalizedRunId)
      const runResult = db
        .prepare(
          `UPDATE workflow_runs
           SET status = 'cancelled',
               cancellation_reason = ?,
               completed_at = ?,
               updated_at = ?,
               revision = revision + 1
           WHERE run_id = ?
             AND status IN ('queued', 'running', 'waiting_interaction', 'cancelling')`
        )
        .run(normalizedReason, timestamp, timestamp, normalizedRunId)
      return {
        runsCancelled: runResult.changes,
        invocationsCancelled: invocationResult.changes
      }
    })()
  }

  private transitionRun(
    runId: string,
    nextStatus: WorkflowRunStatus,
    now: number,
    fields: {
      errorJson?: string | null
      resultJson?: string | null
      usageJson?: string | null
      cancellationReason?: string | null
      resultDeliveryState?: 'not_ready' | 'pending' | 'delivered'
      resultDeliveryId?: string | null
      completedAt?: number | null
    } = {}
  ): WorkflowRun {
    const timestamp = parseTimestamp(now, 'workflow transition time')
    const current = this.requireRun(runId)
    if (!RUN_TRANSITIONS[current.status].has(nextStatus)) {
      throw new Error(
        `Illegal workflow run transition ${current.status} -> ${nextStatus} for ${runId}.`
      )
    }
    const startedAt =
      nextStatus === 'running' ? (current.startedAt ?? timestamp) : current.startedAt
    const requiresSettledInvocations = ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(
      nextStatus
    )
      ? 1
      : 0
    const result = this.database
      .getDatabase()
      .prepare(
        `UPDATE workflow_runs
         SET status = ?,
             started_at = ?,
             updated_at = ?,
             completed_at = ?,
             error_json = ?,
             result_json = ?,
             usage_json = ?,
             cancellation_reason = ?,
             result_delivery_state = ?,
             result_delivery_id = ?,
             revision = revision + 1
         WHERE run_id = ?
           AND status = ?
           AND (
             ? = 0
             OR NOT EXISTS (
               SELECT 1
               FROM workflow_invocations
               WHERE workflow_invocations.run_id = workflow_runs.run_id
                 AND workflow_invocations.status IN (
                   'queued',
                   'admitted',
                   'running',
                   'waiting_interaction'
                 )
             )
           )`
      )
      .run(
        nextStatus,
        startedAt,
        timestamp,
        fields.completedAt ?? current.completedAt,
        fields.errorJson ?? (current.error == null ? null : JSON.stringify(current.error)),
        fields.resultJson ?? (current.result == null ? null : JSON.stringify(current.result)),
        fields.usageJson ?? (current.usage == null ? null : JSON.stringify(current.usage)),
        fields.cancellationReason ?? current.cancellationReason,
        fields.resultDeliveryState ?? current.resultDeliveryState,
        fields.resultDeliveryId ?? current.resultDeliveryId,
        runId,
        current.status,
        requiresSettledInvocations
      )
    if (result.changes !== 1) {
      if (requiresSettledInvocations === 1) {
        throw new Error(
          `Workflow run ${runId} cannot enter ${nextStatus} while an invocation is active or its state changed concurrently.`
        )
      }
      throw new Error(`Workflow run ${runId} changed concurrently.`)
    }
    return this.requireRun(runId)
  }

  private assertTapeReceiptMatches(
    invocation: WorkflowInvocation,
    run: WorkflowRun,
    receipt: z.infer<typeof WorkflowTapeLinkReceiptSchema>
  ): void {
    if (receipt.childSessionId !== invocation.childSessionId) {
      throw new Error(`Workflow Tape receipt child does not match invocation ${invocation.id}.`)
    }
    if (receipt.linkEntry.sessionId !== run.parentSessionId) {
      throw new Error(`Workflow Tape receipt parent does not match invocation ${invocation.id}.`)
    }
  }

  private transitionInvocation(
    invocationId: string,
    nextStatus: WorkflowInvocationStatus,
    now: number,
    fields: {
      resultJson?: string | null
      errorJson?: string | null
      usageJson?: string | null
      tapeLinkReceiptJson?: string | null
      completedAt?: number | null
      timeoutDeadlineAt?: number
    } = {}
  ): WorkflowInvocation {
    const timestamp = parseTimestamp(now, 'workflow invocation transition time')
    const current = this.requireInvocation(invocationId)
    if (!INVOCATION_TRANSITIONS[current.status].has(nextStatus)) {
      throw new Error(
        `Illegal workflow invocation transition ${current.status} -> ${nextStatus} for ${invocationId}.`
      )
    }
    const startedAt =
      nextStatus === 'running' ? (current.startedAt ?? timestamp) : current.startedAt
    const requiresActiveRun =
      nextStatus === 'admitted' ||
      nextStatus === 'running' ||
      nextStatus === 'waiting_interaction' ||
      nextStatus === 'succeeded'
        ? 1
        : 0
    const hasTimeoutDeadline = fields.timeoutDeadlineAt !== undefined
    const values: Array<string | number | null> = [
      nextStatus,
      startedAt,
      timestamp,
      fields.completedAt ?? current.completedAt,
      fields.resultJson ?? (current.result == null ? null : JSON.stringify(current.result)),
      fields.errorJson ?? (current.error == null ? null : JSON.stringify(current.error)),
      fields.usageJson ?? (current.usage == null ? null : JSON.stringify(current.usage)),
      fields.tapeLinkReceiptJson ??
        (current.tapeLinkReceipt == null ? null : JSON.stringify(current.tapeLinkReceipt))
    ]
    if (hasTimeoutDeadline) {
      values.push(fields.timeoutDeadlineAt!)
    }
    values.push(invocationId, current.status, requiresActiveRun)

    const result = this.database
      .getDatabase()
      .prepare(
        `UPDATE workflow_invocations
         SET status = ?,
             started_at = ?,
             updated_at = ?,
             completed_at = ?,
             result_json = ?,
             error_json = ?,
             usage_json = ?,
             tape_link_receipt_json = ?
             ${hasTimeoutDeadline ? ', timeout_deadline_at = ?' : ''}
         WHERE invocation_id = ?
           AND status = ?
           AND (
             ? = 0
             OR EXISTS (
               SELECT 1
               FROM workflow_runs
               WHERE workflow_runs.run_id = workflow_invocations.run_id
                 AND workflow_runs.status IN ('running', 'waiting_interaction')
             )
           )`
      )
      .run(...values)
    if (result.changes !== 1) {
      if (requiresActiveRun === 1) {
        throw new Error(
          `Workflow invocation ${invocationId} cannot enter ${nextStatus} after its run stopped or its state changed concurrently.`
        )
      }
      throw new Error(`Workflow invocation ${invocationId} changed concurrently.`)
    }
    return this.requireInvocation(invocationId)
  }

  private reconcileInterrupted(
    reason: string,
    now: number,
    runId?: string
  ): WorkflowReconciliationResult {
    const timestamp = parseTimestamp(now, 'workflow reconciliation time')
    const normalizedReason = clampReason(reason)
    const errorJson = canonicalizeWorkflowJson(
      {
        code: 'WORKFLOW_INTERRUPTED',
        message: normalizedReason,
        retriable: true
      },
      { maxBytes: MAX_METADATA_JSON_BYTES }
    ).json
    const db = this.database.getDatabase()
    return db.transaction(() => {
      const invocationResult = db
        .prepare(
          `UPDATE workflow_invocations
           SET status = 'interrupted',
               error_json = ?,
               completed_at = ?,
               updated_at = ?
           WHERE status IN ('queued', 'admitted', 'running', 'waiting_interaction')
             AND (? IS NULL OR run_id = ?)`
        )
        .run(errorJson, timestamp, timestamp, runId ?? null, runId ?? null)
      const runResult = db
        .prepare(
          `UPDATE workflow_runs
           SET status = 'interrupted',
               error_json = ?,
               interruption_reason = ?,
               completed_at = ?,
               updated_at = ?,
               revision = revision + 1
           WHERE status IN ('running', 'waiting_interaction', 'cancelling')
             AND (? IS NULL OR run_id = ?)`
        )
        .run(errorJson, normalizedReason, timestamp, timestamp, runId ?? null, runId ?? null)
      return {
        runsInterrupted: runResult.changes,
        invocationsInterrupted: invocationResult.changes
      }
    })()
  }

  private requireExecutableRun(runId: string): WorkflowRun {
    const run = this.requireRun(runId)
    if (run.runtimeApiVersion !== WORKFLOW_RUNTIME_API_VERSION) {
      throw new Error(
        `Workflow run ${runId} requires unsupported runtime API v${run.runtimeApiVersion}.`
      )
    }
    if (hashString(run.scriptSource) !== run.scriptHash) {
      throw new Error(`Stored workflow source hash mismatch for run ${runId}.`)
    }
    const policy = canonicalizeWorkflowJson(
      {
        allowedAgentIds: [...run.allowedAgentIds].sort(),
        capabilityScopeHash: run.capabilityScopeHash,
        limits: run.limits,
        runtimeApiVersion: run.runtimeApiVersion,
        workspacePath: run.workspacePath
      },
      { maxBytes: MAX_METADATA_JSON_BYTES }
    )
    if (policy.sha256 !== run.policyHash) {
      throw new Error(`Stored workflow policy hash mismatch for run ${runId}.`)
    }
    return run
  }
}

function toWorkflowRun(row: WorkflowRunRow): WorkflowRun {
  const sourceBytes = Buffer.byteLength(row.script_source, 'utf8')
  if (sourceBytes === 0 || sourceBytes > WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES) {
    throw new Error(
      `Stored workflow source is invalid: expected 1-${WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES} bytes.`
    )
  }
  const limits = parseStoredJson(
    row.limits_json,
    WorkflowRuntimeLimitsSchema,
    MAX_METADATA_JSON_BYTES,
    'workflow run limits'
  )
  const allowedAgentIds = parseStoredJson(
    row.allowed_agent_ids_json,
    AllowedAgentIdsSchema,
    MAX_METADATA_JSON_BYTES,
    'workflow allowed agents'
  )
  return WorkflowRunSchema.parse({
    id: row.run_id,
    parentSessionId: row.parent_session_id,
    parentMessageId: row.parent_message_id,
    namedWorkflowPath: row.named_workflow_path,
    workspacePath: row.workspace_path,
    capabilityScopeHash: row.capability_scope_hash,
    scriptSource: row.script_source,
    scriptHash: row.script_hash,
    input: parseStoredJsonValue(row.input_json, limits.maxInputBytes, 'workflow input'),
    runtimeApiVersion: row.runtime_api_version,
    limits,
    allowedAgentIds,
    policyHash: row.policy_hash,
    budget: parseNullableJsonValue(row.budget_json, MAX_METADATA_JSON_BYTES, 'workflow budget'),
    status: row.status,
    executionEpoch: row.execution_epoch,
    nextInvocationSeq: row.next_invocation_seq,
    phase: parseNullableJsonValue(row.phase_json, MAX_METADATA_JSON_BYTES, 'workflow phase'),
    result: parseNullableJsonValue(row.result_json, limits.maxResultBytes, 'workflow result'),
    error: parseNullableStoredJson(
      row.error_json,
      WorkflowInvocationErrorSchema,
      MAX_METADATA_JSON_BYTES,
      'workflow error'
    ),
    usage: parseNullableJsonValue(row.usage_json, MAX_METADATA_JSON_BYTES, 'workflow usage'),
    cancellationReason: row.cancellation_reason,
    interruptionReason: row.interruption_reason,
    invalidatedFromSeq: row.invalidated_from_seq,
    resultDeliveryState: row.result_delivery_state,
    resultDeliveryId: row.result_delivery_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    revision: row.revision
  })
}

function toWorkflowInvocation(row: WorkflowInvocationRow): WorkflowInvocation {
  const request = parseStoredJson(
    row.request_json,
    WorkflowGuestAgentRequestSchema,
    MAX_STORED_JSON_BYTES,
    'workflow invocation request'
  )
  const canonicalRequest = canonicalizeWorkflowJson(request, {
    maxBytes: MAX_STORED_JSON_BYTES
  })
  if (canonicalRequest.sha256 !== row.input_hash) {
    throw new Error(`Stored workflow invocation request hash mismatch: ${row.invocation_id}`)
  }
  return WorkflowInvocationSchema.parse({
    id: row.invocation_id,
    runId: row.run_id,
    seq: row.seq,
    callPath: row.call_path,
    attempt: row.attempt,
    executionEpoch: row.execution_epoch,
    request,
    inputHash: row.input_hash,
    policyHash: row.policy_hash,
    childCorrelationSlot: row.child_correlation_slot,
    childSessionId: row.child_session_id,
    status: row.status,
    timeoutDeadlineAt: row.timeout_deadline_at,
    result: parseNullableJsonValue(
      row.result_json,
      MAX_STORED_JSON_BYTES,
      'workflow invocation result'
    ),
    error: parseNullableStoredJson(
      row.error_json,
      WorkflowInvocationErrorSchema,
      MAX_METADATA_JSON_BYTES,
      'workflow invocation error'
    ),
    effectState: row.effect_state,
    effectEvidence: parseNullableStoredJson(
      row.effect_evidence_json,
      WorkflowEffectEvidenceSchema,
      MAX_EVIDENCE_JSON_BYTES,
      'workflow effect evidence'
    ),
    usage: parseNullableJsonValue(
      row.usage_json,
      MAX_METADATA_JSON_BYTES,
      'workflow invocation usage'
    ),
    tapeLinkReceipt: parseNullableJsonValue(
      row.tape_link_receipt_json,
      MAX_EVIDENCE_JSON_BYTES,
      'workflow Tape link receipt'
    ),
    invalidatedAt: row.invalidated_at,
    invalidationReason: row.invalidation_reason,
    createdAt: row.created_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  })
}

function parseStoredJson<T>(
  json: string,
  schema: z.ZodType<T>,
  maxBytes: number,
  label: string
): T {
  try {
    const byteLength = Buffer.byteLength(json, 'utf8')
    if (byteLength > maxBytes) {
      throw new Error(`stored value exceeds the ${maxBytes}-byte limit (${byteLength} bytes)`)
    }
    const canonical = canonicalizeWorkflowJson(JSON.parse(json), { maxBytes })
    return schema.parse(canonical.value)
  } catch (error) {
    throw new Error(
      `Stored ${label} is invalid: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function parseNullableStoredJson<T>(
  json: string | null,
  schema: z.ZodType<T>,
  maxBytes: number,
  label: string
): T | null {
  return json == null ? null : parseStoredJson(json, schema, maxBytes, label)
}

function parseStoredJsonValue(json: string, maxBytes: number, label: string): JsonValue {
  return parseStoredJson(json, z.json(), maxBytes, label)
}

function parseNullableJsonValue(
  json: string | null,
  maxBytes: number,
  label: string
): JsonValue | null {
  return json == null ? null : parseStoredJsonValue(json, maxBytes, label)
}

function hashString(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function createInvocationCounts(): WorkflowInvocationCounts {
  return Object.fromEntries(
    WORKFLOW_INVOCATION_STATUSES.map((status) => [status, 0])
  ) as WorkflowInvocationCounts
}

function clampReason(reason: string): string {
  const normalized = reason.trim() || 'Workflow state changed without a reason.'
  return normalized.slice(0, 8_192)
}

function parseTimestamp(value: number, label: string): number {
  const parsed = TimestampSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return parsed.data
}
