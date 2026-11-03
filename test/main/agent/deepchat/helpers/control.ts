import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { setImmediate } from 'node:timers/promises'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { HarnessRuntime } from '@/harness/runtime'
import { CoreRuntimeConnection } from '@/harness/core'
import { CoreHarnessControl } from '../../../../../src/harness/core/control'
import type { HarnessControlPort } from '@shared/harness/control'

export function useHarnessControl(): (() => HarnessControlPort) & { flush(): Promise<void> } {
  let directory: string | undefined
  let harness: string | undefined
  const owners: Array<{ flush(): Promise<void>; close(): Promise<void> }> = []
  beforeAll(async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const path = await vi.importActual<typeof import('node:path')>('node:path')
    directory = fs.mkdtempSync(path.join(tmpdir(), 'deepchat-control-tests-'))
    harness = path.join(directory, 'harness')
    fs.cpSync(path.resolve('out/harness'), harness, { recursive: true })
    const { build } = await vi.importActual<typeof import('vite')>('vite')
    await build({
      configFile: false,
      publicDir: false,
      logLevel: 'silent',
      resolve: {
        conditions: ['node'],
        mainFields: ['module', 'main'],
        alias: { '@shared': path.resolve('src/shared') }
      },
      build: {
        target: 'node24',
        outDir: harness,
        emptyOutDir: false,
        copyPublicDir: false,
        lib: {
          entry: path.resolve('test/fixtures/harness/control-bridge.ts'),
          formats: ['es'],
          fileName: () => 'core.mjs'
        },
        rollupOptions: { external: [...builtinModules, /^node:/] }
      }
    })
  })
  afterEach(async () => {
    for (const owner of owners.splice(0)) await owner.close()
  })
  afterAll(async () => {
    if (directory) {
      const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
  const create = (): HarnessControlPort => {
    if (!harness || !directory) throw new Error('Control test fixture has not started')
    let runtime: HarnessRuntime | undefined
    let connection: CoreRuntimeConnection | undefined
    let startup: Promise<void> | undefined
    let requests = 0
    let pending = 0
    const start = () =>
      (startup ??= (async () => {
        runtime = await HarnessRuntime.start({
          directory: harness!,
          electronExecutable: process.execPath,
          capacity: 1,
          maxPending: 4,
          observe() {}
        })
        connection = await CoreRuntimeConnection.connect({
          runtime,
          temporaryDirectory: directory!,
          native: async () => {
            throw new Error('Unexpected Native operation')
          }
        })
      })())
    const control = new CoreHarnessControl(
      {
        async control(_generation, sequence, command) {
          requests++
          pending++
          try {
            await start()
            return await connection!.invokeRoute(
              'settings.getSnapshot',
              { sequence, command },
              { caller: { kind: 'renderer', webContentsId: 1, windowId: null } },
              () => {}
            )
          } finally {
            pending--
          }
        }
      },
      'test',
      () => {}
    )
    const flush = async () => {
      if (control.closed || (!startup && pending === 0)) return
      // Finish real RPC work before advancing the application's virtual clock.
      for (;;) {
        await control.send({
          method: 'clearSession',
          sessionId: 'fixture-flush',
          originScopeId: null
        })
        const previous = requests
        await setImmediate()
        if (pending === 0 && requests === previous) return
      }
    }
    owners.push({
      flush,
      async close() {
        await flush()
        control.stop()
        if (startup) {
          try {
            await startup
          } catch {}
          await runtime?.stop()
          await connection?.closeAfterHostExit()
        }
      }
    })
    return control
  }
  return Object.assign(create, {
    async flush() {
      for (const owner of owners) await owner.flush()
    }
  })
}
