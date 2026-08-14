import { describe, expect, it } from 'vitest'
import {
  createToolSurfaceCanaryRunEvidenceRecorder,
  ToolSurfaceCanaryDiagnosticsRegistry
} from '@/agent/deepchat/runtime/toolSurfaceCanaryDiagnostics'
import {
  TOOL_SURFACE_PROVIDER_PRICING_SCHEMA_VERSION,
  ToolSurfaceProviderPricingCatalogV1
} from '@/agent/deepchat/runtime/toolSurfaceCanaryPricing'

describe('Tool Surface canary diagnostics', () => {
  const scope = {
    sessionId: 'session-1',
    providerId: 'provider-1',
    modelId: 'model-1',
    toolProfile: 'code' as const
  }
  const emptyEvidence = () => createToolSurfaceCanaryRunEvidenceRecorder().snapshot()

  it('aggregates actual adapter cost inputs, rounds, latency, outcomes, and catalog churn', () => {
    const registry = new ToolSurfaceCanaryDiagnosticsRegistry({
      sampleCapacity: 4,
      pricingPolicy: {
        schemaVersion: TOOL_SURFACE_PROVIDER_PRICING_SCHEMA_VERSION,
        pricingVersion: 'test-pricing-2026-08-12',
        currency: 'USD',
        entries: [
          {
            providerId: 'provider-1',
            modelId: 'model-1',
            inputIncludesCacheReadTokens: true,
            inputIncludesCacheWriteTokens: true,
            nanoUsdPerMillionTokens: {
              uncachedInput: 1_000_000_000,
              output: 2_000_000_000,
              cacheRead: 100_000_000,
              cacheWrite: 1_250_000_000
            }
          }
        ]
      }
    })
    const record = (catalogHash: string, outcome: 'completed' | 'error') => {
      const evidence = createToolSurfaceCanaryRunEvidenceRecorder()
      evidence.recordDiscovery({ kind: 'search', stableTargetKeys: ['mcp:remote:calendar'] })
      evidence.recordDiscovery({ kind: 'search', stableTargetKeys: ['mcp:remote:calendar'] })
      evidence.recordSettledToolResult(outcome === 'completed')
      registry.recordRun({
        scope,
        adapterMode: 'cli-programmatic',
        policyVersion: 'cli-programmatic-v1',
        catalogHash,
        catalogToolCount: 80,
        catalogDefinitionTokens: 12_000,
        outcome,
        durationMs: outcome === 'completed' ? 100 : 200,
        ttftMs: outcome === 'completed' ? 25 : null,
        providerRounds: outcome === 'completed' ? 1 : 3,
        providerAttemptsTruncated: false,
        evidence: evidence.snapshot(),
        providerAttempts: [
          {
            requestSeq: 1,
            physicalAttempt: 1,
            usage: {
              inputTokens: 100,
              outputTokens: 20,
              cacheReadTokens: 80,
              cacheWriteTokens: 5
            }
          },
          {
            requestSeq: 2,
            physicalAttempt: 1,
            usage: {
              inputTokens: 50,
              outputTokens: 10,
              cacheReadTokens: 0,
              cacheWriteTokens: 0
            }
          }
        ]
      })
    }

    record('catalog-a', 'completed')
    record('catalog-a', 'completed')
    record('catalog-b', 'error')

    expect(registry.snapshot({ providerId: 'provider-1', modelId: 'model-1' })).toEqual({
      schemaVersion: 4,
      recording: { globalRejectedRuns: 0 },
      assignments: [],
      cohorts: [
        expect.objectContaining({
          adapterMode: 'cli-programmatic',
          policyVersion: 'cli-programmatic-v1',
          pricingVersion: 'test-pricing-2026-08-12',
          catalogBand: '65-256',
          toolProfile: 'code',
          runs: {
            observed: 3,
            outcomes: { completed: 2, paused: 0, aborted: 0, error: 1, unsettled: 0 },
            catalogComparisons: 2,
            catalogChanges: 1,
            providerAttemptSamplesTruncated: 0,
            evidenceTruncated: 0
          },
          attempts: {
            observed: 6,
            withUsage: 6,
            withCacheReadMetric: 6,
            withCacheWriteMetric: 6
          },
          discovery: {
            searchCalls: 6,
            describeCalls: 0,
            failedCalls: 0,
            zeroResultCalls: 0,
            returnedTargetResults: 6,
            repeatedSearchTargetResults: 3
          },
          quality: {
            settledToolResults: 3,
            successfulSettledToolResults: 2,
            failedSettledToolResults: 1
          },
          cost: {
            currency: 'USD',
            pricedRuns: 3,
            unavailableRuns: {
              'missing-pricing': 0,
              'incomplete-usage': 0,
              'missing-cache-metrics': 0,
              'invalid-accounting': 0,
              overflow: 0,
              truncated: 0
            }
          },
          metrics: expect.objectContaining({
            durationMs: { samples: 3, p50: 100, p95: 200, max: 200 },
            ttftMs: { samples: 2, p50: 25, p95: 25, max: 25 },
            providerRounds: { samples: 3, p50: 1, p95: 3, max: 3 },
            extraProviderRounds: { samples: 3, p50: 0, p95: 2, max: 2 },
            requestSequences: { samples: 3, p50: 2, p95: 2, max: 2 },
            physicalAttempts: { samples: 3, p50: 2, p95: 2, max: 2 },
            inputTokens: { samples: 3, p50: 150, p95: 150, max: 150 },
            outputTokens: { samples: 3, p50: 30, p95: 30, max: 30 },
            cacheReadTokens: { samples: 3, p50: 80, p95: 80, max: 80 },
            cacheWriteTokens: { samples: 3, p50: 5, p95: 5, max: 5 },
            billedCostNanoUsd: { samples: 3, p50: 139_250, p95: 139_250, max: 139_250 },
            discoveryCalls: { samples: 3, p50: 2, p95: 2, max: 2 },
            repeatedSearchTargetResults: { samples: 3, p50: 1, p95: 1, max: 1 },
            settledToolResults: { samples: 3, p50: 1, p95: 1, max: 1 },
            catalogDefinitionTokens: {
              samples: 3,
              p50: 12_000,
              p95: 12_000,
              max: 12_000
            }
          })
        })
      ]
    })
    expect(registry.snapshot({ providerId: 'provider-2', modelId: 'model-1' })).toBeNull()
  })

  it('distinguishes unavailable cache metrics from reported zero and bounds cohorts', () => {
    const registry = new ToolSurfaceCanaryDiagnosticsRegistry({
      sampleCapacity: 1,
      cohortCapacity: 1,
      lineageCapacity: 1
    })
    registry.recordRun({
      scope,
      adapterMode: 'full',
      policyVersion: 'full-v1',
      catalogHash: 'catalog-a',
      catalogToolCount: 20,
      catalogDefinitionTokens: 2_000,
      outcome: 'completed',
      durationMs: 10,
      ttftMs: null,
      providerRounds: 1,
      providerAttemptsTruncated: false,
      evidence: emptyEvidence(),
      providerAttempts: [
        { requestSeq: 1, physicalAttempt: 1, usage: { inputTokens: 10 } }
      ]
    })
    registry.recordRun({
      scope,
      adapterMode: 'native-activation',
      policyVersion: 'automatic-adapter-v1',
      catalogHash: 'catalog-b',
      catalogToolCount: 40,
      catalogDefinitionTokens: 5_000,
      outcome: 'completed',
      durationMs: 20,
      ttftMs: 5,
      providerRounds: 1,
      providerAttemptsTruncated: false,
      evidence: emptyEvidence(),
      providerAttempts: [
        {
          requestSeq: 2,
          physicalAttempt: 1,
          usage: { inputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 }
        }
      ]
    })

    const snapshot = registry.snapshot({ providerId: 'provider-1', modelId: 'model-1' })
    expect(snapshot?.cohorts).toHaveLength(1)
    expect(snapshot?.cohorts[0]).toMatchObject({
      adapterMode: 'native-activation',
      attempts: { withCacheReadMetric: 1, withCacheWriteMetric: 1 },
      metrics: {
        cacheReadTokens: { samples: 1, p50: 0 },
        cacheWriteTokens: { samples: 1, p50: 0 }
      }
    })
  })

  it('counts every automatic assignment before setup can select an adapter', () => {
    const registry = new ToolSurfaceCanaryDiagnosticsRegistry()

    registry.recordAutomaticAssignment({
      scope,
      cliProgrammaticCapability: 'proven',
      phase: 'entered'
    })
    registry.recordAutomaticAssignment({
      scope,
      cliProgrammaticCapability: 'proven',
      phase: 'setup-failed'
    })
    registry.recordAutomaticAssignment({
      scope,
      cliProgrammaticCapability: 'proven',
      phase: 'entered'
    })
    registry.recordAutomaticAssignment({
      scope,
      cliProgrammaticCapability: 'proven',
      phase: 'selected',
      adapterMode: 'cli-programmatic'
    })

    expect(
      registry.snapshot({ providerId: 'provider-1', modelId: 'model-1' })
    ).toMatchObject({
      schemaVersion: 4,
      recording: { globalRejectedRuns: 0 },
      assignments: [
        {
          toolProfile: 'code',
          cliProgrammaticCapability: 'proven',
          entered: 2,
          selected: 1,
          setupFailed: 1,
          aborted: 0,
          excluded: 0,
          inFlight: 0,
          selectedByAdapter: {
            full: 0,
            'native-activation': 0,
            'cli-programmatic': 1
          }
        }
      ],
      cohorts: []
    })
  })

  it('counts rejected run records without retaining their invalid content', () => {
    const registry = new ToolSurfaceCanaryDiagnosticsRegistry()

    registry.recordRun({
      scope,
      adapterMode: 'full',
      policyVersion: 'full-v1',
      catalogHash: 'catalog-a',
      catalogToolCount: 4,
      catalogDefinitionTokens: 100,
      outcome: 'completed',
      durationMs: Number.MAX_SAFE_INTEGER + 1,
      ttftMs: null,
      providerRounds: 1,
      providerAttempts: [],
      providerAttemptsTruncated: false,
      evidence: emptyEvidence()
    })

    expect(registry.snapshot({ providerId: 'provider-1', modelId: 'model-1' })).toEqual({
      schemaVersion: 4,
      recording: { globalRejectedRuns: 1 },
      assignments: [],
      cohorts: []
    })
  })

  it('forgets only the deleted Session catalog lineage', () => {
    const registry = new ToolSurfaceCanaryDiagnosticsRegistry()
    const record = (sessionId: string, catalogHash: string) =>
      registry.recordRun({
        scope: { ...scope, sessionId },
        adapterMode: 'full',
        policyVersion: 'full-v1',
        catalogHash,
        catalogToolCount: 4,
        catalogDefinitionTokens: 100,
        outcome: 'completed',
        durationMs: 10,
        ttftMs: null,
        providerRounds: 1,
        providerAttempts: [],
        providerAttemptsTruncated: false,
        evidence: emptyEvidence()
      })

    record('session-1', 'catalog-a')
    record('session-1', 'catalog-b')
    registry.clearSession('another-session')
    record('session-1', 'catalog-c')
    registry.clearSession('session-1')
    record('session-1', 'catalog-d')

    expect(
      registry.snapshot({ providerId: 'provider-1', modelId: 'model-1' })?.cohorts[0].runs
    ).toMatchObject({ observed: 4, catalogComparisons: 2, catalogChanges: 2 })
  })

  it('does not aggregate partial provider usage as a complete Run token sample', () => {
    const registry = new ToolSurfaceCanaryDiagnosticsRegistry()
    registry.recordRun({
      scope,
      adapterMode: 'full',
      policyVersion: 'full-v1',
      catalogHash: 'catalog-a',
      catalogToolCount: 4,
      catalogDefinitionTokens: 100,
      outcome: 'error',
      durationMs: 10,
      ttftMs: null,
      providerRounds: 1,
      providerAttemptsTruncated: false,
      evidence: emptyEvidence(),
      providerAttempts: [
        {
          requestSeq: 1,
          physicalAttempt: 1,
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0
          }
        },
        { requestSeq: 1, physicalAttempt: 2, usage: null }
      ]
    })

    expect(
      registry.snapshot({ providerId: 'provider-1', modelId: 'model-1' })?.cohorts[0].metrics
    ).toMatchObject({
      inputTokens: { samples: 0 },
      outputTokens: { samples: 0 },
      cacheReadTokens: { samples: 0 },
      cacheWriteTokens: { samples: 0 },
      billedCostNanoUsd: { samples: 0 }
    })
  })

  it('drops malformed or oversized diagnostic input without affecting routing state', () => {
    const registry = new ToolSurfaceCanaryDiagnosticsRegistry()
    registry.recordRun({
      scope: { ...scope, sessionId: ' session-1 ' },
      adapterMode: 'full',
      policyVersion: 'full-v1',
      catalogHash: 'catalog-a',
      catalogToolCount: 1,
      catalogDefinitionTokens: 1,
      outcome: 'completed',
      durationMs: 1,
      ttftMs: null,
      providerRounds: 1,
      providerAttemptsTruncated: false,
      evidence: emptyEvidence(),
      providerAttempts: []
    })

    expect(
      registry.snapshot({ providerId: 'provider-1', modelId: 'model-1' })?.recording
        .globalRejectedRuns
    ).toBe(1)

    registry.recordRun({
      scope,
      adapterMode: 'full',
      policyVersion: 'full-v1',
      catalogHash: 'catalog-a',
      catalogToolCount: 1,
      catalogDefinitionTokens: 1,
      outcome: 'completed',
      durationMs: 1,
      ttftMs: null,
      providerRounds: 1,
      providerAttemptsTruncated: false,
      evidence: emptyEvidence(),
      providerAttempts: [
        {
          requestSeq: 1,
          physicalAttempt: 1,
          usage: { inputTokens: Number.NaN }
        }
      ]
    })

    expect(
      registry.snapshot({ providerId: 'provider-1', modelId: 'model-1' })?.recording
        .globalRejectedRuns
    ).toBe(2)
  })

  it('rejects legacy adapters and attempt arrays beyond the bounded Run sample', () => {
    const registry = new ToolSurfaceCanaryDiagnosticsRegistry()
    const baseRecord = {
      scope,
      policyVersion: 'full-v1',
      catalogHash: 'catalog-a',
      catalogToolCount: 1,
      catalogDefinitionTokens: 1,
      outcome: 'completed' as const,
      durationMs: 1,
      ttftMs: null,
      providerRounds: 1,
      providerAttemptsTruncated: true,
      evidence: emptyEvidence()
    }

    registry.recordRun({
      ...baseRecord,
      adapterMode: 'legacy' as 'full',
      providerAttempts: []
    })
    registry.recordRun({
      ...baseRecord,
      adapterMode: 'full',
      providerAttempts: Array.from({ length: 65 }, (_, index) => ({
        requestSeq: index + 1,
        physicalAttempt: 1,
        usage: null
      }))
    })

    expect(
      registry.snapshot({ providerId: 'provider-1', modelId: 'model-1' })?.recording
        .globalRejectedRuns
    ).toBe(2)
  })

  it('keeps missing pricing and cache metrics out of billed cost samples', () => {
    const pricingPolicy = {
      schemaVersion: TOOL_SURFACE_PROVIDER_PRICING_SCHEMA_VERSION,
      pricingVersion: 'test-pricing-cache-v1',
      currency: 'USD' as const,
      entries: [
        {
          providerId: 'provider-1',
          modelId: 'model-1',
          inputIncludesCacheReadTokens: true,
          inputIncludesCacheWriteTokens: false,
          nanoUsdPerMillionTokens: {
            uncachedInput: 1_000_000_000,
            output: 1_000_000_000,
            cacheRead: 100_000_000,
            cacheWrite: 0
          }
        }
      ]
    }
    const registry = new ToolSurfaceCanaryDiagnosticsRegistry({ pricingPolicy })
    registry.recordRun({
      scope,
      adapterMode: 'full',
      policyVersion: 'full-v1',
      catalogHash: 'catalog-a',
      catalogToolCount: 4,
      catalogDefinitionTokens: 100,
      outcome: 'completed',
      durationMs: 10,
      ttftMs: null,
      providerRounds: 1,
      providerAttemptsTruncated: false,
      evidence: emptyEvidence(),
      providerAttempts: [
        {
          requestSeq: 1,
          physicalAttempt: 1,
          usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0 }
        }
      ]
    })

    expect(
      registry.snapshot({ providerId: 'provider-1', modelId: 'model-1' })?.cohorts[0]
    ).toMatchObject({
      cost: {
        pricedRuns: 0,
        unavailableRuns: { 'missing-cache-metrics': 1 }
      },
      metrics: { billedCostNanoUsd: { samples: 0, p50: null, p95: null, max: null } }
    })

    const missingPricing = new ToolSurfaceCanaryDiagnosticsRegistry()
    missingPricing.recordRun({
      scope,
      adapterMode: 'full',
      policyVersion: 'full-v1',
      catalogHash: 'catalog-a',
      catalogToolCount: 4,
      catalogDefinitionTokens: 100,
      outcome: 'completed',
      durationMs: 10,
      ttftMs: null,
      providerRounds: 1,
      providerAttemptsTruncated: false,
      evidence: emptyEvidence(),
      providerAttempts: [
        { requestSeq: 1, physicalAttempt: 1, usage: { inputTokens: 10, outputTokens: 2 } }
      ]
    })
    expect(
      missingPricing.snapshot({ providerId: 'provider-1', modelId: 'model-1' })?.cohorts[0]
        .cost.unavailableRuns['missing-pricing']
    ).toBe(1)
  })

  it('rejects ambiguous cache accounting, incomplete attempts, truncation, and overflow', () => {
    const pricing = new ToolSurfaceProviderPricingCatalogV1({
      schemaVersion: TOOL_SURFACE_PROVIDER_PRICING_SCHEMA_VERSION,
      pricingVersion: 'test-pricing-boundaries-v1',
      currency: 'USD',
      entries: [
        {
          providerId: 'provider-1',
          modelId: 'model-1',
          inputIncludesCacheReadTokens: true,
          inputIncludesCacheWriteTokens: false,
          nanoUsdPerMillionTokens: {
            uncachedInput: Number.MAX_SAFE_INTEGER,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0
          }
        }
      ]
    })
    const attempt = (usage: {
      inputTokens: number
      outputTokens?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
    }) => [{ requestSeq: 1, physicalAttempt: 1, usage }]

    expect(
      pricing.calculate({
        providerId: 'provider-1',
        modelId: 'model-1',
        attempts: attempt({
          inputTokens: 5,
          outputTokens: 0,
          cacheReadTokens: 6,
          cacheWriteTokens: 0
        }),
        attemptsTruncated: false
      })
    ).toEqual({ status: 'invalid-accounting' })
    expect(
      pricing.calculate({
        providerId: 'provider-1',
        modelId: 'model-1',
        attempts: attempt({ inputTokens: 5, cacheReadTokens: 0 }),
        attemptsTruncated: false
      })
    ).toEqual({ status: 'incomplete-usage' })
    expect(
      pricing.calculate({
        providerId: 'provider-1',
        modelId: 'model-1',
        attempts: attempt({
          inputTokens: 5,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0
        }),
        attemptsTruncated: true
      })
    ).toEqual({ status: 'truncated' })
    expect(
      pricing.calculate({
        providerId: 'provider-1',
        modelId: 'model-1',
        attempts: attempt({
          inputTokens: Number.MAX_SAFE_INTEGER,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0
        }),
        attemptsTruncated: false
      })
    ).toEqual({ status: 'overflow' })
  })

  it('does not classify an expected describe after search as repeated search', () => {
    const evidence = createToolSurfaceCanaryRunEvidenceRecorder()
    evidence.recordDiscovery({ kind: 'search', stableTargetKeys: ['mcp:remote:calendar'] })
    evidence.recordDiscovery({ kind: 'describe', stableTargetKeys: ['mcp:remote:calendar'] })

    expect(evidence.snapshot().discovery).toMatchObject({
      searchCalls: 1,
      describeCalls: 1,
      returnedTargetResults: 2,
      repeatedSearchTargetResults: 0
    })
  })

  it('bounds content-free repeated discovery evidence without retaining target identities', () => {
    const evidence = createToolSurfaceCanaryRunEvidenceRecorder()
    for (let index = 0; index < 300; index += 1) {
      evidence.recordDiscovery({
        kind: 'search',
        stableTargetKeys: [`private-target-${index % 2}`]
      })
    }
    for (let index = 0; index < 2_100; index += 1) {
      evidence.recordSettledToolResult(index % 2 === 0)
    }

    const snapshot = evidence.snapshot()
    expect(snapshot).toMatchObject({
      truncated: true,
      discovery: {
        searchCalls: 256,
        returnedTargetResults: 256,
        repeatedSearchTargetResults: 254
      },
      quality: {
        settledToolResults: 2_048,
        successfulSettledToolResults: 1_024,
        failedSettledToolResults: 1_024
      }
    })
    expect(JSON.stringify(snapshot)).not.toContain('private-target')
  })
})
