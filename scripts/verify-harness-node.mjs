import assert from 'node:assert/strict'
import { build } from 'vite'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

mkdirSync('node_modules/.cache', { recursive: true })
const buildDir = mkdtempSync(resolve('node_modules/.cache/harness-node-'))
const profile = mkdtempSync(join(tmpdir(), 'deepchat-harness-node-'))
const forbidden = /^(?:electron(?:\/|$)|@electron[^/]*\/|vue(?:\/|$)|@vue[^/]*\/|pinia(?:\/|$))|\/src\/main\/(?:desktop|platform|cli)\/|\/src\/main\/app\/(?!data\/)/
try {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    resolve: { alias: { '@': resolve('src/main'), '@shared': resolve('src/shared') } },
    plugins: [{
      name: 'reject-desktop-dependencies',
      resolveId(id) {
        if (forbidden.test(id)) throw new Error(`Node Harness imported a desktop dependency: ${id}`)
      },
      generateBundle() {
        const visited = new Set()
        const visit = (id, chain = []) => {
          if (visited.has(id)) return
          visited.add(id)
          assert(!/better-sqlite|\/src\/main\/(?:data|tape\/infrastructure)\/|\/src\/main\/session\/data\/(?:tables\/|(?:index|database|transcript|transcriptProjection|pendingInputStore|pendingInputs|settings)\.ts$)|\/src\/shared\/contracts\/(?:routes|events|bridge)/.test(id), `Storage or desktop contract entered core: ${[...chain, id].join(' -> ')}`)
          const info = this.getModuleInfo(id)
          for (const dependency of [...(info?.importedIds ?? []), ...(info?.dynamicallyImportedIds ?? [])]) visit(dependency, [...chain, id])
        }
        visit(resolve('src/main/agent/deepchat/harness/index.ts'))
        assert(visited.size > 50, 'Core dependency audit did not traverse the production entry')
      }
    }],
    build: {
      target: 'node20',
      minify: false,
      outDir: buildDir,
      emptyOutDir: false,
      lib: { entry: resolve('test/node/deepChatHarness.ts'), formats: ['es'], fileName: () => 'harness.mjs' },
      rollupOptions: {
        external(id, importer) {
          if (forbidden.test(id)) throw new Error(`Node Harness imported a desktop dependency: ${id} from ${importer}`)
          return !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('@/') && !id.startsWith('@shared/')
        }
      }
    }
  })
  writeFileSync(join(buildDir, 'guard.cjs'), `const Module = require('node:module')
const original = Module._load
Module._load = function(id, ...args) {
  if (/^(electron(?:\\/|$)|@electron[^/]*\\/)/.test(id)) throw new Error('Electron load rejected: ' + id)
  return original.call(this, id, ...args)
}
`)
  writeFileSync(join(buildDir, 'loader.mjs'), `export async function resolve(id, context, next) {
  if (/^(electron(?:\\/|$)|@electron[^/]*\\/)/.test(id)) throw new Error('Electron load rejected: ' + id)
  return next(id, context)
}
`)
  writeFileSync(join(buildDir, 'guard.mjs'), `import { register } from 'node:module'
register('./loader.mjs', import.meta.url)
`)
  const guards = ['--require', join(buildDir, 'guard.cjs'), '--import', join(buildDir, 'guard.mjs')]
  for (const [mode, expression] of [['commonjs', "require('electron')"], ['module', "await import('electron')"]]) {
    const rejected = spawnSync(process.execPath, [...guards, '--input-type', mode, '--eval', expression], { encoding: 'utf8' })
    assert.equal(rejected.status, 1)
    assert.match(rejected.stderr, /Electron load rejected/)
  }
  for (const [phase, expectedCode] of [['main', 0], ['crash', 73], ['recover', 0]]) {
    const result = spawnSync(process.execPath, [
      ...guards,
      join(buildDir, 'harness.mjs'), phase, profile
    ], { stdio: 'inherit', timeout: 60_000 })
    if (result.error) throw result.error
    if (result.status !== expectedCode) throw new Error(`${phase} exited ${result.status}, expected ${expectedCode}`)
  }
  console.log('Node Harness accepted: production entry, real SQLite, Electron rejected, all phases passed')
} finally {
  rmSync(buildDir, { recursive: true, force: true })
  rmSync(profile, { recursive: true, force: true })
}
