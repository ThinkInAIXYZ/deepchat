import { types as utilTypes } from 'node:util'
import type { ExecutionRunKind, ExecutionRunOutcome } from '@/tape/domain/executionJournal'

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
export type MainLogLevel = 'error' | 'warn' | 'info'
export type MainLogShutdownReason =
  | 'all_windows_closed'
  | 'app_quit'
  | 'restart'
  | 'update_install'
  | 'unknown'

export interface SafeLogError {
  category: MainLogErrorCategory
  code?: string
  retryable?: boolean
}

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
  | 'user_follow_up'
  | 'user_stop'

type MainLogAppTerminalInput =
  | {
      outcome: 'completed'
      durationMs: number
    }
  | {
      outcome: 'failed'
      durationMs: number
      error: SafeLogError
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
  durationMs: number
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
  'app.shutdown.started': {
    reason: MainLogShutdownReason
  }
  'app.shutdown.terminal': MainLogAppTerminalInput
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
    waitMs: number
    capacity: number
    active: number
    pending: number
  }
  'agent.admission.released': MainLogAdmissionCorrelation & {
    acquisitionSeq: number
    holdMs: number
    reason: 'permit_released' | 'lease_suspended' | 'lease_released'
    active: number
    pending: number
  }
  'agent.admission.rejected': MainLogAdmissionCorrelation & {
    acquisitionSeq: number
    waitMs: number
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
    durationMs: number
  } & (
    | { status: 'completed' | 'cancelled' | 'interrupted' }
    | { status: 'failed'; error: SafeLogError }
  )
  'orchestration.delegation.reconciliation.terminal': {
    parentSessionId: string
    childSessionId?: string
    delegationId: string
    turnId: string
  } & (
    | { outcome: 'resumed' | 'settled' }
    | { outcome: 'quarantined' | 'failed'; error: SafeLogError }
  )
  'orchestration.delegation.stale_result.rejected': {
    parentSessionId: string
    childSessionId: string
    delegationId: string
    turnId: string
    reason: 'recovered_result_predates_turn'
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
  project: (input: TInput) => MainLogContext
}

type StringKeyOf<T> = T extends unknown ? Extract<keyof T, string> : never

type MainLogEventDefinitions = {
  [TEvent in MainLogEventName]: MainLogEventDefinition<MainLogEventInputMap[TEvent]>
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]+$/
const CODE_PATTERN = /^[A-Za-z0-9._:-]+$/
const MAX_IDENTIFIER_LENGTH = 256
const MAX_CODE_LENGTH = 128
const MAX_FATAL_STACK_FRAMES = 20
const MAX_FATAL_STACK_FRAME_LENGTH = 512
const MAX_FATAL_STACK_SOURCE_LENGTH = 32 * 1024
const MAX_ERROR_NAME_LENGTH = 128
const MAX_DISTRIBUTION_SAMPLES = 256
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000
const NATIVE_ERROR_STACK_GETTER = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get

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
  'user_follow_up',
  'user_stop'
] as const satisfies readonly MainLogRunStopReason[]
const STARTUP_OUTCOMES = ['completed', 'failed'] as const
const SHUTDOWN_REASONS = [
  'all_windows_closed',
  'app_quit',
  'restart',
  'update_install',
  'unknown'
] as const satisfies readonly MainLogShutdownReason[]
const RELEASE_REASONS = ['permit_released', 'lease_suspended', 'lease_released'] as const
const REJECTION_REASONS = ['queue_full', 'aborted', 'closed'] as const
const TURN_KINDS = ['initial', 'follow_up'] as const
const DELEGATION_SUSPEND_REASONS = ['permission', 'question'] as const
const DELEGATION_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted'] as const
const RECONCILIATION_OUTCOMES = ['resumed', 'settled', 'quarantined', 'failed'] as const
const STALE_RESULT_REASONS = ['recovered_result_predates_turn'] as const

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

function duration(field: string, value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_DURATION_MS
  ) {
    throw new MainLogEventProjectionError(field)
  }
  return Math.round(value * 1000) / 1000
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
  const snapshot = snapshotDataObject('error', value, ['category', 'code', 'retryable'])
  const category = oneOf('error.category', snapshot.category, MAIN_LOG_ERROR_CATEGORIES)
  let code: string | undefined
  if (snapshot.code !== undefined) {
    if (
      typeof snapshot.code !== 'string' ||
      snapshot.code.length < 1 ||
      snapshot.code.length > MAX_CODE_LENGTH ||
      !CODE_PATTERN.test(snapshot.code)
    ) {
      throw new MainLogEventProjectionError('error.code')
    }
    code = snapshot.code
  }
  if (snapshot.retryable !== undefined && typeof snapshot.retryable !== 'boolean') {
    throw new MainLogEventProjectionError('error.retryable')
  }
  return {
    category,
    ...(code ? { code } : {}),
    ...(snapshot.retryable === undefined ? {} : { retryable: snapshot.retryable })
  }
}

function failureError(required: boolean, value: unknown): MainLogContext | undefined {
  return required ? projectSafeError(value as SafeLogError) : undefined
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
      const getter = descriptor?.get
      if (
        key === 'stack' &&
        utilTypes.isNativeError(value) &&
        getter !== undefined &&
        getter === NATIVE_ERROR_STACK_GETTER
      ) {
        const nativeValue = getter.call(value)
        return typeof nativeValue === 'string' ? nativeValue : undefined
      }
      current = Object.getPrototypeOf(current)
    }
  } catch {
    return undefined
  }
  return undefined
}

function projectStackFrame(line: string): string | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('at ') || trimmed.length > MAX_FATAL_STACK_FRAME_LENGTH) return undefined

  const functionName = trimmed.match(/^at ([A-Za-z0-9_.$<>[\]-]{1,160})/)?.[1]
  const applicationLocation = trimmed.match(
    /(?:src|out)[\\/]main[\\/][A-Za-z0-9_./\\-]{1,320}(?::\d{1,10}){0,2}/
  )?.[0]
  if (!applicationLocation) return undefined
  const normalizedLocation = applicationLocation.replaceAll('\\', '/')
  return functionName
    ? `at ${functionName} (<app>/${normalizedLocation})`
    : `at <app>/${normalizedLocation}`
}

function projectFatalError(value: unknown): MainLogContext {
  if (utilTypes.isProxy(value)) return { category: 'unknown' }
  const errorName = ownDataString(value, 'name')
  const name = errorName && errorName.length <= MAX_ERROR_NAME_LENGTH ? errorName : undefined
  const category: MainLogErrorCategory =
    name === 'AbortError'
      ? 'aborted'
      : name?.toLowerCase().includes('timeout')
        ? 'timeout'
        : 'unknown'
  const stack = ownDataString(value, 'stack')
  const frames = stack
    ?.slice(0, MAX_FATAL_STACK_SOURCE_LENGTH)
    ?.split(/\r?\n/)
    .slice(1)
    .map(projectStackFrame)
    .filter((frame): frame is string => frame !== undefined)
    .slice(0, MAX_FATAL_STACK_FRAMES)
  return {
    category,
    ...(frames && frames.length > 0 ? { stack: frames } : {})
  }
}

function projectDistribution(field: string, value: MainLogDistribution): MainLogContext {
  const snapshot = snapshotDataObject(field, value, ['samples', 'p50', 'p95', 'max'])
  const samples = count(`${field}.samples`, snapshot.samples)
  if (samples > MAX_DISTRIBUTION_SAMPLES) {
    throw new MainLogEventProjectionError(`${field}.samples`)
  }
  const percentile = (name: 'p50' | 'p95' | 'max'): number | null => {
    const candidate = snapshot[name]
    if (candidate === null) return null
    return duration(`${field}.${name}`, candidate)
  }
  const p50 = percentile('p50')
  const p95 = percentile('p95')
  const max = percentile('max')
  if (samples === 0) {
    if (p50 !== null || p95 !== null || max !== null) {
      throw new MainLogEventProjectionError(field)
    }
  } else if (p50 === null || p95 === null || max === null || p50 > p95 || p95 > max) {
    throw new MainLogEventProjectionError(field)
  }
  return { samples, p50, p95, max }
}

function projectAdmissionCorrelation(input: MainLogAdmissionCorrelation): MainLogContext {
  return {
    kind: oneOf('kind', input.kind, ['live_delegation'] as const),
    parentSessionId: identifier('parentSessionId', input.parentSessionId),
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

function projectDelegationIdentity(input: {
  parentSessionId: string
  childSessionId?: string
  delegationId: string
  turnId: string
}): MainLogContext {
  return {
    parentSessionId: identifier('parentSessionId', input.parentSessionId),
    ...(input.childSessionId === undefined
      ? {}
      : { childSessionId: identifier('childSessionId', input.childSessionId) }),
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
        durationMs: duration('durationMs', input.durationMs),
        ...(error ? { error } : {})
      }
    }
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
        durationMs: duration('durationMs', input.durationMs),
        ...(error ? { error } : {})
      }
    }
  },
  'agent.run.started': {
    inputFields: ['runId', 'sessionId', 'messageId', 'runKind', 'initialRequestSeq'],
    level: 'info',
    project: (input) => {
      const runKind = oneOf('runKind', input.runKind, RUN_KINDS)
      return {
        runId: identifier('runId', input.runId),
        sessionId: identifier('sessionId', input.sessionId),
        messageId: identifier('messageId', input.messageId),
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
    project: (input) => {
      const runKind = oneOf('runKind', input.runKind, RUN_KINDS)
      const outcome = oneOf('outcome', input.outcome, RUN_OUTCOMES)
      const error = failureError(outcome === 'error', 'error' in input ? input.error : undefined)
      return {
        runId: identifier('runId', input.runId),
        sessionId: identifier('sessionId', input.sessionId),
        messageId: identifier('messageId', input.messageId),
        runKind,
        outcome,
        stopReason: oneOf('stopReason', input.stopReason, RUN_STOP_REASONS),
        durationMs: duration('durationMs', input.durationMs),
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
    project: (input) => ({
      ...projectAdmissionCorrelation(input),
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
    project: (input) => ({
      ...projectAdmissionCorrelation(input),
      acquisitionSeq: positiveCount('acquisitionSeq', input.acquisitionSeq),
      waitMs: duration('waitMs', input.waitMs),
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
    project: (input) => ({
      ...projectAdmissionCorrelation(input),
      acquisitionSeq: positiveCount('acquisitionSeq', input.acquisitionSeq),
      holdMs: duration('holdMs', input.holdMs),
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
    project: (input) => ({
      ...projectAdmissionCorrelation(input),
      acquisitionSeq: positiveCount('acquisitionSeq', input.acquisitionSeq),
      waitMs: duration('waitMs', input.waitMs),
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
    project: (input) => ({
      ...projectDelegationIdentity(input),
      turnKind: oneOf('turnKind', input.turnKind, TURN_KINDS)
    })
  },
  'orchestration.delegation.child.bound': {
    inputFields: ['parentSessionId', 'childSessionId', 'delegationId', 'turnId'],
    level: 'info',
    project: (input) => projectDelegationIdentity(input)
  },
  'orchestration.delegation.turn.started': {
    inputFields: ['parentSessionId', 'childSessionId', 'delegationId', 'turnId', 'turnKind'],
    level: 'info',
    project: (input) => ({
      ...projectDelegationIdentity(input),
      turnKind: oneOf('turnKind', input.turnKind, TURN_KINDS)
    })
  },
  'orchestration.delegation.turn.suspended': {
    inputFields: ['parentSessionId', 'childSessionId', 'delegationId', 'turnId', 'reason'],
    level: 'info',
    project: (input) => ({
      ...projectDelegationIdentity(input),
      reason: oneOf('reason', input.reason, DELEGATION_SUSPEND_REASONS)
    })
  },
  'orchestration.delegation.turn.resumed': {
    inputFields: ['parentSessionId', 'childSessionId', 'delegationId', 'turnId'],
    level: 'info',
    project: (input) => projectDelegationIdentity(input)
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
    project: (input) => {
      const status = oneOf('status', input.status, DELEGATION_TERMINAL_STATUSES)
      const error = failureError(status === 'failed', 'error' in input ? input.error : undefined)
      return {
        ...projectDelegationIdentity(input),
        status,
        durationMs: duration('durationMs', input.durationMs),
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
    project: (input) => {
      const outcome = oneOf('outcome', input.outcome, RECONCILIATION_OUTCOMES)
      const error = failureError(
        outcome === 'failed' || outcome === 'quarantined',
        'error' in input ? input.error : undefined
      )
      return {
        ...projectDelegationIdentity(input),
        outcome,
        ...(error ? { error } : {})
      }
    }
  },
  'orchestration.delegation.stale_result.rejected': {
    inputFields: ['parentSessionId', 'childSessionId', 'delegationId', 'turnId', 'reason'],
    level: 'warn',
    project: (input) => ({
      ...projectDelegationIdentity(input),
      reason: oneOf('reason', input.reason, STALE_RESULT_REASONS)
    })
  }
}

export function projectMainLogEvent<TEvent extends MainLogEventName>(
  event: TEvent,
  input: MainLogEventInputMap[TEvent]
): ProjectedMainLogEvent {
  if (!isMainLogEventName(event)) {
    throw new MainLogEventProjectionError('event')
  }
  const definition = EVENT_DEFINITIONS[event] as MainLogEventDefinition<
    MainLogEventInputMap[TEvent]
  >
  const safeInput = snapshotDataObject('input', input, definition.inputFields)
  const context = definition.project(safeInput)
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
    const projected = projectMainLogEvent(event, context as never)
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
    error.category !== 'aborted' &&
    error.category !== 'timeout' &&
    error.category !== 'unknown'
  ) {
    return false
  }
  const normalizedError: Record<string, MainLogJsonValue> = { category: error.category }
  if (error.stack !== undefined) {
    if (
      !Array.isArray(error.stack) ||
      error.stack.length < 1 ||
      error.stack.length > MAX_FATAL_STACK_FRAMES ||
      !error.stack.every(isProjectedStackFrame)
    ) {
      return false
    }
    normalizedError.stack = error.stack
  }
  return JSON.stringify(context) === JSON.stringify({ error: normalizedError })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function isProjectedStackFrame(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_FATAL_STACK_FRAME_LENGTH &&
    /^at (?:(?:[A-Za-z0-9_.$<>[\]-]{1,160} \(<app>\/)|(?:<app>\/))(?:src|out)\/main\/[A-Za-z0-9_./-]{1,320}(?::\d{1,10}){0,2}\)?$/.test(
      value
    )
  )
}
