#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildCli as buildStandaloneCli } from '../../cli/scripts/build.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = path.resolve(scriptDirectory, '..')
export const cliOutputDirectory = path.join(repositoryRoot, 'out', 'cli')

async function desktopVersion() {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'))
  if (typeof packageJson.version !== 'string' || !packageJson.version.trim()) {
    throw new Error('DeepChat desktop package version is required')
  }
  return packageJson.version
}

export async function buildCli(options = {}) {
  const version = options.version ?? (await desktopVersion())
  return await buildStandaloneCli({
    ...options,
    outDir: options.outDir ? path.resolve(options.outDir) : cliOutputDirectory,
    version
  })
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  buildCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
