#!/usr/bin/env node
// Runs the locally built CLI bundle with plain Node, forwarding all arguments. Strips a leading
// `--` because nested `pnpm run` forwarding preserves it verbatim.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifact = path.join(appRoot, 'out', 'cli', 'deepchat.mjs')

if (!existsSync(artifact)) {
  console.error('CLI bundle not found. Run `pnpm run cli:build` first.')
  process.exit(1)
}

const argv = process.argv.slice(2)
const forwarded = argv[0] === '--' ? argv.slice(1) : argv

const child = spawn(process.execPath, [artifact, ...forwarded], { stdio: 'inherit' })
child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
child.on('close', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 1)
})
