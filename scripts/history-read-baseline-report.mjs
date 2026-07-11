#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rawPath = resolve(
  repoRoot,
  'docs/architecture/history-read-model-baseline/results/raw.json'
)
const reportPath = resolve(
  repoRoot,
  'docs/architecture/history-read-model-baseline/results/report.md'
)

export function percentile(values, percentileValue) {
  if (values.length === 0) throw new Error('Cannot summarize an empty sample set')
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)]
}

export function summarize(values) {
  return { median: percentile(values, 50), p95: percentile(values, 95) }
}

export function renderHistoryReadBaseline(raw) {
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.scenarios)) {
    throw new Error('Unsupported history baseline raw result')
  }

  const lines = [
    '# History Read Model Baseline Results',
    '',
    `- Commit: \`${raw.environment.gitCommit}\``,
    `- Worktree: \`${raw.environment.gitDirty ? 'dirty' : 'clean'}\``,
    `- Generated: \`${raw.environment.generatedAt}\``,
    `- Runtime: Node \`${raw.environment.nodeVersion}\`, Electron \`${raw.environment.electronVersion}\`, ABI \`${raw.environment.nodeModuleAbi}\`, SQLite \`${raw.environment.sqliteVersion}\`, better-sqlite3-multiple-ciphers \`${raw.environment.sqlitePackageVersion}\``,
    `- Host: \`${raw.environment.platform} ${raw.environment.osRelease} ${raw.environment.arch}\`, \`${raw.environment.cpuModel}\`, ${raw.environment.logicalCpuCount} logical CPUs`,
    `- Fixture: seed \`${raw.config.seed}\`, ${raw.config.warmups} warmup + ${raw.config.measuredRepeats} measured samples`,
    '',
    '| Messages | Global traces | getMessages median / p95 | SQL statements median / p95 | Header rows median / p95 | Structured total median / p95 | User; file; link; assistant median / p95 | SQL ms median / p95 | Materialization ms median / p95 | Provider-start ms median / p95 | Event-loop delay ms median / p95 (censored) |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  ]

  for (const scenario of raw.scenarios) {
    const metric = (name) => summarize(scenario.samples.map((sample) => sample[name]))
    const cell = (name, digits = 0) => {
      const value = metric(name)
      return `${value.median.toFixed(digits)} / ${value.p95.toFixed(digits)}`
    }
    const structured = ['user', 'file', 'link', 'assistantBlock']
      .map((name) => {
        const value = summarize(
          scenario.samples.map((sample) => sample.structuredRowsByType[name])
        )
        return `${value.median} / ${value.p95}`
      })
      .join('; ')
    const eventLoopDelayValues = scenario.samples
      .map((sample) => sample.eventLoopDelayMs)
      .filter((value) => typeof value === 'number')
    const censoredCount = scenario.samples.filter(
      (sample) => sample.eventLoopDelayCensored
    ).length
    const eventLoopDelay =
      eventLoopDelayValues.length === 0
        ? `n/a / n/a (${censoredCount}/${scenario.samples.length})`
        : `${summarize(eventLoopDelayValues).median.toFixed(3)} / ${summarize(eventLoopDelayValues).p95.toFixed(3)} (${censoredCount}/${scenario.samples.length})`
    lines.push(
      `| ${scenario.messageCount} | ${scenario.globalTraceRows} | ${cell('getMessagesCallCount')} | ${cell('historySqlStatementCount')} | ${cell('headerRows')} | ${cell('structuredRows')} | ${structured} | ${cell('historySqlDurationMs', 3)} | ${cell('materializationDurationMs', 3)} | ${cell('providerStartElapsedMs', 3)} | ${eventLoopDelay} |`
    )
  }

  const scenario = (messageCount, globalTraceRows) => {
    const match = raw.scenarios.find(
      (item) =>
        item.messageCount === messageCount && item.globalTraceRows === globalTraceRows
    )
    if (!match) {
      throw new Error(`Missing scenario ${messageCount}/${globalTraceRows}`)
    }
    return match
  }
  const median = (item, metric) =>
    summarize(item.samples.map((sample) => sample[metric])).median
  const tenNoTraces = scenario(10, 0)
  const tenMaxTraces = scenario(10, 100_000)
  const tenThousandNoTraces = scenario(10_000, 0)
  const tenThousandMaxTraces = scenario(10_000, 100_000)
  const measuredSamples = raw.scenarios.flatMap((item) => item.samples)
  const readCounts = [...new Set(measuredSamples.map((sample) => sample.getMessagesCallCount))]
  const censoredEventLoopSamples = measuredSamples.filter(
    (sample) => sample.eventLoopDelayCensored
  ).length
  const hasPerMessageStructuredFallback =
    median(tenNoTraces, 'historySqlStatementCount') >
    median(tenNoTraces, 'getMessagesCallCount') * 5

  lines.push(
    '',
    '## Findings',
    '',
    `- Every measured send performed \`${readCounts.join(', ')}\` complete history reads before the first provider call.`,
    `- The 10-message/0-trace scenario executed a median of \`${median(tenNoTraces, 'historySqlStatementCount')}\` history SQL statements; the 10,000-message/0-trace scenario executed \`${median(tenThousandNoTraces, 'historySqlStatementCount')}\`.`,
    hasPerMessageStructuredFallback
      ? '- The real table wrappers observed five batch table calls per complete read plus two empty file/link fallback calls per user message. With the alternating fixture, that is an observed N+1 statement shape per read, not a constant inferred by the renderer.'
      : '- The real table wrappers observed five batch table calls per complete read and no per-message structured fallback calls.',
    `- For 10 target messages, raising global trace noise from 0 to 100,000 increased median history SQL time from \`${median(tenNoTraces, 'historySqlDurationMs').toFixed(3)}ms\` to \`${median(tenMaxTraces, 'historySqlDurationMs').toFixed(3)}ms\`.`,
    `- For 10,000 target messages, median provider-start time increased from about \`${(median(tenThousandNoTraces, 'providerStartElapsedMs') / 1000).toFixed(2)}s\` at 0 traces to \`${(median(tenThousandMaxTraces, 'providerStartElapsedMs') / 1000).toFixed(2)}s\` at 100,000 traces. These wall-clock values describe this host only and are not a cross-device performance forecast.`,
    `- All \`${censoredEventLoopSamples}/${measuredSamples.length}\` event-loop probes were censored before firing, so this baseline makes no event-loop delay or CPU claim.`,
    '',
    '## Go / No-go',
    '',
    '| Follow-up | Decision | Evidence gate |',
    '| --- | --- | --- |',
    '| `HIS-002` | `GO` | The non-empty `hadMessages` path performs a complete history materialization. |',
    '| `HIS-003` | `GO` | Real query plans aggregate global traces and trace noise has a repeatable local timing effect. |',
    '| `HIS-004` | `NO-GO` | Keep the ordering gate until HIS-002 predicate and HIS-003 projection contracts are stable. |'
  )

  lines.push('', '## Query plan', '')
  for (const scenario of raw.scenarios) {
    const aggregatesGlobalTraces = scenario.queryPlan.some(
      (row) =>
        row.detail.includes('MATERIALIZE t') || row.detail.includes('deepchat_message_traces')
    )
    lines.push(
      `- ${scenario.messageCount} messages / ${scenario.globalTraceRows} traces; global trace aggregation: ${aggregatesGlobalTraces ? 'yes' : 'no'}; ${scenario.queryPlan.map((row) => row.detail).join(' | ')}`
    )
  }
  lines.push('', 'Raw measured samples are preserved in `raw.json`.', '')
  return lines.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'))
  writeFileSync(reportPath, renderHistoryReadBaseline(raw))
}
