import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, expect, it, vi } from 'vitest'
import {
  assertArtifactDependencyClosure,
  discoverWorkspacePackages,
  stageWorkspaceClosure
} from '../../../../../scripts/package-artifact.mjs'
vi.unmock('fs')
vi.unmock('path')
const workspaceRoot = resolve(import.meta.dirname, '../../../../..')
const desktopRoot = resolve(import.meta.dirname, '../../..')
const providerPackageName = '@deepchat/provider'
const sharedPackageName = '@deepchat/shared'
let workspace: string | undefined
const forbidden =
  /(?:^@\/|^@shared\/|electron|better-sqlite3|node-pty|@deepchat\/agent-kernel|@modelcontextprotocol|src\/main)/
afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true })
})
it(
  'executes the declared provider artifact closure outside the repository',
  { timeout: 180000 },
  () => {
    workspace = mkdtempSync(join(tmpdir(), 'provider-artifact-'))
    const staged = stageWorkspaceClosure(
      workspaceRoot,
      providerPackageName,
      join(workspace, 'artifacts')
    )
    assertArtifactDependencyClosure(staged)
    const provider = staged.get(providerPackageName)!
    function inspect(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name)
        if (entry.isDirectory()) inspect(file)
        else if (/\.(?:js|ts)$/.test(file)) {
          const source = readFileSync(file, 'utf8')
          for (const match of source.matchAll(
            /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
          )) {
            expect(forbidden.test(match[1]), `${file}: ${match[1]}`).toBe(false)
          }
        }
      }
    }
    inspect(join(provider.directory, 'dist'))
    const dependencies = Object.fromEntries(
      [...staged].map(([name, item]) => [name, `file:${item.directory}`])
    )
    const workspacePackages = discoverWorkspacePackages(workspaceRoot)
    // Pin the fixture to the same installed versions, not whichever a registry currently returns.
    const app = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8'))
    const overrides = { ...app.pnpm.overrides }
    const visited = new Set<string>()
    function pinClosure(manifestPath: string): void {
      if (visited.has(manifestPath)) return
      visited.add(manifestPath)
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const require = createRequire(manifestPath)
      for (const name of Object.keys(manifest.dependencies ?? {})) {
        if (name.startsWith('@deepchat/')) continue
        const dependencyPath = (require.resolve.paths(name) ?? [])
          .map((directory) => join(directory, name, 'package.json'))
          .find((file) => {
            try {
              readFileSync(file)
              return true
            } catch {
              return false
            }
          })
        if (!dependencyPath) throw new Error(`Missing installed dependency ${name}`)
        const dependency = JSON.parse(readFileSync(dependencyPath, 'utf8'))
        overrides[`${manifest.name}>${name}`] = dependency.version
        pinClosure(dependencyPath)
      }
    }
    for (const [name, item] of staged) {
      const owner = workspacePackages.get(name)
      if (!owner) throw new Error(`Missing workspace owner for ${name}`)
      const require = createRequire(join(owner.directory, 'package.json'))
      for (const dependencyName of Object.keys(item.manifest.dependencies ?? {})) {
        if (!dependencyName.startsWith('@deepchat/')) {
          const file = (require.resolve.paths(dependencyName) ?? [])
            .map((directory) => join(directory, dependencyName, 'package.json'))
            .find((candidate) => {
              try {
                readFileSync(candidate)
                return true
              } catch {
                return false
              }
            })
          if (!file) throw new Error(`Missing installed dependency ${dependencyName}`)
          overrides[dependencyName] = JSON.parse(readFileSync(file, 'utf8')).version
          pinClosure(file)
        }
      }
    }
    writeFileSync(
      join(workspace, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        dependencies,
        devDependencies: { '@types/node': '24.13.3' },
        pnpm: { overrides }
      })
    )
    // Prefer offline artifacts from the local store; a pristine CI runner has no registry
    // metadata mirror for every declared range, and the closure under test is isolation from
    // the repository, not from the network.
    const install = spawnSync('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], {
      cwd: workspace,
      encoding: 'utf8',
      timeout: 120000,
      shell: process.platform === 'win32'
    })
    expect(install.status, install.stdout + install.stderr).toBe(0)
    cpSync(
      join(import.meta.dirname, 'fixtures/portable-consumer.mjs'),
      join(workspace, 'consumer.mjs')
    )
    const run = spawnSync(process.execPath, ['consumer.mjs'], {
      cwd: workspace,
      encoding: 'utf8',
      timeout: 30000
    })
    expect(run.status, run.stdout + run.stderr).toBe(0)
    const publicSubpaths = Object.keys(provider.manifest.exports ?? {}).map((subpath) =>
      subpath === '.' ? providerPackageName : `${providerPackageName}/${subpath.slice(2)}`
    )
    writeFileSync(
      join(workspace, 'consumer.ts'),
      `import { ProviderRuntimeCore, type ProviderHost, type ProviderSettingsPort } from '@deepchat/provider'\nimport type { DeepchatEventPublisher } from '@deepchat/shared/contracts/events'\n${publicSubpaths.map((subpath) => `import '${subpath}'`).join('\n')}\ndeclare const settings: ProviderSettingsPort\ndeclare const host: ProviderHost\ndeclare const publish: DeepchatEventPublisher\nconst runtime = new ProviderRuntimeCore(settings, host, publish)\nconst response: Promise<string> = runtime.generateCompletion('fixture', [{ role: 'user', content: 'hello' }], 'fixture-model')\nvoid response\n`
    )
    writeFileSync(
      join(workspace, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2023',
          strict: true,
          noEmit: true,
          types: ['node']
        },
        include: ['consumer.ts']
      })
    )
    const compiler = createRequire(join(desktopRoot, 'package.json')).resolve('typescript/bin/tsc')
    const types = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.json'], {
      cwd: workspace,
      encoding: 'utf8',
      timeout: 30000
    })
    expect(types.status, types.stdout + types.stderr).toBe(0)

    const missingAiDependency = {
      ...provider,
      manifest: structuredClone(provider.manifest)
    }
    delete missingAiDependency.manifest.dependencies.ai
    expect(() =>
      assertArtifactDependencyClosure(
        new Map([
          [providerPackageName, missingAiDependency],
          [sharedPackageName, staged.get(sharedPackageName)!]
        ])
      )
    ).toThrow("undeclared import 'ai'")
  }
)
