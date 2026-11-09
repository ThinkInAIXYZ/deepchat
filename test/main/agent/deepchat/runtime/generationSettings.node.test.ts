import { spawnSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('path')

it('loads generation settings in plain Node without Electron or a user profile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deepchat-generation-node-'))
  const profile = join(root, 'profile')
  try {
    await build({
      configFile: false,
      publicDir: false,
      logLevel: 'silent',
      resolve: {
        alias: {
          '@': resolve('src/main'),
          '@shared': resolve('src/shared')
        }
      },
      build: {
        target: 'node24',
        outDir: join(root, 'bundle'),
        minify: false,
        lib: {
          entry: resolve('src/main/agent/shared/generationSettings.ts'),
          formats: ['es'],
          fileName: () => 'settings.mjs'
        },
        rollupOptions: {
          external(id) {
            if (id === 'electron' || id.startsWith('electron/')) {
              throw new Error(`Forbidden Electron dependency: ${id}`)
            }
            return id.startsWith('node:') || ['fs', 'path', 'crypto'].includes(id)
          }
        }
      }
    })
    const env = { ...process.env }
    delete env.DEEPCHAT_E2E_USER_DATA_DIR
    delete env.NODE_OPTIONS
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict'
      import { existsSync } from 'node:fs'
      import { registerHooks } from 'node:module'
      import { pathToFileURL } from 'node:url'
      let electronResolutions = 0
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier === 'electron' || specifier.startsWith('electron/')) {
            electronResolutions++
            throw new Error('Electron is forbidden in this process')
          }
          return nextResolve(specifier, context)
        }
      })
      assert.equal(process.versions.electron, undefined)
      assert.equal(process.env.DEEPCHAT_E2E_USER_DATA_DIR, undefined)
      const settings = await import(pathToFileURL(process.argv[1]).href)
      const config = settings.resolveInterleavedReasoningConfig(
        { getProviderDbSourceUrl: () => 'https://example.com/catalog.json' },
        'deepseek', 'deepseek-v4', {}, { supportsReasoning: true, reasoningPortrait: null }
      )
      assert.equal(config.providerDbSourceUrl, 'https://example.com/catalog.json')
      assert.equal(config.preserveReasoningContent, true)
      assert.equal(electronResolutions, 0)
      assert.equal(existsSync(process.env.HOME), false)
      console.log('import=ok electronResolutions=0 profileExists=false providerCacheExists=false')
    `,
        join(root, 'bundle/settings.mjs')
      ],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...env,
          HOME: profile,
          USERPROFILE: profile,
          APPDATA: join(profile, 'AppData/Roaming'),
          LOCALAPPDATA: join(profile, 'AppData/Local'),
          XDG_CONFIG_HOME: join(profile, '.config'),
          XDG_CACHE_HOME: join(profile, '.cache')
        }
      }
    )
    expect(child.error).toBeUndefined()
    expect(child.status, child.stderr).toBe(0)
    expect(child.stdout.trim()).toBe(
      'import=ok electronResolutions=0 profileExists=false providerCacheExists=false'
    )
    expect(existsSync(profile)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
