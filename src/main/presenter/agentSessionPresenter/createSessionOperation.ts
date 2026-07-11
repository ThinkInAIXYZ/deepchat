import { createHash } from 'node:crypto'
import type { CreateSessionOperationSummary } from '@shared/contracts/routes/sessions.routes'
import type { SessionCreateOperationRow } from '../sqlitePresenter/tables/sessionCreateOperations'

function normalizeForFingerprint(value: unknown): unknown {
  if (value instanceof Date) {
    return { $date: value.toISOString() }
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForFingerprint)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeForFingerprint(entry)])
    )
  }
  return value
}

export function fingerprintCreateSessionInput(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizeForFingerprint(input)))
    .digest('hex')
}

export function toCreateOperationSummary(
  row: SessionCreateOperationRow
): CreateSessionOperationSummary {
  return {
    operationId: row.operation_id,
    sessionId: row.session_id,
    state: row.state,
    stage: row.stage,
    code: row.error_code,
    dismissedAt: row.dismissed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class ExistingCreateOperationError extends Error {
  readonly code = 'CREATE_OPERATION_EXISTS' as const

  constructor(readonly operation: CreateSessionOperationSummary) {
    super('An unresolved session create operation already exists')
    this.name = 'ExistingCreateOperationError'
  }
}

export class CreateOperationConflictError extends Error {
  readonly code = 'CREATE_OPERATION_CONFLICT' as const

  constructor(readonly operation: CreateSessionOperationSummary) {
    super('The session create operation id belongs to different input')
    this.name = 'CreateOperationConflictError'
  }
}
