import { describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER } from '@shared/types/provider'

vi.mock('electron', async () => {
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { rmSync } = await import('node:fs')
  // Isolate the mocked userData per Vitest worker process and clean it up on
  // worker exit so parallel workers never share persistent store state.
  const userDataDir = join(tmpdir(), `deepchat-vitest-userdata-${process.pid}`)
  process.on('exit', () => {
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })
  const electronModuleMock = {
    app: {
      getName: vi.fn(() => 'DeepChat'),
      getPath: vi.fn((type: string) => (type === 'userData' ? userDataDir : '/mock/path')),
      getVersion: vi.fn(() => '0.0.0-test'),
      getLocale: vi.fn(() => 'en-US')
    },
    ipcMain: {
      on: vi.fn(),
      handle: vi.fn(),
      removeHandler: vi.fn()
    },
    nativeTheme: {
      shouldUseDarkColors: false
    },
    shell: {
      openPath: vi.fn()
    }
  }
  return { ...electronModuleMock, default: electronModuleMock }
})

import { ProviderSettings } from '../../../src/main/provider/settings'

const createTypesafeProvider = (baseUrl: string): LLM_PROVIDER => ({
  id: 'typesafe',
  name: 'System One',
  apiType: 'jev',
  apiKey: 'sk-test',
  baseUrl,
  enable: true,
  websites: {
    official: '',
    apiKey: '',
    docs: '',
    models: '',
    defaultBaseUrl: ''
  }
})

const runMigration = (providers: LLM_PROVIDER[]) => {
  const setProviderById = vi.fn()
  const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
    getProviders: vi.fn(() => providers),
    setProviderById
  })

  ;(
    presenter as ProviderSettings & { migrateTypesafeSystemOneEndpoint: () => void }
  ).migrateTypesafeSystemOneEndpoint()

  return setProviderById
}

describe('migrateTypesafeSystemOneEndpoint', () => {
  it('rewrites the bare host a pre-change build persisted to the full endpoint', () => {
    // The configured URL is posted verbatim now, so the legacy host would post to the host root.
    const setProviderById = runMigration([createTypesafeProvider('https://api.typesafe.ai')])

    expect(setProviderById).toHaveBeenCalledWith('typesafe', {
      ...createTypesafeProvider('https://api.typesafe.ai/v1/systemone')
    })
  })

  it.each([' https://api.typesafe.ai ', 'https://api.typesafe.ai/', 'https://api.typesafe.ai///'])(
    'rewrites the legacy host stored as %s',
    (baseUrl) => {
      // The request path trims and strips trailing slashes, so these forms reach the host root too.
      const setProviderById = runMigration([createTypesafeProvider(baseUrl)])

      expect(setProviderById).toHaveBeenCalledWith('typesafe', {
        ...createTypesafeProvider('https://api.typesafe.ai/v1/systemone')
      })
    }
  )

  it('leaves a configured endpoint and other providers untouched', () => {
    const setProviderById = runMigration([
      createTypesafeProvider('https://gateway.example.com/v1/systemone'),
      { ...createTypesafeProvider('https://api.typesafe.ai'), id: 'typesafe-copy' }
    ])

    expect(setProviderById).not.toHaveBeenCalled()
  })
})
