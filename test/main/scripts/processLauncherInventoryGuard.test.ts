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

  it('classifies default imports and their named-default equivalents', async () => {
    const fixturePath = 'src/main/default-imports.ts'
    const fixture = await createFixture(
      {
        [fixturePath]: `
          import childDefault from 'node:child_process'
          import { default as childNamedDefault } from 'child_process'
          import crossSpawnDefault from 'cross-spawn'
          import { default as crossSpawnNamedDefault } from 'cross-spawn'
          import ptyDefault from 'node-pty'
          import { default as ptyNamedDefault } from 'node-pty'

          childDefault.spawn('node')
          childNamedDefault.spawn('node')
          crossSpawnDefault('node')
          crossSpawnNamedDefault('node')
          crossSpawnDefault.sync('node')
          crossSpawnNamedDefault.sync('node')
          ptyDefault.spawn('node')
          ptyNamedDefault.spawn('node')
        `
      },
      [
        entry(fixturePath, 'child_process.spawn', 1, 'deepchat-runtime'),
        entry(fixturePath, 'child_process.spawn', 2, 'deepchat-runtime'),
        entry(fixturePath, 'cross-spawn.spawn', 1, 'deepchat-runtime'),
        entry(fixturePath, 'cross-spawn.spawn', 2, 'deepchat-runtime'),
        entry(fixturePath, 'cross-spawn.sync'),
        entry(fixturePath, 'cross-spawn.sync', 2),
        entry(fixturePath, 'node-pty.spawn', 1, 'deepchat-runtime'),
        entry(fixturePath, 'node-pty.spawn', 2, 'deepchat-runtime')
      ]
    )

    const result = runGuard(fixture)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('(8 classified sites)')
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

  it.each([
    {
      label: 'CommonJS child_process require',
      marker: 'CommonJS require for node:child_process',
      source: `const child = require('node:child_process'); child.spawn('node')`
    },
    {
      label: 'dynamic node:child_process import',
      marker: 'dynamic import for node:child_process',
      source: `const child = await import('node:child_process'); child.spawn('node')`
    },
    {
      label: 'Electron namespace import',
      marker: 'default/namespace import for electron',
      source: `import * as electron from 'electron'; electron.utilityProcess.fork('host.js')`
    },
    {
      label: 'Electron default import',
      marker: 'default/namespace import for electron',
      source: `import electron from 'electron'; electron.shell.openPath('/tmp/example')`
    },
    {
      label: 'dynamic StdioClientTransport import',
      marker: 'dynamic import for @modelcontextprotocol/sdk/client/stdio.js',
      source: `
        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
        new StdioClientTransport({ command: 'node' })
      `
    },
    {
      label: 'static import with from trivia',
      marker: 'child_process.spawn#1 has no owner/category',
      source: `
        import { spawn } from /* gap */ 'node:child_process'
        spawn('node')
      `
    },
    {
      label: 'CommonJS require with argument trivia',
      marker: 'CommonJS require for node:child_process',
      source: `const child = require(/* gap */ 'node:child_process'); child.spawn('node')`
    },
    {
      label: 'dynamic import with argument trivia',
      marker: 'dynamic import for node:child_process',
      source: `const child = await import(/* gap */ 'node:child_process'); child.spawn('node')`
    },
    {
      label: 'dynamic Electron destructuring with argument trivia',
      marker: 'electron.utilityProcess.fork#1 has no owner/category',
      source: `
        const { utilityProcess: electronUtility } = await import(/* gap */ 'electron')
        electronUtility.fork('host.js')
      `
    },
    {
      label: 'launcher re-export with from trivia',
      marker: 'launcher re-export for node:child_process',
      source: `export { spawn } from /* gap */ 'node:child_process'`
    },
    {
      label: 'dynamic import with a no-substitution template literal',
      marker: 'dynamic import for node:child_process',
      source: "const child = await import(`node:child_process`); child.spawn('node')"
    },
    {
      label: 'dynamic import with options',
      marker: 'dynamic import for node:child_process',
      source: `const child = await import('node:child_process', {}); child.spawn('node')`
    },
    {
      label: 'module.require loader',
      marker: 'opaque module loader for node:child_process',
      source: `const child = module.require('node:child_process'); child.spawn('node')`
    },
    {
      label: 'createRequire alias loader',
      marker: 'opaque module loader for node:child_process',
      source: `
        import { createRequire } from 'node:module'
        const localRequire = createRequire(import.meta.url)
        const child = localRequire('node:child_process')
        child.spawn('node')
      `
    },
    {
      label: 'unrelated call with a watched module string',
      marker: 'opaque module loader for electron',
      source: `report('electron')`
    },
    {
      label: 'Electron shell static element access',
      marker: 'electron.shell.openExternal#1 has no owner/category',
      source: `
        import { shell } from 'electron'
        shell['openExternal']('https://example.com')
      `
    },
    {
      label: 'namespace launcher method alias',
      marker: 'opaque launcher binding use for child_process',
      source: `
        import * as cp from 'node:child_process'
        const launch = cp.spawn
        launch('node')
      `
    },
    {
      label: 'parenthesized named launcher call',
      marker: 'child_process.spawn#1 has no owner/category',
      source: `
        import { spawn } from 'node:child_process'
        ;(spawn)('node')
      `
    },
    {
      label: 'launcher call helper',
      marker: 'opaque launcher binding use for child_process',
      source: `
        import { execFile } from 'node:child_process'
        execFile.call(null, 'git')
      `
    },
    {
      label: 'launcher apply helper',
      marker: 'opaque launcher binding use for child_process',
      source: `
        import { execFile } from 'node:child_process'
        execFile.apply(null, ['git'])
      `
    },
    {
      label: 'launcher bind helper',
      marker: 'opaque launcher binding use for child_process',
      source: `
        import { execFile } from 'node:child_process'
        const launch = execFile.bind(null)
        launch('git')
      `
    },
    {
      label: 'passed launcher binding',
      marker: 'opaque launcher binding use for child_process',
      source: `
        import { spawn } from 'node:child_process'
        consume(spawn)
      `
    },
    {
      label: 'assigned launcher binding',
      marker: 'opaque launcher binding use for child_process',
      source: `
        import { spawn } from 'node:child_process'
        const launch = spawn
        launch('node')
      `
    },
    {
      label: 'launcher binding in object shorthand',
      marker: 'opaque launcher binding use for child_process',
      source: `
        import { spawn } from 'node:child_process'
        consume({ spawn })
      `
    },
    {
      label: 'local launcher binding re-export',
      marker: 'opaque launcher binding use for child_process',
      source: `
        import { spawn } from 'node:child_process'
        export { spawn }
      `
    }
  ])('fails closed for $label syntax', async ({ marker, source }) => {
    const trackedPath = 'src/main/tracked.ts'
    const unsupportedPath = 'src/main/unsupported.ts'
    const fixture = await createFixture(
      {
        [trackedPath]: `import { spawn } from 'node:child_process'; spawn('node')`,
        [unsupportedPath]: source
      },
      [entry(trackedPath, 'child_process.spawn')]
    )

    const result = runGuard(fixture)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`${unsupportedPath}:`)
    expect(result.stderr).toContain(marker)
  })

  it('ignores type-only imports and re-exports from watched modules', async () => {
    const trackedPath = 'src/main/tracked.ts'
    const fixture = await createFixture(
      {
        [trackedPath]: `import { spawn } from 'node:child_process'; spawn('node')`,
        'src/main/types.ts': `
          import type { ChildProcess } from /* gap */ 'node:child_process'
          export type { ChildProcessWithoutNullStreams } from 'node:child_process'
          export { type SpawnOptions } from 'node:child_process'
        `
      },
      [entry(trackedPath, 'child_process.spawn')]
    )

    const result = runGuard(fixture)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('(1 classified sites)')
  })

  it('allows type-only checks and the explicit shell exemption', async () => {
    const trackedPath = 'src/main/tracked.ts'
    const fixture = await createFixture(
      {
        [trackedPath]: `import { spawn } from 'node:child_process'; spawn('node')`,
        'src/main/non-launching.ts': `
          import { shell } from 'electron'
          import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

          shell.showItemInFolder('/tmp/example')
          type Stdio = StdioClientTransport
          const isStdio = transport instanceof StdioClientTransport
        `
      },
      [entry(trackedPath, 'child_process.spawn')]
    )

    const result = runGuard(fixture)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('(1 classified sites)')
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
