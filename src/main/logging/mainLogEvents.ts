import { createHash } from 'node:crypto'
import { types as utilTypes } from 'node:util'
import type { DatabaseRepairReason } from '@shared/notifications'
import type { ExecutionRunKind, ExecutionRunOutcome } from '@/tape/domain/executionJournal'
import { MAX_DIAGNOSTIC_DISTRIBUTION_SAMPLES } from '@/lib/boundedNumberRing'

export const MAIN_LOG_ERROR_CATEGORIES = [
  'aborted',
  'timeout',
  'queue_full',
  'closed',
  'permission',
  'provider',
  'persistence',
  'protocol',
  'integrity',
  'configuration',
  'resource',
  'unknown'
] as const

export type MainLogErrorCategory = (typeof MAIN_LOG_ERROR_CATEGORIES)[number]
const FATAL_ERROR_CATEGORIES = [
  'aborted',
  'timeout',
  'unknown'
] as const satisfies readonly MainLogErrorCategory[]
export type MainLogLevel = 'error' | 'warn' | 'info'
export type MainLogShutdownReason =
  | 'all_windows_closed'
  | 'app_quit'
  | 'data_reset'
  | 'restart'
  | 'update_install'
  | 'unknown'

export interface SafeLogError {
  category: MainLogErrorCategory
  retryable?: boolean
}

type MainLogDatabaseError =
  | { category: 'integrity' | 'persistence' }
  | { category: 'schema'; reason: DatabaseRepairReason }

export type MainLogStartupComponentFailureCategory =
  | 'configuration'
  | 'persistence'
  | 'resource'
  | 'unknown'

interface MainLogStartupComponentError {
  category: MainLogStartupComponentFailureCategory
}

interface MainLogUpdateOperationError {
  category: 'persistence' | 'provider' | 'unknown'
}

export type MainLogUpdateOperation =
  | 'check'
  | 'download'
  | 'install'
  | 'install_verification'
  | 'marker_reconcile'
  | 'marker_write'
  | 'runtime'

export type MainLogStartupComponent =
  | 'acp_install_compensation'
  | 'acp_registry_migration'
  | 'cli_control'
  | 'cli_launcher'
  | 'disabled_agent_tool_capability_cleanup'
  | 'floating_widget'
  | 'legacy_import'
  | 'mcp'
  | 'mcp_integration'
  | 'plugin_host'
  | 'plugin_runtime'
  | 'remote_runtime'
  | 'rtk_health_check'
  | 'skill_sync'
  | 'sqlite_mainline_normalization'
  | 'toolchain_gc'
  | 'usage_stats_backfill'

export type MainLogJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly MainLogJsonValue[]
  | { readonly [key: string]: MainLogJsonValue }

export type MainLogContext = Readonly<Record<string, MainLogJsonValue>>

export interface MainLogDistribution {
  samples: number
  p50: number | null
  p95: number | null
  max: number | null
}

export interface MainLogAdmissionCorrelation {
  kind: 'live_delegation'
  parentSessionId: string
  delegationId: string
  turnId: string
}

export type MainLogRunStopReason =
  | 'complete'
  | 'context_window'
  | 'empty_response'
  | 'interaction'
  | 'journal_error'
  | 'max_tokens'
  | 'max_tool_calls'
  | 'max_turn_requests'
  | 'max_turns'
  | 'no_progress'
  | 'pending_input'
  | 'post_dispatch_permission'
  | 'pre_dispatch_error'
  | 'pre_stream_error'
  | 'provider_error'
  | 'tool_error'
  | 'tool_result'
  | 'unknown'
  | 'user_follow_up'
  | 'user_stop'

type MainLogAppTerminalInput =
  | {
      outcome: 'completed'
      durationMs?: number
    }
  | {
      outcome: 'failed'
      durationMs?: number
      error: SafeLogError
    }

type MainLogDatabaseInitializationInput = {
  durationMs?: number
  repairAttempted: boolean
  schemaDiagnosis: 'completed' | 'unavailable' | 'not_completed'
  repairableIssueCount: number
  manualIssueCount: number
} & (
  | { outcome: 'completed' }
  | {
      outcome: 'failed'
      error: MainLogDatabaseError
    }
)

type MainLogStartupComponentFailureInput = {
  startupRunId: string
  component: MainLogStartupComponent
  error: MainLogStartupComponentError
}

interface MainLogRunIdentity {
  runId: string
  sessionId: string
  messageId: string
}

type MainLogRunStartedInput = MainLogRunIdentity &
  (
    | {
        runKind: 'loop'
        initialRequestSeq: number
      }
    | {
        runKind: 'deferred_tool'
      }
  )

interface MainLogRunTerminalBase extends MainLogRunIdentity {
  runKind: ExecutionRunKind
  stopReason: MainLogRunStopReason
  durationMs?: number
}

type MainLogRunTerminalInput = MainLogRunTerminalBase &
  (
    | {
        outcome: Exclude<ExecutionRunOutcome, 'error'>
      }
    | {
        outcome: 'error'
        error: SafeLogError
      }
  ) &
  (
    | {
        runKind: 'loop'
        logicalRounds: number
        toolCalls: number
      }
    | {
        runKind: 'deferred_tool'
      }
  )

export interface MainLogEventInputMap {
  'logging.startup_buffer.dropped': {
    droppedCount: number
  }
  'logging.record.dropped': {
    recordSeq: number
    reason: 'record_oversized' | 'record_rejected'
  }
  'process.uncaught_exception': {
    error: unknown
  }
  'process.unhandled_rejection': {
    error: unknown
  }
  'app.startup.started': {
    startupRunId: string
    argumentCount: number
    deepLinkPresent: boolean
  }
  'app.startup.terminal': {
    startupRunId: string
  } & MainLogAppTerminalInput
  'app.startup.component.failed': MainLogStartupComponentFailureInput
  'app.update.operation.failed': {
    operation: MainLogUpdateOperation
    error: MainLogUpdateOperationError
  }
  'app.shutdown.started': {
    reason: MainLogShutdownReason
  }
  'app.shutdown.terminal': MainLogAppTerminalInput
  'app.shutdown.action.failed': {
    reason: MainLogShutdownReason
    durationMs?: number
    error: SafeLogError
  }
  'database.initialization.terminal': MainLogDatabaseInitializationInput
  'agent.run.started': MainLogRunStartedInput
  'agent.run.terminal': MainLogRunTerminalInput
  'agent.admission.queued': MainLogAdmissionCorrelation & {
    acquisitionSeq: number
    capacity: number
    active: number
    pending: number
  }
  'agent.admission.granted': MainLogAdmissionCorrelation & {
    acquisitionSeq: number
    waitMs?: number
    capacity: number
    active: number
    pending: number
  }
  'agent.admission.released': MainLogAdmissionCorrelation & {
    acquisitionSeq: number
    holdMs?: number
    reason: 'permit_released' | 'lease_suspended' | 'lease_released'
    active: number
    pending: number
  }
  'agent.admission.rejected': MainLogAdmissionCorrelation & {
    acquisitionSeq: number
    waitMs?: number
    reason: 'queue_full' | 'aborted' | 'closed'
    capacity: number
    active: number
    pending: number
  }
  'agent.admission.closed': {
    capacity: number
    active: number
    pending: number
    activeHighWater: number
    pendingHighWater: number
    granted: number
    rejected: number
    observationsDropped: number
    waitMs: MainLogDistribution
    holdMs: MainLogDistribution
  }
  'orchestration.delegation.turn.queued': {
    parentSessionId: string
    delegationId: string
    turnId: string
    turnKind: 'initial' | 'follow_up'
  }
  'orchestration.delegation.child.bound': {
    parentSessionId: string
    childSessionId: string
    delegationId: string
    turnId: string
  }
  'orchestration.delegation.turn.started': {
    parentSessionId: string
    childSessionId: string
    delegationId: string
    turnId: string
    turnKind: 'initial' | 'follow_up'
  }
  'orchestration.delegation.turn.suspended': {
    parentSessionId: string
    childSessionId: string
    delegationId: string
    turnId: string
    reason: 'permission' | 'question'
  }
  'orchestration.delegation.turn.resumed': {
    parentSessionId: string
    childSessionId: string
    delegationId: string
    turnId: string
  }
  'orchestration.delegation.turn.terminal': {
    parentSessionId: string
    childSessionId?: string
    delegationId: string
    turnId: string
    durationMs?: number
  } & (
    | { status: 'completed' | 'cancelled' | 'interrupted' }
    | { status: 'failed'; error: SafeLogError }
  )
  'orchestration.delegation.reconciliation.terminal': {
    parentSessionId: string
    childSessionId?: string
    delegationId: string
    turnId: string
  } & ({ outcome: 'settled' } | { outcome: 'quarantined' | 'failed'; error: SafeLogError })
  'orchestration.delegation.stale_result.rejected': {
    parentSessionId: string
    childSessionId: string
    delegationId: string
    turnId: string
    reason: 'recovered_result_predates_turn'
  }
  'orchestration.delegation.observations.dropped': {
    droppedCount: number
  }
}

export type MainLogEventName = keyof MainLogEventInputMap

export interface ProjectedMainLogEvent {
  level: MainLogLevel
  context: MainLogContext
}

interface MainLogEventDefinition<TInput> {
  inputFields: readonly StringKeyOf<TInput>[]
  level: MainLogLevel | ((input: TInput) => MainLogLevel)
  project: (input: TInput, options: MainLogProjectionOptions) => MainLogContext
}

interface MainLogProjectionOptions {
  acceptCorrelationFingerprints: boolean
}

type StringKeyOf<T> = T extends unknown ? Extract<keyof T, string> : never

type MainLogEventDefinitions = {
  [TEvent in MainLogEventName]: MainLogEventDefinition<MainLogEventInputMap[TEvent]>
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]+$/
const MAX_IDENTIFIER_LENGTH = 256
const CORRELATION_FINGERPRINT_PREFIX = 'sha256:'
const CORRELATION_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/
const MAX_ERROR_NAME_LENGTH = 128
const EMISSION_PROJECTION_OPTIONS: MainLogProjectionOptions = {
  acceptCorrelationFingerprints: false
}
const VALIDATION_PROJECTION_OPTIONS: MainLogProjectionOptions = {
  acceptCorrelationFingerprints: true
}
export const MAX_MAIN_LOG_DURATION_MS = 30 * 24 * 60 * 60 * 1000
const DOM_EXCEPTION_NAME_GETTER =
  typeof DOMException === 'undefined'
    ? undefined
    : Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')?.get

const RUN_KIND_VALUES = {
  loop: 'loop',
  deferred_tool: 'deferred_tool'
} as const satisfies Record<ExecutionRunKind, ExecutionRunKind>
const RUN_KINDS = Object.values(RUN_KIND_VALUES)
const RUN_OUTCOME_VALUES = {
  completed: 'completed',
  paused: 'paused',
  aborted: 'aborted',
  error: 'error'
} as const satisfies Record<ExecutionRunOutcome, ExecutionRunOutcome>
const RUN_OUTCOMES = Object.values(RUN_OUTCOME_VALUES)
const RUN_STOP_REASONS = [
  'complete',
  'context_window',
  'empty_response',
  'interaction',
  'journal_error',
  'max_tokens',
  'max_tool_calls',
  'max_turn_requests',
  'max_turns',
  'no_progress',
  'pending_input',
  'post_dispatch_permission',
  'pre_dispatch_error',
  'pre_stream_error',
  'provider_error',
  'tool_error',
  'tool_result',
  'unknown',
  'user_follow_up',
  'user_stop'
] as const satisfies readonly MainLogRunStopReason[]
const STARTUP_OUTCOMES = ['completed', 'failed'] as const
const SHUTDOWN_REASONS = [
  'all_windows_closed',
  'app_quit',
  'data_reset',
  'restart',
  'update_install',
  'unknown'
] as const satisfies readonly MainLogShutdownReason[]
const DATABASE_INITIALIZATION_OUTCOMES = ['completed', 'failed'] as const
const DATABASE_SCHEMA_DIAGNOSIS_OUTCOMES = ['completed', 'unavailable', 'not_completed'] as const
const DATABASE_SCHEMA_FAILURE_REASON_VALUES = {
  'missing-table': 'missing-table',
  'missing-column': 'missing-column',
  'column-count-mismatch': 'column-count-mismatch',
  'type-mismatch': 'type-mismatch'
} as const satisfies Record<DatabaseRepairReason, DatabaseRepairReason>
const DATABASE_SCHEMA_FAILURE_REASONS = Object.values(DATABASE_SCHEMA_FAILURE_REASON_VALUES)
const STARTUP_COMPONENTS = [
  'acp_install_compensation',
  'acp_registry_migration',
  'cli_control',
  'cli_launcher',
  'disabled_agent_tool_capability_cleanup',
  'floating_widget',
  'legacy_import',
  'mcp',
  'mcp_integration',
  'plugin_host',
  'plugin_runtime',
  'remote_runtime',
  'rtk_health_check',
  'skill_sync',
  'sqlite_mainline_normalization',
  'toolchain_gc',
  'usage_stats_backfill'
] as const satisfies readonly MainLogStartupComponent[]
const STARTUP_COMPONENT_ERROR_CATEGORIES = [
  'configuration',
  'persistence',
  'resource',
  'unknown'
] as const
const UPDATE_OPERATIONS = [
  'check',
  'download',
  'install',
  'install_verification',
  'marker_reconcile',
  'marker_write',
  'runtime'
] as const satisfies readonly MainLogUpdateOperation[]
const UPDATE_OPERATION_ERROR_CATEGORIES = ['persistence', 'provider', 'unknown'] as const
const RELEASE_REASONS = ['permit_released', 'lease_suspended', 'lease_released'] as const
const REJECTION_REASONS = ['queue_full', 'aborted', 'closed'] as const
const RECORD_DROP_REASONS = ['record_oversized', 'record_rejected'] as const
const TURN_KINDS = ['initial', 'follow_up'] as const
const DELEGATION_SUSPEND_REASONS = ['permission', 'question'] as const
const DELEGATION_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted'] as const
const RECONCILIATION_OUTCOMES = ['settled', 'quarantined', 'failed'] as const
const STALE_RESULT_REASONS = ['recovered_result_predates_turn'] as const

export function normalizeMainLogRunStopReason(
  value: string,
  _outcome: ExecutionRunOutcome
): MainLogRunStopReason {
  if ((RUN_STOP_REASONS as readonly string[]).includes(value)) {
    return value as MainLogRunStopReason
  }
  return 'unknown'
}

export class MainLogEventProjectionError extends Error {
  constructor(field: string) {
    super(`Invalid Main log event field: ${field}`)
    this.name = 'MainLogEventProjectionError'
  }
}

function identifier(field: string, value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    throw new MainLogEventProjectionError(field)
  }
  return value
}

function correlationIdentifier(
  field: string,
  value: unknown,
  options: MainLogProjectionOptions
): string {
  if (typeof value !== 'string' || value.length < 1) {
    throw new MainLogEventProjectionError(field)
  }
  if (options.acceptCorrelationFingerprints && CORRELATION_FINGERPRINT_PATTERN.test(value)) {
    return value
  }
  if (
    value.length <= MAX_IDENTIFIER_LENGTH &&
    IDENTIFIER_PATTERN.test(value) &&
    !value.startsWith(CORRELATION_FINGERPRINT_PREFIX)
  ) {
    return value
  }
  return `${CORRELATION_FINGERPRINT_PREFIX}${createHash('sha256')
    .update(value, 'utf8')
    .digest('hex')}`
}

function count(field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new MainLogEventProjectionError(field)
  }
  return value
}

function positiveCount(field: string, value: unknown): number {
  const normalized = count(field, value)
  if (normalized < 1) throw new MainLogEventProjectionError(field)
  return normalized
}

function validatedDuration(field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new MainLogEventProjectionError(field)
  }
  return value
}

function duration(field: string, value: unknown): number {
  return (
    Math.round(Math.min(validatedDuration(field, value), MAX_MAIN_LOG_DURATION_MS) * 1000) / 1000
  )
}

function booleanValue(field: string, value: unknown): boolean {
  if (typeof value !== 'boolean') throw new MainLogEventProjectionError(field)
  return value
}

function oneOf<const TValues extends readonly string[]>(
  field: string,
  value: unknown,
  allowed: TValues
): TValues[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new MainLogEventProjectionError(field)
  }
  return value as TValues[number]
}

function snapshotDataObject<T extends object>(
  field: string,
  value: T,
  fields: readonly StringKeyOf<T>[]
): T {
  try {
    if (typeof value !== 'object' || value === null || utilTypes.isProxy(value)) {
      throw new MainLogEventProjectionError(field)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new MainLogEventProjectionError(field)
    }
    const snapshot = Object.create(null) as Record<PropertyKey, unknown>
    for (const key of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor) continue
      if (!('value' in descriptor)) throw new MainLogEventProjectionError(field)
      snapshot[key] = descriptor.value
    }
    return snapshot as T
  } catch (error) {
    if (error instanceof MainLogEventProjectionError) throw error
    throw new MainLogEventProjectionError(field)
  }
}

function projectSafeError(value: SafeLogError): MainLogContext {
  const snapshot = snapshotDataObject('error', value, ['category', 'retryable'])
  const category = oneOf('error.category', snapshot.category, MAIN_LOG_ERROR_CATEGORIES)
  if (snapshot.retryable !== undefined && typeof snapshot.retryable !== 'boolean') {
    throw new MainLogEventProjectionError('error.retryable')
  }
  return {
    category,
    ...(snapshot.retryable === undefined ? {} : { retryable: snapshot.retryable })
  }
}

function failureError(required: boolean, value: unknown): MainLogContext | undefined {
  return required ? projectSafeError(value as SafeLogError) : undefined
}

function databaseFailureError(required: boolean, value: unknown): MainLogContext | undefined {
  if (!required) return undefined
  const snapshot = snapshotDataObject('error', value as MainLogDatabaseError, [
    'category',
    'reason'
  ])
  const category = oneOf('error.category', snapshot.category, [
    'integrity',
    'persistence',
    'schema'
  ] as const)
  if (category === 'schema') {
    return {
      category,
      reason: oneOf(
        'error.reason',
        'reason' in snapshot ? snapshot.reason : undefined,
        DATABASE_SCHEMA_FAILURE_REASONS
      )
    }
  }
  return {
    category
  }
}

function startupComponentError(value: unknown): MainLogContext {
  const snapshot = snapshotDataObject('error', value as MainLogStartupComponentError, ['category'])
  return {
    category: oneOf('error.category', snapshot.category, STARTUP_COMPONENT_ERROR_CATEGORIES)
  }
}

function updateOperationError(value: unknown): MainLogContext {
  const snapshot = snapshotDataObject('error', value as MainLogUpdateOperationError, ['category'])
  return {
    category: oneOf('error.category', snapshot.category, UPDATE_OPERATION_ERROR_CATEGORIES)
  }
}

function ownDataString(value: unknown, key: string): string | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  try {
    let current: object | null = value
    for (let depth = 0; current && depth < 4; depth += 1) {
      if (utilTypes.isProxy(current)) return undefined
      const descriptor = Object.getOwnPropertyDescriptor(current, key)
      if (descriptor && 'value' in descriptor) {
        return typeof descriptor.value === 'string' ? descriptor.value : undefined
      }
      current = Object.getPrototypeOf(current)
    }
  } catch {
    return undefined
  }
  return undefined
}

function nativeErrorName(value: unknown): string | undefined {
  if (!DOM_EXCEPTION_NAME_GETTER) return undefined
  try {
    const name = Reflect.apply(DOM_EXCEPTION_NAME_GETTER, value, [])
    return typeof name === 'string' ? name : undefined
  } catch {
    return undefined
  }
}

export function classifyMainLogError(value: unknown): SafeLogError {
  if (utilTypes.isProxy(value)) return { category: 'unknown' }
  const errorName = nativeErrorName(value) ?? ownDataString(value, 'name')
  const name = errorName && errorName.length <= MAX_ERROR_NAME_LENGTH ? errorName : undefined
  const category: (typeof FATAL_ERROR_CATEGORIES)[number] =
    name === 'AbortError'
      ? 'aborted'
      : name?.toLowerCase().includes('timeout')
        ? 'timeout'
        : 'unknown'
  return { category }
}

function projectFatalError(value: unknown): MainLogContext {
  return { category: classifyMainLogError(value).category }
}

function projectDistribution(field: string, value: MainLogDistribution): MainLogContext {
  const snapshot = snapshotDataObject(field, value, ['samples', 'p50', 'p95', 'max'])
  const samples = count(`${field}.samples`, snapshot.samples)
  if (samples > MAX_DIAGNOSTIC_DISTRIBUTION_SAMPLES) {
    throw new MainLogEventProjectionError(`${field}.samples`)
  }
  const percentile = (name: 'p50' | 'p95' | 'max'): number | null => {
    const candidate = snapshot[name]
    if (candidate === null) return null
    return validatedDuration(`${field}.${name}`, candidate)
  }
  const rawP50 = percentile('p50')
  const rawP95 = percentile('p95')
  const rawMax = percentile('max')
  if (samples === 0) {
    if (rawP50 !== null || rawP95 !== null || rawMax !== null) {
      throw new MainLogEventProjectionError(field)
    }
  } else if (
    rawP50 === null ||
    rawP95 === null ||
    rawMax === null ||
    rawP50 > rawP95 ||
    rawP95 > rawMax
  ) {
    throw new MainLogEventProjectionError(field)
  }
  return {
    samples,
    p50: rawP50 === null ? null : duration(`${field}.p50`, rawP50),
    p95: rawP95 === null ? null : duration(`${field}.p95`, rawP95),
    max: rawMax === null ? null : duration(`${field}.max`, rawMax)
  }
}

function projectAdmissionCorrelation(
  input: MainLogAdmissionCorrelation,
  options: MainLogProjectionOptions
): MainLogContext {
  return {
    kind: oneOf('kind', input.kind, ['live_delegation'] as const),
    parentSessionId: correlationIdentifier('parentSessionId', input.parentSessionId, options),
    delegationId: identifier('delegationId', input.delegationId),
    turnId: identifier('turnId', input.turnId)
  }
}

function projectAdmissionState(input: {
  capacity: number
  active: number
  pending: number
}): MainLogContext {
  const capacity = positiveCount('capacity', input.capacity)
  const active = count('active', input.active)
  if (active > capacity) throw new MainLogEventProjectionError('active')
  return { capacity, active, pending: count('pending', input.pending) }
}

function projectDelegationIdentity(
  input: {
    parentSessionId: string
    childSessionId?: string
    delegationId: string
    turnId: string
  },
  options: MainLogProjectionOptions
): MainLogContext {
  return {
    parentSessionId: correlationIdentifier('parentSessionId', input.parentSessionId, options),
    ...(input.childSessionId === undefined
      ? {}
      : {
          childSessionId: correlationIdentifier('childSessionId', input.childSessionId, options)
        }),
    delegationId: identifier('delegationId', input.delegationId),
    turnId: identifier('turnId', input.turnId)
  }
}

const EVENT_DEFINITIONS: MainLogEventDefinitions = {
  'logging.startup_buffer.dropped': {
    inputFields: ['droppedCount'],
    level: 'warn',
    project: (input) => ({ droppedCount: positiveCount('droppedCount', input.droppedCount) })
  },
  'logging.record.dropped': {
    inputFields: ['recordSeq', 'reason'],
    level: 'warn',
    project: (input) => ({
      recordSeq: positiveCount('recordSeq', input.recordSeq),
      reason: oneOf('reason', input.reason, RECORD_DROP_REASONS)
    })
  },
  'process.uncaught_exception': {
    inputFields: ['error'],
    level: 'error',
    project: (input) => ({ error: projectFatalError(input.error) })
  },
  'process.unhandled_rejection': {
    inputFields: ['error'],
    level: 'error',
    project: (input) => ({ error: projectFatalError(input.error) })
  },
  'app.startup.started': {
    inputFields: ['startupRunId', 'argumentCount', 'deepLinkPresent'],
    level: 'info',
    project: (input) => ({
      startupRunId: identifier('startupRunId', input.startupRunId),
      argumentCount: count('argumentCount', input.argumentCount),
      deepLinkPresent: booleanValue('deepLinkPresent', input.deepLinkPresent)
    })
  },
  'app.startup.terminal': {
    inputFields: ['startupRunId', 'outcome', 'durationMs', 'error'],
    level: (input) => (input.outcome === 'failed' ? 'error' : 'info'),
    project: (input) => {
      const outcome = oneOf('outcome', input.outcome, STARTUP_OUTCOMES)
      const error = failureError(outcome === 'failed', 'error' in input ? input.error : undefined)
      return {
        startupRunId: identifier('startupRunId', input.startupRunId),
        outcome,
        ...(input.durationMs === undefined
          ? {}
          : { durationMs: duration('durationMs', input.durationMs) }),
        ...(error ? { error } : {})
      }
    }
  },
  'app.startup.component.failed': {
    inputFields: ['startupRunId', 'component', 'error'],
    level: 'warn',
    project: (input) => ({
      startupRunId: identifier('startupRunId', input.startupRunId),
      component: oneOf('component', input.component, STARTUP_COMPONENTS),
      error: startupComponentError(input.error)
    })
  },
  'app.update.operation.failed': {
    inputFields: ['operation', 'error'],
    level: 'warn',
    project: (input) => ({
      operation: oneOf('operation', input.operation, UPDATE_OPERATIONS),
      error: updateOperationError(input.error)
    })
  },
  'app.shutdown.started': {
    inputFields: ['reason'],
    level: 'info',
    project: (input) => ({ reason: oneOf('reason', input.reason, SHUTDOWN_REASONS) })
  },
  'app.shutdown.terminal': {
    inputFields: ['outcome', 'durationMs', 'error'],
    level: (input) => (input.outcome === 'failed' ? 'error' : 'info'),
    project: (input) => {
      const outcome = oneOf('outcome', input.outcome, STARTUP_OUTCOMES)
      const error = failureError(outcome === 'failed', 'error' in input ? input.error : undefined)
      return {
        outcome,
        ...(input.durationMs === undefined
          ? {}
          : { durationMs: duration('durationMs', input.durationMs) }),
        ...(error ? { error } : {})
      }
    }
  },
  'app.shutdown.action.failed': {
    inputFields: ['reason', 'durationMs', 'error'],
    level: 'error',
    project: (input) => ({
      reason: oneOf('reason', input.reason, SHUTDOWN_REASONS),
      ...(input.durationMs === undefined
        ? {}
        : { durationMs: duration('durationMs', input.durationMs) }),
      error: projectSafeError(input.error)
    })
  },
  'database.initialization.terminal': {
    inputFields: [
      'outcome',
      'durationMs',
      'repairAttempted',
      'schemaDiagnosis',
      'repairableIssueCount',
      'manualIssueCount',
      'error'
    ],
    level: (input) =>
      input.outcome === 'failed'
        ? 'error'
        : input.schemaDiagnosis === 'unavailable' ||
            input.repairableIssueCount > 0 ||
            input.manualIssueCount > 0
          ? 'warn'
          : 'info',
    project: (input) => {
      const outcome = oneOf('outcome', input.outcome, DATABASE_INITIALIZATION_OUTCOMES)
      const error = databaseFailureError(
        outcome === 'failed',
        'error' in input ? input.error : undefined
      )
      return {
        outcome,
        ...(input.durationMs === undefined
          ? {}
          : { durationMs: duration('durationMs', input.durationMs) }),
        repairAttempted: booleanValue('repairAttempted', input.repairAttempted),
        schemaDiagnosis: oneOf(
          'schemaDiagnosis',
          input.schemaDiagnosis,
          DATABASE_SCHEMA_DIAGNOSIS_OUTCOMES
        ),
        repairableIssueCount: count('repairableIssueCount', input.repairableIssueCount),
        manualIssueCount: count('manualIssueCount', input.manualIssueCount),
        ...(error ? { error } : {})
      }
    }
  },
  'agent.run.started': {
    inputFields: ['runId', 'sessionId', 'messageId', 'runKind', 'initialRequestSeq'],
    level: 'info',
    project: (input, options) => {
      const runKind = oneOf('runKind', input.runKind, RUN_KINDS)
      return {
        runId: identifier('runId', input.runId),
        sessionId: correlationIdentifier('sessionId', input.sessionId, options),
        messageId: correlationIdentifier('messageId', input.messageId, options),
        runKind,
        ...(runKind === 'loop'
          ? {
              initialRequestSeq: count(
                'initialRequestSeq',
                'initialRequestSeq' in input ? input.initialRequestSeq : undefined
              )
            }
          : {})
      }
    }
  },
  'agent.run.terminal': {
    inputFields: [
      'runId',
      'sessionId',
      'messageId',
      'runKind',
      'outcome',
      'stopReason',
      'durationMs',
      'logicalRounds',
      'toolCalls',
      'error'
    ],
    level: (input) => (input.outcome === 'error' ? 'error' : 'info'),
    project: (input, options) => {
      const runKind = oneOf('runKind', input.runKind, RUN_KINDS)
      const outcome = oneOf('outcome', input.outcome, RUN_OUTCOMES)
      const error = failureError(outcome === 'error', 'error' in input ? input.error : undefined)
      return {
        runId: identifier('runId', input.runId),
        sessionId: correlationIdentifier('sessionId', input.sessionId, options),
        messageId: correlationIdentifier('messageId', input.messageId, options),
        runKind,
        outcome,
        stopReason: oneOf('stopReason', input.stopReason, RUN_STOP_REASONS),
        ...(input.durationMs === undefined
          ? {}
          : { durationMs: duration('durationMs', input.durationMs) }),
        ...(runKind === 'loop'
          ? {
              logicalRounds: count(
                'logicalRounds',
                'logicalRounds' in input ? input.logicalRounds : undefined
              ),
              toolCalls: count('toolCalls', 'toolCalls' in input ? input.toolCalls : undefined)
            }
          : {}),
        ...(error ? { error } : {})
      }
    }
  },
  'agent.admission.queued': {
    inputFields: [
      'kind',
      'parentSessionId',
      'delegationId',
      'turnId',
      'acquisitionSeq',
      'capacity',
      'active',
      'pending'
    ],
    level: 'info',
    project: (input, options) => ({
      ...projectAdmissionCorrelation(input, options),
      acquisitionSeq: positiveCount('acquisitionSeq', input.acquisitionSeq),
      ...projectAdmissionState(input)
    })
  },
  'agent.admission.granted': {
    inputFields: [
      'kind',
      'parentSessionId',
      'delegationId',
      'turnId',
      'acquisitionSeq',
      'waitMs',
      'capacity',
      'active',
      'pending'
    ],
    level: 'info',
    project: (input, options) => ({
      ...projectAdmissionCorrelation(input, options),
      acquisitionSeq: positiveCount('acquisitionSeq', input.acquisitionSeq),
      ...(input.waitMs === undefined ? {} : { waitMs: duration('waitMs', input.waitMs) }),
      ...projectAdmissionState(input)
    })
  },
  'agent.admission.released': {
    inputFields: [
      'kind',
      'parentSessionId',
      'delegationId',
      'turnId',
      'acquisitionSeq',
      'holdMs',
      'reason',
      'active',
      'pending'
    ],
    level: 'info',
    project: (input, options) => ({
      ...projectAdmissionCorrelation(input, options),
      acquisitionSeq: positiveCount('acquisitionSeq', input.acquisitionSeq),
      ...(input.holdMs === undefined ? {} : { holdMs: duration('holdMs', input.holdMs) }),
      reason: oneOf('reason', input.reason, RELEASE_REASONS),
      active: count('active', input.active),
      pending: count('pending', input.pending)
    })
  },
  'agent.admission.rejected': {
    inputFields: [
      'kind',
      'parentSessionId',
      'delegationId',
      'turnId',
      'acquisitionSeq',
      'waitMs',
      'reason',
      'capacity',
      'active',
      'pending'
    ],
    level: (input) => (input.reason === 'aborted' ? 'info' : 'warn'),
    project: (input, options) => ({
      ...projectAdmissionCorrelation(input, options),
      acquisitionSeq: positiveCount('acquisitionSeq', input.acquisitionSeq),
      ...(input.waitMs === undefined ? {} : { waitMs: duration('waitMs', input.waitMs) }),
      reason: oneOf('reason', input.reason, REJECTION_REASONS),
      ...projectAdmissionState(input)
    })
  },
  'agent.admission.closed': {
    inputFields: [
      'capacity',
      'active',
      'pending',
      'activeHighWater',
      'pendingHighWater',
      'granted',
      'rejected',
      'observationsDropped',
      'waitMs',
      'holdMs'
    ],
    level: 'info',
    project: (input) => {
      const state = projectAdmissionState(input)
      const activeHighWater = count('activeHighWater', input.activeHighWater)
      const pendingHighWater = count('pendingHighWater', input.pendingHighWater)
      if (activeHighWater < input.active || activeHighWater > input.capacity) {
        throw new MainLogEventProjectionError('activeHighWater')
      }
      if (pendingHighWater < input.pending) {
        throw new MainLogEventProjectionError('pendingHighWater')
      }
      return {
        ...state,
        activeHighWater,
        pendingHighWater,
        granted: count('granted', input.granted),
        rejected: count('rejected', input.rejected),
        observationsDropped: count('observationsDropped', input.observationsDropped),
        waitMs: projectDistribution('waitMs', input.waitMs),
        holdMs: projectDistribution('holdMs', input.holdMs)
      }
    }
  },
  'orchestration.delegation.turn.queued': {
    inputFields: ['parentSessionId', 'delegationId', 'turnId', 'turnKind'],
    level: 'info',
    project: (input, options) => ({
      ...projectDelegationIdentity(input, options),
      turnKind: oneOf('turnKind', input.turnKind, TURN_KINDS)
    })
  },
  'orchestration.delegation.child.bound': {
    inputFields: ['parentSessionId', 'childSessionId', 'delegationId', 'turnId'],
    level: 'info',
    project: (input, options) => projectDelegationIdentity(input, options)
  },
  'orchestration.delegation.turn.started': {
    inputFields: ['parentSessionId', 'childSessionId', 'delegationId', 'turnId', 'turnKind'],
    level: 'info',
    project: (input, options) => ({
      ...projectDelegationIdentity(input, options),
      turnKind: oneOf('turnKind', input.turnKind, TURN_KINDS)
    })
  },
  'orchestration.delegation.turn.suspended': {
    inputFields: ['parentSessionId', 'childSessionId', 'delegationId', 'turnId', 'reason'],
    level: 'info',
    project: (input, options) => ({
      ...projectDelegationIdentity(input, options),
      reason: oneOf('reason', input.reason, DELEGATION_SUSPEND_REASONS)
    })
  },
  'orchestration.delegation.turn.resumed': {
    inputFields: ['parentSessionId', 'childSessionId', 'delegationId', 'turnId'],
    level: 'info',
    project: (input, options) => projectDelegationIdentity(input, options)
  },
  'orchestration.delegation.turn.terminal': {
    inputFields: [
      'parentSessionId',
      'childSessionId',
      'delegationId',
      'turnId',
      'status',
      'durationMs',
      'error'
    ],
    level: (input) => (input.status === 'failed' ? 'error' : 'info'),
    project: (input, options) => {
      const status = oneOf('status', input.status, DELEGATION_TERMINAL_STATUSES)
      const error = failureError(status === 'failed', 'error' in input ? input.error : undefined)
      return {
        ...projectDelegationIdentity(input, options),
        status,
        ...(input.durationMs === undefined
          ? {}
          : { durationMs: duration('durationMs', input.durationMs) }),
        ...(error ? { error } : {})
      }
    }
  },
  'orchestration.delegation.reconciliation.terminal': {
    inputFields: [
      'parentSessionId',
      'childSessionId',
      'delegationId',
      'turnId',
      'outcome',
      'error'
    ],
    level: (input) =>
      input.outcome === 'failed' ? 'error' : input.outcome === 'quarantined' ? 'warn' : 'info',
    project: (input, options) => {
      const outcome = oneOf('outcome', input.outcome, RECONCILIATION_OUTCOMES)
      const error = failureError(
        outcome === 'failed' || outcome === 'quarantined',
        'error' in input ? input.error : undefined
      )
      return {
        ...projectDelegationIdentity(input, options),
        outcome,
        ...(error ? { error } : {})
      }
    }
  },
  'orchestration.delegation.stale_result.rejected': {
    inputFields: ['parentSessionId', 'childSessionId', 'delegationId', 'turnId', 'reason'],
    level: 'warn',
    project: (input, options) => ({
      ...projectDelegationIdentity(input, options),
      reason: oneOf('reason', input.reason, STALE_RESULT_REASONS)
    })
  },
  'orchestration.delegation.observations.dropped': {
    inputFields: ['droppedCount'],
    level: 'warn',
    project: (input) => ({ droppedCount: positiveCount('droppedCount', input.droppedCount) })
  }
}

export function projectMainLogEvent<TEvent extends MainLogEventName>(
  event: TEvent,
  input: MainLogEventInputMap[TEvent]
): ProjectedMainLogEvent {
  return projectMainLogEventWithOptions(event, input, EMISSION_PROJECTION_OPTIONS)
}

function projectMainLogEventWithOptions<TEvent extends MainLogEventName>(
  event: TEvent,
  input: MainLogEventInputMap[TEvent],
  options: MainLogProjectionOptions
): ProjectedMainLogEvent {
  if (!isMainLogEventName(event)) {
    throw new MainLogEventProjectionError('event')
  }
  const definition = EVENT_DEFINITIONS[event] as MainLogEventDefinition<
    MainLogEventInputMap[TEvent]
  >
  const safeInput = snapshotDataObject('input', input, definition.inputFields)
  const context = definition.project(safeInput, options)
  return {
    level: typeof definition.level === 'function' ? definition.level(safeInput) : definition.level,
    context
  }
}

export function isMainLogEventName(value: unknown): value is MainLogEventName {
  return typeof value === 'string' && Object.hasOwn(EVENT_DEFINITIONS, value)
}

export function isProjectedMainLogEvent(
  event: MainLogEventName,
  level: MainLogLevel,
  context: unknown
): context is MainLogContext {
  if (event === 'process.uncaught_exception' || event === 'process.unhandled_rejection') {
    return level === 'error' && isProjectedFatalContext(context)
  }
  try {
    const projected = projectMainLogEventWithOptions(
      event,
      context as never,
      VALIDATION_PROJECTION_OPTIONS
    )
    return (
      projected.level === level && JSON.stringify(projected.context) === JSON.stringify(context)
    )
  } catch {
    return false
  }
}

function isProjectedFatalContext(context: unknown): context is MainLogContext {
  if (!isPlainRecord(context) || Object.keys(context).join(',') !== 'error') return false
  const error = context.error
  if (!isPlainRecord(error)) return false
  if (
    typeof error.category !== 'string' ||
    !(FATAL_ERROR_CATEGORIES as readonly string[]).includes(error.category)
  ) {
    return false
  }
  return JSON.stringify(context) === JSON.stringify({ error: { category: error.category } })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}
