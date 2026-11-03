import { mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { HarnessRuntime } from '@/harness/runtime'
import { CoreRuntimeConnection } from '@/harness/core'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')
vi.unmock('child_process')
vi.unmock('node:child_process')

it('binds Rust control grants to Core generation and local effect handles', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'deepchat-core-control-'))
  let runtime: HarnessRuntime | undefined
  let connection: CoreRuntimeConnection | undefined
  try {
    const harness = path.join(directory, 'harness')
    cpSync(path.resolve('out/harness'), harness, { recursive: true })
    const { build } = await vi.importActual<typeof import('vite')>('vite')
    await build({
      configFile: false,
      publicDir: false,
      logLevel: 'silent',
      resolve: {
        conditions: ['node'],
        mainFields: ['module', 'main'],
        alias: { '@': path.resolve('src/main'), '@shared': path.resolve('src/shared') }
      },
      build: {
        target: 'node24',
        outDir: harness,
        emptyOutDir: false,
        copyPublicDir: false,
        lib: {
          entry: path.resolve('test/fixtures/harness/core-control.ts'),
          formats: ['es'],
          fileName: () => 'core.mjs'
        },
        rollupOptions: { external: [...builtinModules, /^node:/] }
      }
    })
    runtime = await HarnessRuntime.start({
      directory: harness,
      electronExecutable: process.execPath,
      capacity: 1,
      maxPending: 4,
      observe() {}
    })
    connection = await CoreRuntimeConnection.connect({
      runtime,
      temporaryDirectory: directory,
      native: async () => {
        throw new Error('Unexpected Native operation')
      }
    })
    await expect(connection.configure({ operation: 'read', input: {} })).resolves.toEqual({
      passed: true
    })
  } finally {
    await runtime?.stop()
    await connection?.closeAfterHostExit()
    rmSync(directory, { recursive: true, force: true })
  }
})
