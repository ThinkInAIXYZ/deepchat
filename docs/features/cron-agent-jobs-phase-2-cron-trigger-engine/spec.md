# Cron Agent Jobs Phase 2: Cron Trigger Engine

## User Need

Users need one expressive schedule model instead of separate once/daily/weekly trigger kinds.
The schedule must preview upcoming runs, respect timezones, and handle missed runs predictably.

## Goal

Replace phase 1's timestamp-only scheduling input with a cron-expression trigger engine:

- Store every schedule as `cronExpr + timezone`.
- Validate expressions through a dedicated parser.
- Compute and persist `next_run_at`.
- Preview the next N runs in the UI and tool-facing service layer.
- Support misfire policy for missed runs.
- Provide preset controls that only generate cron expressions.

## Parser Choice

Use `cron-parser` unless implementation discovers a blocker in the locked package version.
The package is not currently in `package.json`, so this phase adds the dependency and tests the
exact syntax DeepChat exposes.

The exposed syntax must be limited to parser-backed behavior verified by tests. Do not market a
cron feature in UI copy without a passing unit test for that feature.

## Schedule Model

```ts
type CronJobSchedule = {
  cronExpr: string
  timezone: string
  misfirePolicy: 'skip' | 'run_once'
  maxCatchUpRuns?: number
}
```

Presets are UI helpers only:

```ts
type SchedulePreset =
  | { type: 'every_n_minutes'; n: number }
  | { type: 'hourly'; minute: number }
  | { type: 'daily'; time: string }
  | { type: 'weekdays'; time: string }
  | { type: 'weekly'; days: number[]; time: string }
  | { type: 'monthly'; day: number | 'last'; time: string }
  | { type: 'custom'; cronExpr: string }
```

## Acceptance Criteria

- `*/5 * * * *` previews the next 5 runs from a controlled clock.
- `0 9 * * 1-5` correctly represents weekdays at 09:00.
- `0 0 9 L * *` correctly represents the last day of each month at 09:00 when supported by the
  locked parser version.
- `0 0 9 * * 1#1` correctly represents the first Monday of each month when supported by the locked
  parser version.
- Timezone changes immediately update preview rows and persisted `next_run_at`.
- Invalid cron input shows a parser error and cannot enable the job.
- Scheduler due scans remain based only on `next_run_at <= now`.
- `misfirePolicy: 'skip'` advances to the next future run after downtime.
- `misfirePolicy: 'run_once'` creates at most one catch-up run per reconcile unless
  `maxCatchUpRuns` is explicitly set.

## UX Shape

```text
+---------------------------------------------------------+
| Schedule                                                |
| Mode                                                    |
| (o) Preset                                              |
|     Every [day v] at [09:00]                            |
|                                                         |
| ( ) Cron expression                                     |
|     [0 0 9 * * *                                    ]   |
|     Timezone [Asia/Tokyo v]                             |
|                                                         |
| Next 5 runs                                             |
| - 2026-07-03 09:00                                      |
| - 2026-07-04 09:00                                      |
| - 2026-07-05 09:00                                      |
+---------------------------------------------------------+
```

## Non-Goals

- No agent binding or real execution.
- No run detail UI beyond schedule preview.
- No remote delivery or `cronjob` agent tool.
- No broad legacy task migration unless the migration can be completed without changing execution
  semantics.

## Constraints

- Do not reintroduce once/daily/weekly as persisted model variants.
- Presets must write only `cronExpr` and `timezone`.
- Store timestamps as epoch milliseconds.
- Use deterministic tests with fixed reference dates and timezones.

## References

- `cron-parser` README documents timezone handling and extended syntax including `L`, `#`, and `H`:
  https://github.com/harrisiirak/cron-parser/blob/master/README.md

## Open Questions

None. Unsupported parser syntax should be removed from UI copy instead of becoming a product
promise.
