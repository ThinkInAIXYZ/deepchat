import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  isProjectedMainLogEvent,
  classifyMainLogError,
  MainLogEventProjectionError,
  normalizeMainLogRunStopReason,
  projectMainLogEvent,
  type MainLogEventInputMap,
  type MainLogEventName
} from '@/logging/mainLogEvents'

describe('Main log event projection', () => {
  it('round-trips every catalog projector through persisted-context validation', () => {
    const admission = {
      kind: 'live_delegation' as const,
      parentSessionId: 'parent_1',
      delegationId: 'delegation_1',
      turnId: 'turn_1'
    }
    const delegation = {
      parentSessionId: 'parent_1',
      childSessionId: 'child_1',
      delegationId: 'delegation_1',
      turnId: 'turn_1'
    }
    const inputs = {
      'logging.startup_buffer.dropped': { droppedCount: 1 },
      'logging.record.dropped': { recordSeq: 1, reason: 'record_rejected' },
      'process.uncaught_exception': { error: new Error('not persisted') },
      'process.unhandled_rejection': { error: new DOMException('not persisted', 'AbortError') },
      'app.startup.started': {
        startupRunId: 'startup_1',
        argumentCount: 1,
        deepLinkPresent: false
      },
      'app.startup.terminal': {
        startupRunId: 'startup_1',
        outcome: 'completed',
        durationMs: 10
      },
      'app.startup.component.failed': {
        startupRunId: 'startup_1',
        component: 'legacy_import',
        error: { category: 'persistence' }
      },
      'app.update.operation.failed': {
        operation: 'download',
        error: { category: 'provider' }
      },
      'app.shutdown.started': { reason: 'app_quit' },
      'app.shutdown.terminal': { outcome: 'completed', durationMs: 10 },
      'app.shutdown.action.failed': {
        reason: 'restart',
        durationMs: 11,
        error: { category: 'unknown' }
      },
      'database.initialization.terminal': {
        outcome: 'completed',
        durationMs: 10,
        repairAttempted: false,
        schemaDiagnosis: 'completed',
        repairableIssueCount: 0,
        manualIssueCount: 0
      },
      'agent.run.started': {
        runId: 'run_1',
        sessionId: 'session_1',
        messageId: 'message_1',
        runKind: 'loop',
        initialRequestSeq: 0
      },
      'agent.run.terminal': {
        runId: 'run_1',
        sessionId: 'session_1',
        messageId: 'message_1',
        runKind: 'loop',
        outcome: 'completed',
        stopReason: 'complete',
        durationMs: 10,
        logicalRounds: 1,
        toolCalls: 0
      },
      'agent.admission.queued': {
        ...admission,
        acquisitionSeq: 1,
        capacity: 6,
        active: 6,
        pending: 1
      },
      'agent.admission.granted': {
        ...admission,
        acquisitionSeq: 1,
        waitMs: 10,
        capacity: 6,
        active: 6,
        pending: 0
      },
      'agent.admission.released': {
        ...admission,
        acquisitionSeq: 1,
        holdMs: 10,
        reason: 'permit_released',
        active: 5,
        pending: 0
      },
      'agent.admission.rejected': {
        ...admission,
        acquisitionSeq: 1,
        waitMs: 10,
        reason: 'queue_full',
        capacity: 6,
        active: 6,
        pending: 10
      },
      'agent.admission.closed': {
        capacity: 6,
        active: 0,
        pending: 0,
        activeHighWater: 6,
        pendingHighWater: 1,
        granted: 1,
        rejected: 1,
        observationsDropped: 0,
        waitMs: { samples: 1, p50: 10, p95: 10, max: 10 },
        holdMs: { samples: 1, p50: 10, p95: 10, max: 10 }
      },
      'orchestration.delegation.turn.queued': {
        parentSessionId: delegation.parentSessionId,
        delegationId: delegation.delegationId,
        turnId: delegation.turnId,
        turnKind: 'initial'
      },
      'orchestration.delegation.child.bound': delegation,
      'orchestration.delegation.turn.started': { ...delegation, turnKind: 'initial' },
      'orchestration.delegation.turn.suspended': { ...delegation, reason: 'permission' },
      'orchestration.delegation.turn.resumed': delegation,
      'orchestration.delegation.turn.terminal': {
        ...delegation,
        status: 'completed',
        durationMs: 10
      },
      'orchestration.delegation.reconciliation.terminal': {
        ...delegation,
        outcome: 'settled'
      },
      'orchestration.delegation.stale_result.rejected': {
        ...delegation,
        reason: 'recovered_result_predates_turn'
      },
      'orchestration.delegation.observations.dropped': { droppedCount: 1 }
    } satisfies { [TEvent in MainLogEventName]: MainLogEventInputMap[TEvent] }

    for (const event of Object.keys(inputs) as MainLogEventName[]) {
      const projected = projectMainLogEvent(event, inputs[event] as never)
      const serializedContext: unknown = JSON.parse(JSON.stringify(projected.context))
      expect(isProjectedMainLogEvent(event, projected.level, serializedContext), event).toBe(true)
    }
  })

  it('round-trips terminal events when diagnostic duration is unavailable', () => {
    const projectedEvents = [
      [
        'app.startup.terminal',
        projectMainLogEvent('app.startup.terminal', {
          startupRunId: 'startup_1',
          outcome: 'completed'
        })
      ],
      [
        'app.shutdown.terminal',
        projectMainLogEvent('app.shutdown.terminal', { outcome: 'completed' })
      ],
      [
        'app.shutdown.action.failed',
        projectMainLogEvent('app.shutdown.action.failed', {
          reason: 'restart',
          error: { category: 'unknown' }
        })
      ],
      [
        'database.initialization.terminal',
        projectMainLogEvent('database.initialization.terminal', {
          outcome: 'completed',
          repairAttempted: false,
          schemaDiagnosis: 'completed',
          repairableIssueCount: 0,
          manualIssueCount: 0
        })
      ],
      [
        'agent.run.terminal',
        projectMainLogEvent('agent.run.terminal', {
          runId: 'run_1',
          sessionId: 'session_1',
          messageId: 'message_1',
          runKind: 'loop',
          outcome: 'completed',
          stopReason: 'complete',
          logicalRounds: 1,
          toolCalls: 0
        })
      ]
    ] as const

    for (const [event, projected] of projectedEvents) {
      expect(projected.context).not.toHaveProperty('durationMs')
      expect(
        isProjectedMainLogEvent(
          event,
          projected.level,
          JSON.parse(JSON.stringify(projected.context))
        ),
        event
      ).toBe(true)
    }
  })

  it('still rejects a supplied invalid optional duration', () => {
    expect(() =>
      projectMainLogEvent('app.shutdown.terminal', {
        outcome: 'completed',
        durationMs: -1
      })
    ).toThrow(MainLogEventProjectionError)
  })

  it('normalizes unknown durable stop reasons without persisting their text', () => {
    expect(normalizeMainLogRunStopReason('SECRET_PROVIDER_DETAIL', 'completed')).toBe('unknown')
    expect(normalizeMainLogRunStopReason('SECRET_PROVIDER_DETAIL', 'paused')).toBe('unknown')
    expect(normalizeMainLogRunStopReason('SECRET_PROVIDER_DETAIL', 'aborted')).toBe('unknown')
    expect(normalizeMainLogRunStopReason('SECRET_PROVIDER_DETAIL', 'error')).toBe('unknown')
    expect(normalizeMainLogRunStopReason('journal_error', 'error')).toBe('journal_error')
    expect(normalizeMainLogRunStopReason('provider_error', 'error')).toBe('provider_error')
  })

  it('projects an Agent terminal event with fixed severity and strict fields', () => {
    const projected = projectMainLogEvent('agent.run.terminal', {
      runId: '0d1d17d8-e069-4b9f-9867-bf05fd6f8276',
      sessionId: 'session_123',
      messageId: 'message_456',
      runKind: 'loop',
      outcome: 'error',
      stopReason: 'provider_error',
      durationMs: 123.4567,
      logicalRounds: 2,
      toolCalls: 1,
      error: { category: 'provider', retryable: true }
    })

    expect(projected).toEqual({
      level: 'error',
      context: {
        runId: '0d1d17d8-e069-4b9f-9867-bf05fd6f8276',
        sessionId: 'session_123',
        messageId: 'message_456',
        runKind: 'loop',
        outcome: 'error',
        stopReason: 'provider_error',
        durationMs: 123.457,
        logicalRounds: 2,
        toolCalls: 1,
        error: { category: 'provider', retryable: true }
      }
    })
  })

  it('constructs a new context and drops unknown payload-shaped fields', () => {
    const projected = projectMainLogEvent('orchestration.delegation.child.bound', {
      parentSessionId: 'parent_1',
      childSessionId: 'child_1',
      delegationId: 'delegation_1',
      turnId: 'turn_1',
      prompt: 'SECRET_PROMPT',
      toolResponse: 'SECRET_TOOL_RESPONSE'
    } as never)

    expect(projected.context).toEqual({
      parentSessionId: 'parent_1',
      childSessionId: 'child_1',
      delegationId: 'delegation_1',
      turnId: 'turn_1'
    })
    expect(JSON.stringify(projected)).not.toContain('SECRET_')
  })

  it('projects delegation observation loss as one count-only warning', () => {
    expect(
      projectMainLogEvent('orchestration.delegation.observations.dropped', {
        droppedCount: 7,
        prompt: 'SECRET_PROMPT'
      } as never)
    ).toEqual({ level: 'warn', context: { droppedCount: 7 } })
    expect(() =>
      projectMainLogEvent('orchestration.delegation.observations.dropped', { droppedCount: 0 })
    ).toThrow(MainLogEventProjectionError)
  })

  it('rejects invalid identifiers without copying their values into the error', () => {
    let projectionError: unknown
    try {
      projectMainLogEvent('agent.run.started', {
        runId: 'invalid run id SECRET_VALUE',
        sessionId: 'session_1',
        messageId: 'message_1',
        runKind: 'loop',
        initialRequestSeq: 0
      })
    } catch (error) {
      projectionError = error
    }

    expect(projectionError).toBeInstanceOf(MainLogEventProjectionError)
    expect(String(projectionError)).toBe(
      'MainLogEventProjectionError: Invalid Main log event field: runId'
    )
    expect(String(projectionError)).not.toContain('SECRET_VALUE')
  })

  it('fingerprints unsafe opaque correlation identifiers without changing business IDs', () => {
    const unsafeSessionId = `legacy-session-conversation / 雪 ${'x'.repeat(300)}`
    const unsafeMessageId = 'legacy-msg-message / 雪'
    const sessionFingerprint = `sha256:${createHash('sha256')
      .update(unsafeSessionId, 'utf8')
      .digest('hex')}`
    const messageFingerprint = `sha256:${createHash('sha256')
      .update(unsafeMessageId, 'utf8')
      .digest('hex')}`
    const projected = projectMainLogEvent('agent.run.started', {
      runId: 'run_1',
      sessionId: unsafeSessionId,
      messageId: unsafeMessageId,
      runKind: 'loop',
      initialRequestSeq: 0
    })

    expect(projected.context).toMatchObject({
      runId: 'run_1',
      sessionId: sessionFingerprint,
      messageId: messageFingerprint
    })
    expect(isProjectedMainLogEvent('agent.run.started', 'info', projected.context)).toBe(true)
    expect(JSON.stringify(projected)).not.toContain('conversation /')
    expect(JSON.stringify(projected)).not.toContain('message /')

    const reservedSourceId = sessionFingerprint
    const reservedProjection = projectMainLogEvent('agent.run.started', {
      runId: 'run_2',
      sessionId: reservedSourceId,
      messageId: 'message_2',
      runKind: 'loop',
      initialRequestSeq: 0
    })
    expect(reservedProjection.context.sessionId).not.toBe(sessionFingerprint)
    expect(isProjectedMainLogEvent('agent.run.started', 'info', reservedProjection.context)).toBe(
      true
    )
  })

  it('retains only allowlisted safe Error fields', () => {
    const projected = projectMainLogEvent('app.shutdown.terminal', {
      outcome: 'failed',
      durationMs: 10,
      error: {
        category: 'persistence',
        code: 'SECRET_FREE_FORM_CODE',
        retryable: true,
        message: 'SECRET_ERROR_MESSAGE',
        responseBody: 'SECRET_RESPONSE'
      }
    } as never)

    expect(projected.context).toEqual({
      outcome: 'failed',
      durationMs: 10,
      error: { category: 'persistence', retryable: true }
    })
    expect(JSON.stringify(projected)).not.toContain('SECRET_')
  })

  it('projects shutdown action failures without caught error content', () => {
    const projected = projectMainLogEvent('app.shutdown.action.failed', {
      reason: 'data_reset',
      durationMs: 1250,
      error: {
        category: 'persistence',
        message: 'SECRET_RESET_PATH',
        stack: 'SECRET_STACK'
      }
    } as never)

    expect(projected).toEqual({
      level: 'error',
      context: {
        reason: 'data_reset',
        durationMs: 1250,
        error: { category: 'persistence' }
      }
    })
    expect(JSON.stringify(projected)).not.toContain('SECRET_')
    expect(
      isProjectedMainLogEvent(
        'app.shutdown.action.failed',
        projected.level,
        JSON.parse(JSON.stringify(projected.context))
      )
    ).toBe(true)
  })

  it('projects database initialization health without schema or error content', () => {
    const degraded = projectMainLogEvent('database.initialization.terminal', {
      outcome: 'completed',
      durationMs: 42.1256,
      repairAttempted: true,
      schemaDiagnosis: 'completed',
      repairableIssueCount: 1,
      manualIssueCount: 2,
      issues: ['SECRET_TABLE.SECRET_COLUMN']
    } as never)
    expect(degraded).toEqual({
      level: 'warn',
      context: {
        outcome: 'completed',
        durationMs: 42.126,
        repairAttempted: true,
        schemaDiagnosis: 'completed',
        repairableIssueCount: 1,
        manualIssueCount: 2
      }
    })

    const failed = projectMainLogEvent('database.initialization.terminal', {
      outcome: 'failed',
      durationMs: 10,
      repairAttempted: false,
      schemaDiagnosis: 'not_completed',
      repairableIssueCount: 0,
      manualIssueCount: 0,
      error: { category: 'integrity' }
    })
    expect(failed.level).toBe('error')
    expect(failed.context.error).toEqual({ category: 'integrity' })

    const schemaFailure = projectMainLogEvent('database.initialization.terminal', {
      outcome: 'failed',
      durationMs: 12,
      repairAttempted: true,
      schemaDiagnosis: 'not_completed',
      repairableIssueCount: 0,
      manualIssueCount: 0,
      error: {
        category: 'schema',
        reason: 'missing-column',
        objectName: 'SECRET_SCHEMA_OBJECT'
      }
    } as never)
    expect(schemaFailure.context.error).toEqual({
      category: 'schema',
      reason: 'missing-column'
    })
    expect(
      isProjectedMainLogEvent(
        'database.initialization.terminal',
        schemaFailure.level,
        JSON.parse(JSON.stringify(schemaFailure.context))
      )
    ).toBe(true)
    expect(JSON.stringify([degraded, failed, schemaFailure])).not.toContain('SECRET_')
  })

  it('projects fixed startup component failures without source error content', () => {
    const projected = projectMainLogEvent('app.startup.component.failed', {
      startupRunId: 'main:123:1',
      component: 'remote_runtime',
      error: {
        category: 'configuration',
        message: 'SECRET_REMOTE_URL',
        retryable: true
      }
    } as never)

    expect(projected).toEqual({
      level: 'warn',
      context: {
        startupRunId: 'main:123:1',
        component: 'remote_runtime',
        error: { category: 'configuration' }
      }
    })
    expect(JSON.stringify(projected)).not.toContain('SECRET_REMOTE_URL')
    expect(projected.context.error).not.toHaveProperty('retryable')
  })

  it.each([
    'disabled_agent_tool_capability_cleanup',
    'legacy_import',
    'rtk_health_check',
    'sqlite_mainline_normalization',
    'toolchain_gc',
    'usage_stats_backfill'
  ] as const)('accepts the background startup component %s', (component) => {
    expect(
      projectMainLogEvent('app.startup.component.failed', {
        startupRunId: 'main:123:1',
        component,
        error: { category: component === 'rtk_health_check' ? 'resource' : 'persistence' }
      }).context
    ).toEqual({
      startupRunId: 'main:123:1',
      component,
      error: { category: component === 'rtk_health_check' ? 'resource' : 'persistence' }
    })
  })

  it('keeps reconciliation terminal events terminal-only', () => {
    const identity = {
      parentSessionId: 'parent_1',
      childSessionId: 'child_1',
      delegationId: 'delegation_1',
      turnId: 'turn_1'
    }

    expect(
      projectMainLogEvent('orchestration.delegation.reconciliation.terminal', {
        ...identity,
        outcome: 'settled'
      })
    ).toEqual({ level: 'info', context: { ...identity, outcome: 'settled' } })
    expect(() =>
      projectMainLogEvent('orchestration.delegation.reconciliation.terminal', {
        ...identity,
        outcome: 'resumed'
      } as never)
    ).toThrow(MainLogEventProjectionError)
  })

  it('omits an unavailable cross-restart delegation duration', () => {
    const projected = projectMainLogEvent('orchestration.delegation.turn.terminal', {
      parentSessionId: 'parent_1',
      childSessionId: 'child_1',
      delegationId: 'delegation_1',
      turnId: 'turn_1',
      status: 'completed'
    })

    expect(projected).toEqual({
      level: 'info',
      context: {
        parentSessionId: 'parent_1',
        childSessionId: 'child_1',
        delegationId: 'delegation_1',
        turnId: 'turn_1',
        status: 'completed'
      }
    })
    expect(
      isProjectedMainLogEvent(
        'orchestration.delegation.turn.terminal',
        projected.level,
        projected.context
      )
    ).toBe(true)
  })

  it('rejects unknown startup components and broad error categories independently', () => {
    const unknownComponent = {
      startupRunId: 'main:123:1',
      component: 'provider_request',
      error: { category: 'unknown' }
    }
    const broadCategory = {
      startupRunId: 'main:123:1',
      component: 'remote_runtime',
      error: { category: 'provider' }
    }

    expect(() =>
      projectMainLogEvent('app.startup.component.failed', unknownComponent as never)
    ).toThrow(MainLogEventProjectionError)
    expect(() =>
      projectMainLogEvent('app.startup.component.failed', broadCategory as never)
    ).toThrow(MainLogEventProjectionError)
  })

  it('projects updater failures without version, URL, or source error content', () => {
    const projected = projectMainLogEvent('app.update.operation.failed', {
      operation: 'download',
      error: {
        category: 'provider',
        message: 'SECRET_DOWNLOAD_URL',
        version: 'SECRET_VERSION'
      }
    } as never)

    expect(projected).toEqual({
      level: 'warn',
      context: {
        operation: 'download',
        error: { category: 'provider' }
      }
    })
    expect(JSON.stringify(projected)).not.toContain('SECRET_')
  })

  it('rejects unknown updater operations and unrelated error categories', () => {
    expect(() =>
      projectMainLogEvent('app.update.operation.failed', {
        operation: 'download_progress',
        error: { category: 'provider' }
      } as never)
    ).toThrow(MainLogEventProjectionError)
    expect(() =>
      projectMainLogEvent('app.update.operation.failed', {
        operation: 'download',
        error: { category: 'permission' }
      } as never)
    ).toThrow(MainLogEventProjectionError)
  })

  it('rejects broad database error categories and drops enriched error fields', () => {
    const broadCategory = {
      outcome: 'failed',
      durationMs: 14,
      repairAttempted: false,
      schemaDiagnosis: 'not_completed',
      repairableIssueCount: 0,
      manualIssueCount: 0,
      error: { category: 'provider' }
    }
    const enrichedError = {
      ...broadCategory,
      error: { category: 'persistence', code: 'SECRET_COLUMN', retryable: true }
    }
    const schemaWithoutReason = {
      ...broadCategory,
      error: { category: 'schema' }
    }

    expect(() =>
      projectMainLogEvent('database.initialization.terminal', broadCategory as never)
    ).toThrow(MainLogEventProjectionError)
    const projected = projectMainLogEvent(
      'database.initialization.terminal',
      enrichedError as never
    )
    expect(projected.context.error).toEqual({ category: 'persistence' })
    expect(JSON.stringify(projected)).not.toContain('SECRET_COLUMN')
    expect(projected.context.error).not.toHaveProperty('retryable')
    expect(() =>
      projectMainLogEvent('database.initialization.terminal', schemaWithoutReason as never)
    ).toThrow(MainLogEventProjectionError)
  })

  it('projects fatal errors as category-only even when message text resembles a stack frame', () => {
    const error = new Error(
      'SECRET_FATAL_MESSAGE\nat LEAK_SECRET (/tmp/src/main/LEAK_SECRET.ts:1:1)'
    )
    error.stack = [
      'Error: SECRET_OVERWRITTEN_STACK',
      '    at LEAK_SECRET (/Users/alice/deepchat/src/main/LEAK_SECRET.ts:1:1)'
    ].join('\n')

    const projected = projectMainLogEvent('process.uncaught_exception', { error })
    const serialized = JSON.stringify(projected)

    expect(projected).toEqual({
      level: 'error',
      context: {
        error: { category: 'unknown' }
      }
    })
    expect(serialized).not.toContain('SECRET_FATAL_MESSAGE')
    expect(serialized).not.toContain('SECRET_OVERWRITTEN_STACK')
    expect(serialized).not.toContain('LEAK_SECRET')
    expect(serialized).not.toContain('/Users/alice')
  })

  it('does not invoke Error getters while projecting fatal diagnostics', () => {
    let getterCalls = 0
    const error = Object.create(Error.prototype)
    Object.defineProperty(error, 'name', {
      get() {
        getterCalls += 1
        return 'TimeoutError'
      }
    })
    Object.defineProperty(error, 'stack', {
      get() {
        getterCalls += 1
        return 'Error: SECRET'
      }
    })

    const projected = projectMainLogEvent('process.unhandled_rejection', { error })

    expect(projected.context).toEqual({ error: { category: 'unknown' } })
    expect(getterCalls).toBe(0)
  })

  it('classifies native AbortError and TimeoutError DOMExceptions without persisting content', () => {
    const abort = projectMainLogEvent('process.unhandled_rejection', {
      error: new DOMException('SECRET_ABORT_REASON', 'AbortError')
    })
    const timeout = projectMainLogEvent('process.unhandled_rejection', {
      error: new DOMException('SECRET_TIMEOUT_REASON', 'TimeoutError')
    })

    expect(abort.context).toEqual({ error: { category: 'aborted' } })
    expect(timeout.context).toEqual({ error: { category: 'timeout' } })
    expect(JSON.stringify([abort, timeout])).not.toContain('SECRET_')
  })

  it('accepts every fatal error classification in persisted-context validation', () => {
    const errors = [
      new DOMException('SECRET', 'AbortError'),
      new DOMException('SECRET', 'TimeoutError'),
      new Error('SECRET')
    ]

    for (const error of errors) {
      const context = { error: classifyMainLogError(error) }
      expect(isProjectedMainLogEvent('process.unhandled_rejection', 'error', context)).toBe(true)
    }
  })

  it('classifies startup-safe errors without carrying error content', () => {
    expect(classifyMainLogError(new DOMException('SECRET', 'TimeoutError'))).toEqual({
      category: 'timeout'
    })
    expect(classifyMainLogError(new Error('SECRET'))).toEqual({ category: 'unknown' })
  })

  it('accepts data reset as an explicit shutdown reason', () => {
    expect(projectMainLogEvent('app.shutdown.started', { reason: 'data_reset' })).toEqual({
      level: 'info',
      context: { reason: 'data_reset' }
    })
  })

  it('uses the native DOMException name without invoking shadowing properties', () => {
    let getterCalls = 0
    const accessorShadow = new DOMException('SECRET_ABORT_REASON', 'AbortError')
    Object.defineProperty(accessorShadow, 'name', {
      get() {
        getterCalls += 1
        return 'TimeoutError'
      }
    })
    const dataShadow = new DOMException('SECRET_TIMEOUT_REASON', 'TimeoutError')
    Object.defineProperty(dataShadow, 'name', { value: 'AbortError' })

    expect(
      projectMainLogEvent('process.unhandled_rejection', { error: accessorShadow }).context
    ).toEqual({ error: { category: 'aborted' } })
    expect(
      projectMainLogEvent('process.unhandled_rejection', { error: dataShadow }).context
    ).toEqual({ error: { category: 'timeout' } })
    expect(getterCalls).toBe(0)
  })

  it('reads only allowlisted data properties without invoking getters', () => {
    let getterCalls = 0
    const nestedGetterInput = {
      outcome: 'failed',
      durationMs: 10,
      error: { category: 'persistence' }
    }
    Object.defineProperty(nestedGetterInput.error, 'code', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'SECRET_ERROR_CODE'
      }
    })
    expect(
      projectMainLogEvent('app.shutdown.terminal', nestedGetterInput as never).context
    ).toEqual({
      outcome: 'failed',
      durationMs: 10,
      error: { category: 'persistence' }
    })

    const knownGetterInput = { outcome: 'completed' }
    Object.defineProperty(knownGetterInput, 'durationMs', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 10
      }
    })
    expect(() => projectMainLogEvent('app.shutdown.terminal', knownGetterInput as never)).toThrow(
      MainLogEventProjectionError
    )

    const unknownGetterInput = { outcome: 'completed', durationMs: 10 }
    Object.defineProperty(unknownGetterInput, 'payload', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'SECRET_PAYLOAD'
      }
    })
    expect(
      projectMainLogEvent('app.shutdown.terminal', unknownGetterInput as never).context
    ).toEqual({ outcome: 'completed', durationMs: 10 })
    expect(getterCalls).toBe(0)
  })

  it('rejects Proxy inputs without invoking their traps', () => {
    let trapCalls = 0
    const input = new Proxy(
      { outcome: 'completed' as const, durationMs: 10 },
      {
        getPrototypeOf() {
          trapCalls += 1
          return Object.prototype
        },
        getOwnPropertyDescriptor(target, key) {
          trapCalls += 1
          return Reflect.getOwnPropertyDescriptor(target, key)
        }
      }
    )

    expect(() => projectMainLogEvent('app.shutdown.terminal', input)).toThrow(
      MainLogEventProjectionError
    )
    expect(trapCalls).toBe(0)

    const fatalError = new Proxy(new Error('SECRET'), {
      getPrototypeOf(target) {
        trapCalls += 1
        return Reflect.getPrototypeOf(target)
      }
    })
    expect(
      projectMainLogEvent('process.uncaught_exception', { error: fatalError }).context
    ).toEqual({
      error: { category: 'unknown' }
    })
    expect(trapCalls).toBe(0)
  })

  it('matches Execution Journal run kinds and omits Loop-only fields for deferred tools', () => {
    const projected = projectMainLogEvent('agent.run.started', {
      runId: 'run_1',
      sessionId: 'session_1',
      messageId: 'message_1',
      runKind: 'deferred_tool',
      initialRequestSeq: 99
    } as never)

    expect(projected.context).toEqual({
      runId: 'run_1',
      sessionId: 'session_1',
      messageId: 'message_1',
      runKind: 'deferred_tool'
    })
  })

  it('requires safe classifications for failed terminal events', () => {
    expect(() =>
      projectMainLogEvent('app.shutdown.terminal', {
        outcome: 'failed',
        durationMs: 10
      } as never)
    ).toThrow(MainLogEventProjectionError)

    const projected = projectMainLogEvent('app.shutdown.terminal', {
      outcome: 'completed',
      durationMs: 10,
      error: { category: 'persistence', code: 'SHOULD_BE_OMITTED' }
    } as never)
    expect(projected.context).toEqual({ outcome: 'completed', durationMs: 10 })
  })

  it('clamps long durations and rejects invalid retryability', () => {
    expect(
      projectMainLogEvent('app.shutdown.terminal', {
        outcome: 'completed',
        durationMs: 31 * 24 * 60 * 60 * 1000
      }).context.durationMs
    ).toBe(30 * 24 * 60 * 60 * 1000)
    expect(() =>
      projectMainLogEvent('app.shutdown.terminal', {
        outcome: 'failed',
        durationMs: 10,
        error: { category: 'persistence', retryable: 'SECRET_NOT_BOOLEAN' }
      })
    ).toThrow(MainLogEventProjectionError)
  })

  it('rejects unknown event names including object prototype properties', () => {
    expect(() => projectMainLogEvent('toString' as never, {} as never)).toThrow(
      MainLogEventProjectionError
    )
  })

  it('does not warn for an expected admission cancellation', () => {
    const correlation = {
      kind: 'live_delegation' as const,
      parentSessionId: 'parent_1',
      delegationId: 'delegation_1',
      turnId: 'turn_1',
      acquisitionSeq: 1,
      waitMs: 5,
      capacity: 6,
      active: 5,
      pending: 0
    }

    expect(
      projectMainLogEvent('agent.admission.rejected', {
        ...correlation,
        reason: 'aborted'
      }).level
    ).toBe('info')
    expect(
      projectMainLogEvent('agent.admission.rejected', {
        ...correlation,
        reason: 'queue_full'
      }).level
    ).toBe('warn')
  })

  it('round-trips admission events when measured durations are unavailable', () => {
    const correlation = {
      kind: 'live_delegation' as const,
      parentSessionId: 'parent_1',
      delegationId: 'delegation_1',
      turnId: 'turn_1',
      acquisitionSeq: 1
    }
    const events = [
      {
        event: 'agent.admission.granted' as const,
        durationField: 'waitMs',
        projected: projectMainLogEvent('agent.admission.granted', {
          ...correlation,
          capacity: 6,
          active: 1,
          pending: 0
        })
      },
      {
        event: 'agent.admission.released' as const,
        durationField: 'holdMs',
        projected: projectMainLogEvent('agent.admission.released', {
          ...correlation,
          reason: 'permit_released',
          active: 0,
          pending: 0
        })
      },
      {
        event: 'agent.admission.rejected' as const,
        durationField: 'waitMs',
        projected: projectMainLogEvent('agent.admission.rejected', {
          ...correlation,
          reason: 'closed',
          capacity: 6,
          active: 0,
          pending: 0
        })
      }
    ]

    for (const { durationField, event, projected } of events) {
      expect(projected.context).not.toHaveProperty(durationField)
      expect(isProjectedMainLogEvent(event, projected.level, projected.context)).toBe(true)
    }
  })

  it('validates admission distributions and emits their bounded summaries', () => {
    const projected = projectMainLogEvent('agent.admission.closed', {
      capacity: 6,
      active: 0,
      pending: 0,
      activeHighWater: 6,
      pendingHighWater: 8,
      granted: 20,
      rejected: 2,
      observationsDropped: 0,
      waitMs: { samples: 20, p50: 4, p95: 80, max: 120 },
      holdMs: { samples: 20, p50: 100, p95: 800, max: 1200 }
    })

    expect(projected.level).toBe('info')
    expect(projected.context.waitMs).toEqual({ samples: 20, p50: 4, p95: 80, max: 120 })
    expect(projected.context.holdMs).toEqual({
      samples: 20,
      p50: 100,
      p95: 800,
      max: 1200
    })
  })

  it('clamps ordered long distributions without hiding raw ordering violations', () => {
    const day = 24 * 60 * 60 * 1000
    const base = {
      capacity: 6,
      active: 0,
      pending: 0,
      activeHighWater: 0,
      pendingHighWater: 0,
      granted: 1,
      rejected: 0,
      observationsDropped: 0,
      holdMs: { samples: 0, p50: null, p95: null, max: null }
    }

    expect(
      projectMainLogEvent('agent.admission.closed', {
        ...base,
        waitMs: { samples: 1, p50: 31 * day, p95: 35 * day, max: Number.MAX_VALUE }
      }).context.waitMs
    ).toEqual({ samples: 1, p50: 30 * day, p95: 30 * day, max: 30 * day })
    expect(() =>
      projectMainLogEvent('agent.admission.closed', {
        ...base,
        waitMs: { samples: 1, p50: 40 * day, p95: 35 * day, max: 31 * day }
      })
    ).toThrow(MainLogEventProjectionError)
  })

  it('rejects inconsistent or unordered admission distributions', () => {
    const base = {
      capacity: 6,
      active: 0,
      pending: 0,
      activeHighWater: 0,
      pendingHighWater: 0,
      granted: 0,
      rejected: 0,
      observationsDropped: 0
    }

    expect(() =>
      projectMainLogEvent('agent.admission.closed', {
        ...base,
        waitMs: { samples: 0, p50: 0, p95: null, max: null },
        holdMs: { samples: 0, p50: null, p95: null, max: null }
      })
    ).toThrow(MainLogEventProjectionError)
    expect(() =>
      projectMainLogEvent('agent.admission.closed', {
        ...base,
        waitMs: { samples: 1, p50: 10, p95: 5, max: 20 },
        holdMs: { samples: 0, p50: null, p95: null, max: null }
      })
    ).toThrow(MainLogEventProjectionError)
    expect(() =>
      projectMainLogEvent('agent.admission.closed', {
        ...base,
        waitMs: { samples: 1, p50: null, p95: 5, max: 20 },
        holdMs: { samples: 0, p50: null, p95: null, max: null }
      })
    ).toThrow(MainLogEventProjectionError)
    expect(() =>
      projectMainLogEvent('agent.admission.closed', {
        ...base,
        granted: 257,
        waitMs: { samples: 257, p50: 1, p95: 2, max: 3 },
        holdMs: { samples: 0, p50: null, p95: null, max: null }
      })
    ).toThrow(MainLogEventProjectionError)
  })
})
