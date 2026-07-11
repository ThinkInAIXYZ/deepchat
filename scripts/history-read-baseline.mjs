#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electron = resolve(repoRoot, 'node_modules/.bin/electron')
const vitest = resolve(repoRoot, 'node_modules/vitest/vitest.mjs')

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: repoRoot, env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(
  electron,
  [
    vitest,
    'run',
    'test/main/benchmarks/historyReadBaseline.test.ts',
    '--config',
    'vitest.config.ts',
    '--project',
    'main',
    '--pool=forks',
    '--poolOptions.forks.singleFork=true'
  ],
  {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DEEPCHAT_REQUIRE_NATIVE_SQLITE: '1',
    DEEPCHAT_HISTORY_BASELINE: '1',
    DEEPCHAT_HISTORY_BASELINE_ROOT: repoRoot
  }
)
run(process.execPath, ['scripts/history-read-baseline-report.mjs'])
