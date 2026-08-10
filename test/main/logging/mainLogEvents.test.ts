import { describe, expect, it } from 'vitest'
import {
  MainLogEventProjectionError,
  normalizeMainLogRunStopReason,
  projectMainLogEvent
} from '@/logging/mainLogEvents'

describe('Main log event projection', () => {
  it('normalizes unknown durable stop reasons without persisting their text', () => {
    expect(normalizeMainLogRunStopReason('SECRET_PROVIDER_DETAIL', 'completed')).toBe('complete')
    expect(normalizeMainLogRunStopReason('SECRET_PROVIDER_DETAIL', 'paused')).toBe('interaction')
    expect(normalizeMainLogRunStopReason('SECRET_PROVIDER_DETAIL', 'aborted')).toBe('user_stop')
    expect(normalizeMainLogRunStopReason('SECRET_PROVIDER_DETAIL', 'error')).toBe('provider_error')
    expect(normalizeMainLogRunStopReason('journal_error', 'error')).toBe('journal_error')
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
      error: { category: 'provider', code: 'RATE_LIMITED', retryable: true }
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
        error: { category: 'provider', code: 'RATE_LIMITED', retryable: true }
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

  it('retains only allowlisted safe Error fields', () => {
    const projected = projectMainLogEvent('app.shutdown.terminal', {
      outcome: 'failed',
      durationMs: 10,
      error: {
        category: 'persistence',
        code: 'SQLITE_BUSY',
        retryable: true,
        message: 'SECRET_ERROR_MESSAGE',
        responseBody: 'SECRET_RESPONSE'
      }
    } as never)

    expect(projected.context).toEqual({
      outcome: 'failed',
      durationMs: 10,
      error: { category: 'persistence', code: 'SQLITE_BUSY', retryable: true }
    })
    expect(JSON.stringify(projected)).not.toContain('SECRET_')
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
    expect(JSON.stringify([degraded, failed])).not.toContain('SECRET_')
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
  })

  it('projects fatal stack frames without the message or absolute paths', () => {
    const error = new Error('SECRET_FATAL_MESSAGE')
    error.stack = [
      'Error: SECRET_FATAL_MESSAGE',
      '    at explode (/Users/alice/deepchat/src/main/example.ts:10:2)',
      '    at dependency (/Users/alice/deepchat/node_modules/example/index.js:4:1)'
    ].join('\n')

    const projected = projectMainLogEvent('process.uncaught_exception', { error })
    const serialized = JSON.stringify(projected)

    expect(projected).toEqual({
      level: 'error',
      context: {
        error: {
          category: 'unknown',
          stack: ['at explode (<app>/src/main/example.ts:10:2)']
        }
      }
    })
    expect(serialized).not.toContain('SECRET_FATAL_MESSAGE')
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
    expect(() => projectMainLogEvent('app.shutdown.terminal', nestedGetterInput as never)).toThrow(
      MainLogEventProjectionError
    )

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

  it('bounds durations, error codes, and fatal stack frames', () => {
    expect(() =>
      projectMainLogEvent('app.shutdown.terminal', {
        outcome: 'completed',
        durationMs: 30 * 24 * 60 * 60 * 1000 + 1
      })
    ).toThrow(MainLogEventProjectionError)
    expect(() =>
      projectMainLogEvent('app.shutdown.terminal', {
        outcome: 'failed',
        durationMs: 10,
        error: { category: 'persistence', code: 'NOT\nA_CODE' }
      })
    ).toThrow(MainLogEventProjectionError)

    const error = new Error('SECRET')
    error.stack = `Error: SECRET\n    at ${'x'.repeat(600)}`
    const projected = projectMainLogEvent('process.uncaught_exception', { error })
    expect(projected.context).toEqual({ error: { category: 'unknown' } })
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
