import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aggregateNativeAgentEvalReports,
  runNativeAgentEvalScenario,
  type NativeAgentEvalReport
} from './harness'
import { NATIVE_AGENT_EVAL_SCENARIOS } from './scenarios'

const EXPECTED_SCENARIO_IDS = [
  'direct-completion',
  'max-tokens',
  'single-tool-round',
  'multiple-tool-rounds',
  'tool-failure-recovery',
  'permission-pause',
  'cancellation',
  'pending-input-yield',
  'max-provider-rounds',
  'max-tool-calls',
  'repeated-tool-no-progress',
  'empty-provider-output',
  'generic-provider-error',
  'context-window-error'
]

describe('native Agent deterministic behavior eval', () => {
  const reports: NativeAgentEvalReport[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(NATIVE_AGENT_EVAL_SCENARIOS)('$id', async (scenario) => {
    const report = await runNativeAgentEvalScenario(scenario)
    reports.push(report)

    expect(report).toMatchObject({
      schemaVersion: 1,
      scenarioId: scenario.id,
      passed: true,
      persistedRunId: `request-${scenario.id}`,
      persistedRunOutcome: scenario.expected.persistedRunOutcome,
      persistedRunStopReason: scenario.expected.persistedRunStopReason,
      persistedProviderRounds: scenario.expected.providerRounds,
      persistedToolCalls: scenario.expected.toolCalls,
      persistedUsage: scenario.expected.usage,
      providerRounds: expect.any(Number),
      permissionRequests: expect.any(Number),
      elapsedMs: expect.any(Number),
      usage: {
        inputTokens: expect.toSatisfy((value) => value === null || typeof value === 'number'),
        outputTokens: expect.toSatisfy((value) => value === null || typeof value === 'number'),
        totalTokens: expect.toSatisfy((value) => value === null || typeof value === 'number'),
        cachedInputTokens: expect.toSatisfy((value) => value === null || typeof value === 'number'),
        cacheWriteInputTokens: expect.toSatisfy(
          (value) => value === null || typeof value === 'number'
        )
      }
    })
    expect(report.expectationFailures, JSON.stringify(report, null, 2)).toEqual([])
    expect(report.providerRounds).toBe(scenario.expected.providerRounds)
    expect(report.toolCalls.total).toBe(scenario.expected.toolCalls)
    expect(report.providerRounds).toBeLessThanOrEqual(scenario.budget.maxProviderRounds)
    expect(report.toolCalls.total).toBeLessThanOrEqual(scenario.budget.maxToolCalls)
    expect(report.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  afterAll(() => {
    expect(NATIVE_AGENT_EVAL_SCENARIOS.map((scenario) => scenario.id)).toEqual(
      EXPECTED_SCENARIO_IDS
    )
    expect(reports.map((report) => report.scenarioId).sort()).toEqual(
      [...EXPECTED_SCENARIO_IDS].sort()
    )

    const aggregate = aggregateNativeAgentEvalReports(NATIVE_AGENT_EVAL_SCENARIOS, reports)
    const expectedTotalTokens = NATIVE_AGENT_EVAL_SCENARIOS.reduce(
      (total, scenario) => total + (scenario.expected.usage.totalTokens ?? 0),
      0
    )
    const expectedProviderRounds = NATIVE_AGENT_EVAL_SCENARIOS.reduce(
      (total, scenario) => total + scenario.expected.providerRounds,
      0
    )
    const expectedToolCalls = NATIVE_AGENT_EVAL_SCENARIOS.reduce(
      (total, scenario) => total + scenario.expected.toolCalls,
      0
    )

    expect(aggregate).toEqual({
      schemaVersion: 1,
      scenarios: EXPECTED_SCENARIO_IDS.length,
      passed: EXPECTED_SCENARIO_IDS.length,
      passRate: 1,
      totalProviderRounds: expectedProviderRounds,
      providerRoundBudget: 150,
      totalToolCalls: expectedToolCalls,
      toolCallBudget: 139,
      totalTokens: expectedTotalTokens,
      withinCallBudgets: true
    })

    const overBudgetReports = reports.map((report) =>
      report.scenarioId === 'multiple-tool-rounds'
        ? { ...report, providerRounds: 5, toolCalls: { ...report.toolCalls, total: 4 } }
        : report
    )
    expect(
      aggregateNativeAgentEvalReports(NATIVE_AGENT_EVAL_SCENARIOS, overBudgetReports)
        .withinCallBudgets
    ).toBe(false)
  })
})
