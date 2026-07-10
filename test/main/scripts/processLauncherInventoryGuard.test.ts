import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TEMP_DIRS: string[] = []

type InventoryEntry = {
  path: string
  launcher: string
  occurrence: number
  owner: string
  category: string
}

async function createFixture(files: Record<string, string>, entries: InventoryEntry[]) {
  const root = await mkdtemp(path.join(tmpdir(), 'deepchat-process-launcher-guard-'))
  TEMP_DIRS.push(root)

  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(root, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, source, 'utf8')
  }

  const inventoryPath = path.join(root, 'inventory.json')
  await writeFile(inventoryPath, JSON.stringify({ version: 1, entries }), 'utf8')
  return { inventoryPath, root }
}

function runGuard(fixture?: { inventoryPath: string; root: string }) {
  const env = { ...process.env, NODE_ENV: 'test' }
  if (fixture) {
    env.DEEPCHAT_TEST_PROCESS_LAUNCHER_ROOT = fixture.root
    env.DEEPCHAT_TEST_PROCESS_LAUNCHER_INVENTORY = fixture.inventoryPath
  }

  return spawnSync(process.execPath, ['scripts/process-launcher-inventory-guard.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env
  })
}

function entry(
  pathValue: string,
  launcher: string,
  occurrence = 1,
  category = 'helper'
): InventoryEntry {
  return {
    path: pathValue,
    launcher,
    occurrence,
    owner: 'fixture-owner',
    category
  }
}

describe.sequential('process launcher inventory guard', () => {
  afterEach(async () => {
    await Promise.all(
      TEMP_DIRS.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
    )
  })

  it('accepts the tracked repository launcher inventory', () => {
    const result = runGuard()

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Process launcher inventory guard passed (62 classified sites).')
  })

  it('classifies every direct launcher family', async () => {
    const fixturePath = 'src/main/direct.ts'
    const fixture = await createFixture(
      {
        [fixturePath]: `
          import { spawn as childSpawn } from 'node:child_process'
          import crossSpawn from 'cross-spawn'
          import { spawn as ptySpawn } from 'node-pty'
          import { StdioClientTransport as StdioTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

          const { utilityProcess: electronUtility } = await import('electron')
          childSpawn('node')
          crossSpawn('node')
          crossSpawn.sync('node')
          ptySpawn('node')
          electronUtility.fork('host.js')
          new StdioTransport({ command: 'node' })
        `
      },
      [
        entry(fixturePath, 'child_process.spawn', 1, 'deepchat-runtime'),
        entry(fixturePath, 'cross-spawn.spawn', 1, 'deepchat-runtime'),
        entry(fixturePath, 'cross-spawn.sync', 1, 'helper'),
        entry(fixturePath, 'node-pty.spawn', 1, 'deepchat-runtime'),
        entry(fixturePath, 'electron.utilityProcess.fork', 1, 'utility-host'),
        entry(fixturePath, 'mcp.StdioClientTransport', 1, 'deepchat-runtime')
      ]
    )

    const result = runGuard(fixture)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('(6 classified sites)')
  })

  it('classifies promisified and local wrapper launchers', async () => {
    const fixturePath = 'src/main/wrapped.ts'
    const fixture = await createFixture(
      {
        [fixturePath]: `
          import { execFile, spawn } from 'node:child_process'
          import { promisify } from 'node:util'

          const execFileAsync = promisify(execFile)
          const launch = () => spawn('node')
          execFileAsync('git')
          launch()
        `
      },
      [entry(fixturePath, 'child_process.spawn'), entry(fixturePath, 'child_process.execFile')]
    )

    const result = runGuard(fixture)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('(2 classified sites)')
  })

  it('classifies aliased Electron shell openers', async () => {
    const fixturePath = 'src/preload/shell.ts'
    const fixture = await createFixture(
      {
        [fixturePath]: `
          import { shell as electronShell } from 'electron'
          electronShell.openExternal('https://example.com')
          electronShell.openPath('/tmp/example')
        `
      },
      [
        entry(fixturePath, 'electron.shell.openExternal', 1, 'external-opener'),
        entry(fixturePath, 'electron.shell.openPath', 1, 'external-opener')
      ]
    )

    const result = runGuard(fixture)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('(2 classified sites)')
  })

  it('fails for a new unclassified launcher site', async () => {
    const trackedPath = 'src/main/tracked.ts'
    const addedPath = 'src/main/added.ts'
    const fixture = await createFixture(
      {
        [trackedPath]: `import { spawn } from 'node:child_process'; spawn('node')`,
        [addedPath]: `import { execFile } from 'node:child_process'; execFile('git')`
      },
      [entry(trackedPath, 'child_process.spawn')]
    )

    const result = runGuard(fixture)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[process-launcher-unclassified]')
    expect(result.stderr).toContain(`${addedPath}:1 child_process.execFile#1`)
  })

  it('fails when a classified launcher file is renamed', async () => {
    const oldPath = 'src/main/old-owner.ts'
    const newPath = 'src/main/new-owner.ts'
    const fixture = await createFixture(
      {
        [newPath]: `import { spawn } from 'node:child_process'; spawn('node')`
      },
      [entry(oldPath, 'child_process.spawn')]
    )

    const result = runGuard(fixture)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`[process-launcher-unclassified] ${newPath}:1`)
    expect(result.stderr).toContain(`[process-launcher-inventory-drift] missing ${oldPath}`)
  })

  it('fails when a classified launcher API drifts', async () => {
    const fixturePath = 'src/main/drift.ts'
    const fixture = await createFixture(
      {
        [fixturePath]: `import { execFile } from 'node:child_process'; execFile('git')`
      },
      [entry(fixturePath, 'child_process.spawn')]
    )

    const result = runGuard(fixture)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('child_process.execFile#1 has no owner/category')
    expect(result.stderr).toContain(`missing ${fixturePath} child_process.spawn#1`)
  })

  it('fails closed for missing owner or unknown category metadata', async () => {
    const fixturePath = 'src/main/invalid.ts'
    const fixture = await createFixture(
      {
        [fixturePath]: `import { spawn } from 'node:child_process'; spawn('node')`
      },
      [
        {
          ...entry(fixturePath, 'child_process.spawn'),
          owner: '',
          category: 'unreviewed'
        }
      ]
    )

    const result = runGuard(fixture)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[process-launcher-inventory-invalid]')
    expect(result.stderr).toContain('owner must be a kebab-case identifier')
    expect(result.stderr).toContain('category must be one of')
  })
})
