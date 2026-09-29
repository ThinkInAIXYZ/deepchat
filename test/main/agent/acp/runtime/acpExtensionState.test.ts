import { describe, expect, it } from 'vitest'
import {
  getAcpUsageSinceFork,
  mergeAcpUsage,
  createAcpExtensionState,
  disconnectAcpExtensionState
} from '@/agent/acp/runtime/acpExtensionState'
import { parseLodyNotification } from '@/agent/acp/runtime/acpLodyExtensions'
import { LODY_EXTENSION_METHODS } from 'acp-extension-core'

const usage = (inputTokens: number, costUSD?: number) => ({
  inputTokens,
  outputTokens: 3,
  cacheReadInputTokens: 1,
  ...(costUSD === undefined ? {} : { costUSD })
})
const report = (inputTokens: number, scope?: string, costUSD?: number) => ({
  sessionId: 'remote',
  usage: usage(inputTokens, costUSD),
  modelUsage: { model: usage(inputTokens, costUSD) },
  ...(scope ? { _meta: { lody: { usageScopeId: scope } } } : {})
})

describe('ACP cumulative accounting', () => {
  it('deduplicates cumulative reports and embedded delta, adds distinct scopes, and preserves unknown cost', () => {
    const update = report(10, 'a', 0.1)
    const initial = mergeAcpUsage(undefined, update, 'connection-1')
    const repeated = mergeAcpUsage(
      initial,
      { ...update, delta: { usage: update.usage, modelUsage: update.modelUsage } },
      'connection-1'
    )
    expect(repeated.total).toEqual(initial.total)
    const resumed = mergeAcpUsage(repeated, report(12, 'a', 0.12), 'connection-2')
    expect(resumed.total.inputTokens).toBe(12)
    expect(resumed.incomplete).toBe(false)
    const distinct = mergeAcpUsage(resumed, report(5, 'b'), 'connection-2')
    expect(distinct.total.inputTokens).toBe(17)
    expect(distinct.total.costUSD).toBeUndefined()
  })

  it('flags unproven unscoped reconnects and counter resets without double counting', () => {
    const prior = mergeAcpUsage(undefined, report(50, undefined, 1), 'old')
    const reset = mergeAcpUsage(prior, report(2, undefined, 0.02), 'new')
    expect(reset.total.inputTokens).toBe(50)
    expect(reset.total.costUSD).toBe(1)
    expect(reset.latest?.inputTokens).toBe(2)
    expect(reset.incomplete).toBe(true)
    expect(
      mergeAcpUsage(reset, { sessionId: 'remote', usage: usage(5) }, 'new').total.inputTokens
    ).toBe(50)
  })

  it('marks restored running children and context as stale without affecting a different remote session', () => {
    const state = createAcpExtensionState('old', 'remote', {})
    state.context = { used: 10, size: 100 }
    state.steers = { instruction: 'accepted' }
    state.runs.child = {
      runId: 'child',
      blocks: [],
      snapshot: {
        state: 'running',
        support: { stream: ['text'], progress: true, outputRead: 'none', cancel: false }
      }
    }
    const disconnected = disconnectAcpExtensionState(state)
    expect(disconnected.connected).toBe(false)
    expect(disconnected.runs.child.snapshot?.state).toBe('unknown')
    const restored = createAcpExtensionState('new', 'remote', {}, state)
    expect(restored.context?.stale).toBe(true)
    expect(restored.steers.instruction).toBe('unknown')
    expect(createAcpExtensionState('new', 'different', {}, state).runs).toEqual({})
  })

  it('subtracts inherited fork usage once while preserving unknown cost', () => {
    const initial = mergeAcpUsage(undefined, report(50), 'connection')
    initial.inheritedBaseline = structuredClone(initial.modelUsage)
    expect(getAcpUsageSinceFork(initial)?.inputTokens).toBe(0)
    const current = mergeAcpUsage(initial, report(75, undefined, 1), 'connection')
    expect(current.sinceFork?.inputTokens).toBe(25)
    expect(current.sinceFork?.costUSD).toBeUndefined()
    expect(mergeAcpUsage(current, report(75, undefined, 1), 'connection').sinceFork).toEqual(
      current.sinceFork
    )
  })

  it('rejects invalid and oversized remote payloads', () => {
    expect(parseLodyNotification(LODY_EXTENSION_METHODS.sessionUsageUpdate, report(-1))).toBeNull()
    expect(
      parseLodyNotification(LODY_EXTENSION_METHODS.sessionUsageUpdate, report(1, 'x'.repeat(257)))
    ).toBeNull()
    expect(
      parseLodyNotification(LODY_EXTENSION_METHODS.rateLimitsUpdate, {
        rateLimits: [
          {
            limitId: 'a',
            scope: { providerId: 'a' },
            windows: [{ usedPercent: 101, windowDurationSeconds: null, resetsAtEpochSeconds: null }]
          }
        ]
      })
    ).toBeNull()
  })
})
