#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { build } from 'vite'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { 'resources-path': { type: 'string' }, executable: { type: 'string' } }
})
assert(values['resources-path'], '--resources-path is required')
assert(values.executable, '--executable is required')
const resourcesPath = path.resolve(values['resources-path'])
const electronExecutable = path.resolve(values.executable)
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-harness-smoke-'))

try {
  const outDir = path.join(temporaryRoot, 'client')
  await build({
    configFile: false,
    root: repositoryRoot,
    publicDir: false,
    resolve: {
      alias: {
        '@': path.join(repositoryRoot, 'src', 'main'),
        '@shared': path.join(repositoryRoot, 'src', 'shared')
      }
    },
    build: {
      target: 'node24',
      outDir,
      emptyOutDir: true,
      copyPublicDir: false,
      lib: {
        entry: Object.fromEntries(
          ['runtime', 'admission', 'memory-vector'].map((name) => [
            name,
            path.join(repositoryRoot, 'src', 'main', 'harness', `${name}.ts`)
          ])
        ),
        formats: ['es'],
        fileName: (_, name) => `${name}.mjs`
      },
      rollupOptions: { external: [/^node:/] }
    },
    logLevel: 'warn'
  })
  const { HarnessRuntime } = await import(pathToFileURL(path.join(outDir, 'runtime.mjs')).href)
  const { RutisAgentInvocationAdmission } = await import(
    pathToFileURL(path.join(outDir, 'admission.mjs')).href
  )
  const { RutisMemoryVectorStores } = await import(
    pathToFileURL(path.join(outDir, 'memory-vector.mjs')).href
  )
  const embedding = { providerId: 'smoke', modelId: 'smoke' }
  for (const restarting of [false, true]) {
    const runtime = await HarnessRuntime.start({
      directory: path.join(resourcesPath, 'app.asar.unpacked', 'harness'),
      electronExecutable,
      capacity: 1,
      maxPending: 4,
      observe: () => {}
    })
    const admission = RutisAgentInvocationAdmission.create({ runtime, capacity: 1, maxPending: 4 })
    const stores = new RutisMemoryVectorStores(runtime, {
      memoryDbDir: path.join(temporaryRoot, 'memory'),
      host: {
        appPath: path.join(resourcesPath, 'app.asar'),
        userDataPath: temporaryRoot,
        isPackaged: true
      }
    })
    try {
      assert.equal(runtime.memoryIdentity, undefined)
      await stores.resetVectorStore('unused')
      assert.equal(runtime.memoryIdentity, undefined)
      const identity = runtime.identity
      const permit = await admission.acquire({ ownerId: 'packaged-memory-smoke' })
      try {
        const store = await stores.createVectorStore('smoke', embedding, 2)
        assert.equal(store.isUsable(), true)
        assert(
          ![process.pid, identity.hostPid, identity.runtime.pid].includes(
            runtime.memoryIdentity.pid
          )
        )
        assert.equal(runtime.memoryIdentity.modules, identity.runtime.modules)
        assert.equal(runtime.memoryIdentity.node, identity.runtime.node)
        if (restarting) {
          assert.deepEqual(await store.listMemoryIds(null, 512), ['other'])
        } else {
          await store.upsert([
            { memoryId: 'anchor', embedding: [1, 0] },
            { memoryId: 'other', embedding: [1, 0.5] }
          ])
          const matches = await store.query([1, 0], { topK: 2 })
          assert.deepEqual(
            matches.map((match) => match.memoryId),
            ['anchor', 'other']
          )
          assert.equal(matches[0].distance, 0)
          assert(Math.abs(matches[1].distance - (1 - 2 / Math.sqrt(5))) < 1e-6)
          await store.deleteByMemoryIds(['anchor'])
        }
        await store.close()
        if (restarting) {
          await stores.resetVectorStore('smoke')
          const cleared = await stores.createVectorStore('smoke', embedding, 2)
          assert.deepEqual(await cleared.listMemoryIds(null, 512), [])
          await cleared.close()
        }
        assert.deepEqual(runtime.identity, identity)
        console.log('[Harness Smoke] packaged runtime:', {
          restarting,
          ...identity,
          memory: runtime.memoryIdentity
        })
      } finally {
        permit.release()
      }
      await admission.run({ ownerId: 'after-memory' }, async () => {})
      assert.equal(runtime.memoryTransport.pending, 0)
    } finally {
      try {
        await admission.close()
        await stores.dispose()
      } finally {
        await runtime.stop()
      }
      for (const pid of [
        runtime.identity.hostPid,
        runtime.identity.runtime.pid,
        runtime.memoryIdentity?.pid
      ]) {
        if (pid) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
      }
    }
  }
  console.log('[Harness Smoke] packaged native read/write, restart, reset and shutdown passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
