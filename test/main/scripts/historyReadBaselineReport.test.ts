import { describe, expect, it } from 'vitest'

type Renderer = {
  percentile: (values: number[], percentileValue: number) => number
  renderHistoryReadBaseline: (raw: unknown) => string
}

async function loadRenderer(): Promise<Renderer> {
  return (await import('../../../scripts/history-read-baseline-report.mjs')) as Renderer
}

function createRaw() {
  const scenario = (input: {
    messageCount: number
    globalTraceRows: number
    historySqlStatementCount: number
    historySqlDurationMs: number[]
    providerStartElapsedMs: number[]
  }) => ({
    messageCount: input.messageCount,
    globalTraceRows: input.globalTraceRows,
    queryPlan: [
      { detail: 'MATERIALIZE t' },
      { detail: 'SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq' }
    ],
    samples: input.historySqlDurationMs.map((duration, sampleIndex) => ({
      sampleIndex,
      getMessagesCallCount: 8,
      historySqlStatementCount: input.historySqlStatementCount,
      headerRows: input.messageCount * 8,
      structuredRows: input.messageCount * 8,
      structuredRowsByType: {
        user: input.messageCount * 4,
        file: 0,
        link: 0,
        assistantBlock: input.messageCount * 4
      },
      historySqlDurationMs: duration,
      materializationDurationMs: duration / 10,
      providerStartElapsedMs: input.providerStartElapsedMs[sampleIndex],
      eventLoopDelayMs: null,
      eventLoopDelayCensored: true
    }))
  })
  return {
    schemaVersion: 1,
    environment: {
      gitCommit: 'fixture-commit',
      gitDirty: false,
      generatedAt: '2026-01-02T03:04:05.000Z',
      nodeVersion: 'v24.0.0',
      electronVersion: '40.0.0',
      nodeModuleAbi: '143',
      sqliteVersion: '3.53.0',
      sqlitePackageVersion: '12.9.0',
      platform: 'darwin',
      osRelease: '25.0.0',
      arch: 'arm64',
      cpuModel: 'Fixture CPU',
      logicalCpuCount: 8
    },
    config: { seed: 'fixture-seed', warmups: 1, measuredRepeats: 5 },
    scenarios: [
      scenario({
        messageCount: 10,
        globalTraceRows: 0,
        historySqlStatementCount: 120,
        historySqlDurationMs: [0.7, 0.8, 0.838, 0.9, 1],
        providerStartElapsedMs: [2, 2.1, 2.2, 2.3, 2.4]
      }),
      scenario({
        messageCount: 10,
        globalTraceRows: 100_000,
        historySqlStatementCount: 120,
        historySqlDurationMs: [14, 14.5, 14.761, 14.9, 15],
        providerStartElapsedMs: [15, 15.5, 16, 16.5, 17]
      }),
      scenario({
        messageCount: 10_000,
        globalTraceRows: 0,
        historySqlStatementCount: 80_040,
        historySqlDurationMs: [490, 500, 506, 510, 520],
        providerStartElapsedMs: [900, 920, 931.5, 940, 950]
      }),
      scenario({
        messageCount: 10_000,
        globalTraceRows: 100_000,
        historySqlStatementCount: 80_040,
        historySqlDurationMs: [520, 530, 535, 540, 550],
        providerStartElapsedMs: [950, 960, 965.7, 970, 980]
      })
    ]
  }
}

describe('history read baseline report renderer', () => {
  it('renders deterministic median, p95, structured classifications, and query evidence', async () => {
    const renderer = await loadRenderer()
    const raw = createRaw()
    const first = renderer.renderHistoryReadBaseline(raw)
    const second = renderer.renderHistoryReadBaseline(structuredClone(raw))

    expect(second).toBe(first)
    expect(renderer.percentile([5, 1, 4, 2, 3], 50)).toBe(3)
    expect(renderer.percentile([5, 1, 4, 2, 3], 95)).toBe(5)
    expect(first).toContain(
      '| 10 | 0 | 8 / 8 | 120 / 120 | 80 / 80 | 80 / 80 | 40 / 40; 0 / 0; 0 / 0; 40 / 40 |'
    )
    expect(first).toContain('ABI `143`')
    expect(first).toContain('`darwin 25.0.0 arm64`, `Fixture CPU`, 8 logical CPUs')
    expect(first).toContain('| n/a / n/a (5/5) |')
    expect(first).toContain('global trace aggregation: yes')
    expect(first).toContain('`8` complete history reads')
    expect(first).toContain('`120` history SQL statements')
    expect(first).toContain('10,000-message/0-trace scenario executed `80040`')
    expect(first).toContain('observed N+1 statement shape per read')
    expect(first).toContain('from `0.838ms` to `14.761ms`')
    expect(first).toContain('from about `0.93s` at 0 traces to `0.97s`')
    expect(first).toContain('All `20/20` event-loop probes were censored')
    expect(first).toContain('| `HIS-002` | `GO` |')
    expect(first).toContain('| `HIS-003` | `GO` |')
    expect(first).toContain('| `HIS-004` | `NO-GO` |')
  })

  it('rejects unsupported raw input instead of producing a partial report', async () => {
    const renderer = await loadRenderer()
    expect(() => renderer.renderHistoryReadBaseline({ schemaVersion: 2 })).toThrow(
      'Unsupported history baseline raw result'
    )
    expect(() => renderer.percentile([], 50)).toThrow('Cannot summarize an empty sample set')
  })

  it('reports the five-call batch shape when raw metrics contain no per-message fallback', async () => {
    const renderer = await loadRenderer()
    const raw = createRaw()
    for (const scenario of raw.scenarios) {
      for (const sample of scenario.samples) {
        sample.historySqlStatementCount = sample.getMessagesCallCount * 5
      }
    }

    const report = renderer.renderHistoryReadBaseline(raw)

    expect(report).toContain(
      'five batch table calls per complete read and no per-message structured fallback calls'
    )
    expect(report).not.toContain('observed N+1 statement shape per read')
  })
})
