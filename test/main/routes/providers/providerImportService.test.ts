import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderImportService } from '../../../../src/main/routes/providers/providerImportService'
import type { LLM_PROVIDER } from '../../../../src/shared/presenter'

const mockSqlite = vi.hoisted(() => ({
  rowsByPath: new Map<string, Record<string, unknown>[]>()
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    default: actual
  }
})

vi.mock('better-sqlite3-multiple-ciphers', () => {
  class MockDatabase {
    private readonly dbPath: string

    constructor(dbPath: string) {
      this.dbPath = dbPath
      if (!mockSqlite.rowsByPath.has(dbPath)) {
        throw new Error(`Mock SQLite database is not registered: ${dbPath}`)
      }
    }

    prepare(sql: string) {
      if (sql.includes('sqlite_master')) {
        return {
          get: () => ({ name: 'providers' })
        }
      }

      if (sql.includes('FROM providers')) {
        return {
          all: (...appTypes: string[]) => {
            const rows = mockSqlite.rowsByPath.get(this.dbPath) ?? []
            const allowed = new Set(appTypes)
            return rows.filter((row) => allowed.size === 0 || allowed.has(String(row.app_type)))
          }
        }
      }

      throw new Error(`Unexpected SQLite query: ${sql}`)
    }

    close() {}
  }

  return {
    default: MockDatabase
  }
})

const writeFile = (filePath: string, content: string) => {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

const createCcSwitchDb = (
  dbPath: string,
  rows: Array<{
    id: string
    appType: string
    name: string
    settingsConfig: Record<string, unknown>
    meta?: Record<string, unknown>
  }>
) => {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  writeFileSync(dbPath, 'mock sqlite database')
  mockSqlite.rowsByPath.set(
    dbPath,
    rows.map((row) => ({
      id: row.id,
      app_type: row.appType,
      name: row.name,
      settings_config: JSON.stringify(row.settingsConfig),
      meta: JSON.stringify(row.meta ?? {})
    }))
  )
}

const writeDarwinCcSwitchAppPaths = (homeDir: string, overrideDir: string, content?: string) => {
  writeFile(
    path.join(homeDir, 'Library/Application Support/com.ccswitch.desktop/app_paths.json'),
    content ?? JSON.stringify({ app_config_dir_override: overrideDir })
  )
}

const writeCherryStudioConfig = (homeDir: string, appDataPath: unknown) => {
  writeFile(path.join(homeDir, '.cherrystudio/config/config.json'), JSON.stringify({ appDataPath }))
}

const createCherryStudioLevelDb = async (
  dbPath: string,
  providers: Array<{
    id: string
    name: string
    type: string
    apiKey?: string
    apiHost?: string
    baseUrl?: string
    models?: unknown[]
  }>
) => {
  mkdirSync(dbPath, { recursive: true })
  const { Level } = await import('level')
  const db = new Level(dbPath, {
    keyEncoding: 'buffer',
    valueEncoding: 'buffer'
  } as any)
  await db.open()
  await db.put(
    Buffer.from('persist:cherry-studio'),
    Buffer.from(
      JSON.stringify({
        llm: JSON.stringify({
          providers
        })
      })
    )
  )
  await db.close()
}

const createHome = () => mkdtempSync(path.join(tmpdir(), 'deepchat-provider-import-'))

const createConfigPresenter = (initialProviders?: LLM_PROVIDER[]) => {
  let providers: LLM_PROVIDER[] =
    initialProviders ??
    ([
      {
        id: 'openai',
        name: 'OpenAI',
        apiType: 'openai',
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        enable: false
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        apiType: 'deepseek',
        apiKey: '',
        baseUrl: 'https://api.deepseek.com/v1',
        enable: false
      }
    ] as LLM_PROVIDER[])

  const defaults = providers.map((provider) => ({ ...provider }))

  return {
    getProviders: vi.fn(() => providers),
    getDefaultProviders: vi.fn(() => defaults),
    updateProvidersBatch: vi.fn((input: { providers: LLM_PROVIDER[] }) => {
      providers = input.providers
    }),
    addCustomModel: vi.fn(),
    getCurrentProviders: () => providers
  }
}

describe('ProviderImportService', () => {
  let homeDir = ''

  afterEach(() => {
    mockSqlite.rowsByPath.clear()
    vi.unstubAllEnvs()
    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true })
      homeDir = ''
    }
  })

  it('returns an empty result for expired import sessions', () => {
    homeDir = createHome()
    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const result = service.apply({
      sessionId: 'expired-session',
      selections: []
    })

    expect(result).toEqual({
      summary: {
        imported: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        overwritten: 0,
        models: 0
      },
      results: []
    })
  })

  it('does not expose source read errors in scan results', async () => {
    homeDir = createHome()
    writeFile(path.join(homeDir, '.hermes/config.yaml'), 'llm:\n  providers: [')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const result = await service.scan()
    const hermes = result.sources.find((source) => source.id === 'hermes')

    expect(hermes).toMatchObject({
      status: 'error',
      message: 'Failed to read provider config'
    })
    expect(hermes?.message).not.toContain('Flow sequence')
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('scans Linux using the same home-relative paths as macOS', async () => {
    homeDir = createHome()
    writeFile(
      path.join(homeDir, '.openclaw/gateway.yaml'),
      [
        'providers:',
        '  - id: linux-openai',
        '    name: Linux OpenAI',
        '    type: openai-compatible',
        '    apiKey: sk-linux',
        '    baseUrl: https://linux.example.com/v1'
      ].join('\n')
    )

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'linux'
    })

    const result = await service.scan()

    expect(result.sources.find((source) => source.id === 'openclaw')).toMatchObject({
      status: 'found',
      configPath: '~/.openclaw/gateway.yaml',
      providerCount: 1,
      selectable: true
    })
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'openclaw',
          sourceProviderId: 'linux-openai',
          targetKind: 'custom',
          targetProviderId: 'openclaw_linux-openai'
        })
      ])
    )
  })

  it('scans Windows APPDATA and user profile paths', async () => {
    homeDir = createHome()
    const appDataDir = path.join(homeDir, 'AppData', 'Roaming')
    writeFile(path.join(appDataDir, 'alma/chat_threads.db'), 'not a sqlite database')
    writeFile(
      path.join(homeDir, '.hermes/config.yaml'),
      [
        'llm:',
        '  providers:',
        '    - id: windows-openai',
        '      name: Windows OpenAI',
        '      type: openai-compatible',
        '      apiKey: sk-windows',
        '      baseUrl: https://windows.example.com/v1'
      ].join('\n')
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'win32',
      appDataDir
    })

    const result = await service.scan()

    expect(result.sources.find((source) => source.id === 'alma')).toMatchObject({
      status: 'error',
      configPath: '%APPDATA%\\alma\\chat_threads.db'
    })
    expect(result.sources.find((source) => source.id === 'cherry-studio')).toMatchObject({
      status: 'not_found',
      configPath: '%APPDATA%\\CherryStudio\\Local Storage\\leveldb'
    })
    expect(result.sources.find((source) => source.id === 'hermes')).toMatchObject({
      status: 'found',
      configPath: '%USERPROFILE%\\.hermes\\config.yaml',
      providerCount: 1,
      selectable: true
    })
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'hermes',
          sourceProviderId: 'windows-openai',
          targetKind: 'custom',
          targetProviderId: 'hermes_windows-openai'
        })
      ])
    )
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('uses Windows HOME fallback for legacy CC Switch database paths', async () => {
    homeDir = createHome()
    const legacyHome = path.join(homeDir, 'legacy-home')
    vi.stubEnv('HOME', legacyHome)
    createCcSwitchDb(path.join(legacyHome, '.cc-switch/cc-switch.db'), [
      {
        id: 'deepseek',
        appType: 'claude',
        name: 'DeepSeek',
        settingsConfig: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
            ANTHROPIC_AUTH_TOKEN: 'sk-deepseek'
          }
        }
      }
    ])

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'win32',
      appDataDir: path.join(homeDir, 'AppData', 'Roaming')
    })

    const result = await service.scan()

    expect(result.sources.find((source) => source.id === 'cc-switch')).toMatchObject({
      status: 'found',
      configPath: '%HOME%\\.cc-switch\\cc-switch.db',
      providerCount: 1,
      selectable: true
    })
  })

  it('uses CC Switch Desktop app path override before the default database', async () => {
    homeDir = createHome()
    const overrideDir = path.join(homeDir, 'configSync/cc-switch')
    writeDarwinCcSwitchAppPaths(homeDir, overrideDir)
    createCcSwitchDb(path.join(homeDir, '.cc-switch/cc-switch.db'), [
      {
        id: 'default-deepseek',
        appType: 'claude',
        name: 'Default DeepSeek',
        settingsConfig: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
            ANTHROPIC_AUTH_TOKEN: 'sk-default'
          }
        }
      }
    ])
    createCcSwitchDb(path.join(overrideDir, 'cc-switch.db'), [
      {
        id: 'nextapi',
        appType: 'claude',
        name: 'Nextapi',
        settingsConfig: {
          env: {
            ANTHROPIC_BASE_URL: 'https://next-api.example.com',
            ANTHROPIC_AUTH_TOKEN: 'sk-nextapi',
            ANTHROPIC_MODEL: 'glm-5'
          }
        }
      }
    ])

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const result = await service.scan()

    expect(result.sources.find((source) => source.id === 'cc-switch')).toMatchObject({
      status: 'found',
      configPath: '~/configSync/cc-switch/cc-switch.db',
      providerCount: 1,
      selectable: true
    })
    expect(result.providers).toEqual([
      expect.objectContaining({
        sourceId: 'cc-switch',
        sourceProviderId: 'nextapi',
        name: 'Nextapi',
        targetKind: 'custom',
        targetProviderId: 'ccswitch_nextapi',
        modelPreview: ['glm-5']
      })
    ])
  })

  it('falls back to the default CC Switch database when Desktop override JSON is invalid', async () => {
    homeDir = createHome()
    writeDarwinCcSwitchAppPaths(homeDir, '', '{')
    createCcSwitchDb(path.join(homeDir, '.cc-switch/cc-switch.db'), [
      {
        id: 'deepseek',
        appType: 'claude',
        name: 'DeepSeek',
        settingsConfig: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
            ANTHROPIC_AUTH_TOKEN: 'sk-deepseek'
          }
        }
      }
    ])

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const result = await service.scan()

    expect(result.sources.find((source) => source.id === 'cc-switch')).toMatchObject({
      status: 'found',
      configPath: '~/.cc-switch/cc-switch.db',
      providerCount: 1,
      selectable: true
    })
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'cc-switch',
          sourceProviderId: 'deepseek'
        })
      ])
    )
  })

  it('falls back to the default CC Switch database when Desktop override db is missing', async () => {
    homeDir = createHome()
    writeDarwinCcSwitchAppPaths(homeDir, path.join(homeDir, 'missing-cc-switch'))
    createCcSwitchDb(path.join(homeDir, '.cc-switch/cc-switch.db'), [
      {
        id: 'deepseek',
        appType: 'claude',
        name: 'DeepSeek',
        settingsConfig: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
            ANTHROPIC_AUTH_TOKEN: 'sk-deepseek'
          }
        }
      }
    ])

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const result = await service.scan()

    expect(result.sources.find((source) => source.id === 'cc-switch')).toMatchObject({
      status: 'found',
      configPath: '~/.cc-switch/cc-switch.db',
      providerCount: 1,
      selectable: true
    })
  })

  it('reports an error on the CC Switch Desktop override database instead of falling back', async () => {
    homeDir = createHome()
    const overrideDir = path.join(homeDir, 'configSync/cc-switch')
    writeDarwinCcSwitchAppPaths(homeDir, overrideDir)
    writeFile(path.join(overrideDir, 'cc-switch.db'), 'unregistered mock database')
    createCcSwitchDb(path.join(homeDir, '.cc-switch/cc-switch.db'), [
      {
        id: 'deepseek',
        appType: 'claude',
        name: 'DeepSeek',
        settingsConfig: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
            ANTHROPIC_AUTH_TOKEN: 'sk-deepseek'
          }
        }
      }
    ])
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const result = await service.scan()

    expect(result.sources.find((source) => source.id === 'cc-switch')).toMatchObject({
      status: 'error',
      configPath: '~/configSync/cc-switch/cc-switch.db',
      providerCount: 0,
      selectable: false,
      message: 'Failed to read provider config'
    })
    expect(result.providers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'cc-switch',
          sourceProviderId: 'deepseek'
        })
      ])
    )

    warnSpy.mockRestore()
  })

  it('keeps Codex-only CC Switch Desktop override providers hidden', async () => {
    homeDir = createHome()
    const overrideDir = path.join(homeDir, 'configSync/cc-switch')
    writeDarwinCcSwitchAppPaths(homeDir, overrideDir)
    createCcSwitchDb(path.join(overrideDir, 'cc-switch.db'), [
      {
        id: 'codex-gateway',
        appType: 'codex',
        name: 'Codex Gateway',
        settingsConfig: {
          auth: { OPENAI_API_KEY: 'sk-codex' },
          config: 'model = "gpt-5.4"'
        }
      }
    ])

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const result = await service.scan()

    expect(result.sources.find((source) => source.id === 'cc-switch')).toMatchObject({
      status: 'found',
      configPath: '~/configSync/cc-switch/cc-switch.db',
      providerCount: 0,
      selectable: false,
      defaultSelected: false
    })
    expect(result.providers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: 'cc-switch' })])
    )
  })

  it('scans Hermes and OpenClaw configs and maps builtin and custom providers', async () => {
    homeDir = createHome()
    writeFile(
      path.join(homeDir, '.hermes/config.yaml'),
      [
        'llm:',
        '  providers:',
        '    - id: openai',
        '      name: OpenAI',
        '      type: openai',
        '      apiKey: sk-openai',
        '      baseUrl: https://api.openai.com/v1',
        '      models:',
        '        - id: gpt-4o',
        '          name: GPT-4o',
        '    - id: custom-one',
        '      name: Team Gateway',
        '      type: openai-compatible',
        '      apiKey: sk-custom',
        '      baseUrl: https://gateway.example.com/v1'
      ].join('\n')
    )
    writeFile(
      path.join(homeDir, '.openclaw/gateway.yaml'),
      [
        'providers:',
        '  - id: deepseek',
        '    name: DeepSeek',
        '    type: deepseek',
        '    apiKey: sk-deepseek',
        '    baseUrl: https://api.deepseek.com/v1'
      ].join('\n')
    )

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const result = await service.scan()

    expect(result.sources.find((source) => source.id === 'hermes')).toMatchObject({
      status: 'found',
      providerCount: 2,
      selectable: true,
      defaultSelected: true
    })
    expect(result.sources.find((source) => source.id === 'openclaw')).toMatchObject({
      status: 'found',
      providerCount: 1,
      selectable: true,
      defaultSelected: true
    })
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'hermes',
          sourceProviderId: 'openai',
          targetKind: 'builtin',
          targetProviderId: 'openai',
          defaultSelected: true,
          modelPreview: ['GPT-4o']
        }),
        expect.objectContaining({
          sourceId: 'hermes',
          sourceProviderId: 'custom-one',
          targetKind: 'custom',
          targetProviderId: 'hermes_custom-one',
          defaultSelected: true
        }),
        expect.objectContaining({
          sourceId: 'openclaw',
          sourceProviderId: 'deepseek',
          targetKind: 'builtin',
          targetProviderId: 'deepseek',
          defaultSelected: true
        })
      ])
    )
  })

  it('does not select providers by default when DeepChat already has a config', async () => {
    homeDir = createHome()
    writeFile(
      path.join(homeDir, '.hermes/config.yaml'),
      [
        'llm:',
        '  providers:',
        '    - id: openai',
        '      name: OpenAI',
        '      type: openai',
        '      apiKey: sk-imported',
        '      baseUrl: https://api.openai.com/v1'
      ].join('\n')
    )

    const configPresenter = createConfigPresenter([
      {
        id: 'openai',
        name: 'OpenAI',
        apiType: 'openai',
        apiKey: 'sk-existing',
        baseUrl: 'https://api.openai.com/v1',
        enable: true
      } as LLM_PROVIDER
    ])
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const result = await service.scan()
    const provider = result.providers[0]

    expect(provider).toMatchObject({
      targetProviderId: 'openai',
      configured: true,
      selectable: true,
      defaultSelected: false
    })
    expect(provider.warnings).toContain('already_configured')
  })

  it('hides missing-key providers and maps unknown key-url providers to custom', async () => {
    homeDir = createHome()
    writeFile(
      path.join(homeDir, '.hermes/config.yaml'),
      [
        'llm:',
        '  providers:',
        '    - id: deepseek',
        '      name: DeepSeek',
        '      type: deepseek',
        '      baseUrl: https://api.deepseek.com/v1',
        '    - id: legacy-only',
        '      name: Legacy Only',
        '      type: legacy-wire',
        '      apiKey: sk-legacy',
        '      baseUrl: https://legacy.example.com',
        '    - id: credential-only',
        '      name: Credential Only',
        '      type: legacy-wire',
        '      apiKey: sk-token'
      ].join('\n')
    )

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const result = await service.scan()

    expect(result.sources.find((source) => source.id === 'hermes')).toMatchObject({
      status: 'found',
      providerCount: 2,
      selectable: true,
      defaultSelected: true
    })
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceProviderId: 'legacy-only',
          targetKind: 'custom',
          targetProviderId: 'hermes_legacy-only',
          targetApiType: 'openai-completions',
          selectable: true,
          defaultSelected: true,
          warnings: []
        }),
        expect.objectContaining({
          sourceProviderId: 'credential-only',
          targetKind: 'unsupported',
          selectable: false,
          defaultSelected: false,
          warnings: ['unsupported_provider']
        })
      ])
    )
    expect(result.providers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceProviderId: 'deepseek' })])
    )
  })

  it('suffixes custom provider ids when the generated id already exists with a different fingerprint', async () => {
    homeDir = createHome()
    writeFile(
      path.join(homeDir, '.hermes/config.yaml'),
      [
        'llm:',
        '  providers:',
        '    - id: gateway',
        '      name: Team Gateway',
        '      type: openai-compatible',
        '      apiKey: sk-new',
        '      baseUrl: https://new.example.com/v1'
      ].join('\n')
    )

    const configPresenter = createConfigPresenter([
      {
        id: 'hermes_gateway',
        name: 'Existing Gateway',
        apiType: 'openai-completions',
        apiKey: 'sk-existing',
        baseUrl: 'https://existing.example.com/v1',
        enable: true,
        custom: true
      } as LLM_PROVIDER
    ])
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })
    const scan = await service.scan()
    const provider = scan.providers[0]

    const result = service.apply({
      sessionId: scan.sessionId,
      selections: [{ sourceId: 'hermes', providerIds: [provider.id] }]
    })

    expect(result.summary).toMatchObject({
      imported: 1,
      created: 1,
      overwritten: 0
    })
    expect(result.results[0]).toMatchObject({
      status: 'created',
      targetProviderId: 'hermes_gateway-2'
    })
    expect(configPresenter.getCurrentProviders()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'hermes_gateway',
          apiKey: 'sk-existing'
        }),
        expect.objectContaining({
          id: 'hermes_gateway-2',
          apiKey: 'sk-new',
          baseUrl: 'https://new.example.com/v1'
        })
      ])
    )
  })

  it('applies user selected api type overrides for custom providers', async () => {
    homeDir = createHome()
    writeFile(
      path.join(homeDir, '.hermes/config.yaml'),
      [
        'llm:',
        '  providers:',
        '    - id: coding-plan',
        '      name: Coding Plan',
        '      type: vendor-coding',
        '      apiKey: sk-coding',
        '      baseUrl: https://api.coding.example.com/v1'
      ].join('\n')
    )

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })
    const scan = await service.scan()
    const provider = scan.providers[0]

    expect(provider).toMatchObject({
      targetKind: 'custom',
      targetApiType: 'openai-completions',
      selectable: true
    })

    const result = service.apply({
      sessionId: scan.sessionId,
      selections: [
        {
          sourceId: 'hermes',
          providerIds: [provider.id],
          providerOptions: {
            [provider.id]: {
              targetApiType: 'anthropic'
            }
          }
        }
      ]
    })

    expect(result.summary).toMatchObject({
      imported: 1,
      created: 1
    })
    expect(configPresenter.getCurrentProviders()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'hermes_coding-plan',
          apiType: 'anthropic',
          apiKey: 'sk-coding',
          baseUrl: 'https://api.coding.example.com/v1'
        })
      ])
    )
  })

  it('preserves existing custom provider metadata when updating by fingerprint', async () => {
    homeDir = createHome()
    writeFile(
      path.join(homeDir, '.hermes/config.yaml'),
      [
        'llm:',
        '  providers:',
        '    - id: gateway',
        '      name: Imported Gateway',
        '      type: openai-compatible',
        '      apiKey: sk-existing',
        '      baseUrl: https://gateway.example.com/v1'
      ].join('\n')
    )

    const configPresenter = createConfigPresenter([
      {
        id: 'team_gateway',
        capabilityProviderId: 'capability-team',
        name: 'Existing Gateway',
        apiType: 'openai-completions',
        apiKey: 'sk-existing',
        baseUrl: 'https://gateway.example.com/v1',
        enable: false,
        custom: true,
        customModels: [
          {
            id: 'existing-model',
            name: 'Existing Model',
            group: 'custom',
            providerId: 'team_gateway',
            isCustom: true,
            enabled: true,
            vision: false,
            functionCall: false,
            reasoning: false,
            type: 'chat'
          } as any
        ],
        enabledModels: ['existing-model'],
        websites: {
          official: 'https://gateway.example.com',
          apiKey: 'https://gateway.example.com/key'
        },
        rateLimit: {
          enabled: true,
          qpsLimit: 2
        }
      } as LLM_PROVIDER
    ])
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })
    const scan = await service.scan()
    const provider = scan.providers[0]

    const result = service.apply({
      sessionId: scan.sessionId,
      selections: [
        {
          sourceId: 'hermes',
          providerIds: [provider.id],
          providerOptions: {
            [provider.id]: {
              targetApiType: 'anthropic'
            }
          }
        }
      ]
    })

    expect(result.summary).toMatchObject({
      imported: 1,
      updated: 1
    })
    expect(configPresenter.getCurrentProviders()).toHaveLength(1)
    expect(configPresenter.getCurrentProviders()[0]).toMatchObject({
      id: 'team_gateway',
      capabilityProviderId: 'capability-team',
      name: 'Imported Gateway',
      apiType: 'anthropic',
      apiKey: 'sk-existing',
      baseUrl: 'https://gateway.example.com/v1',
      enable: true,
      custom: true,
      customModels: [expect.objectContaining({ id: 'existing-model' })],
      enabledModels: ['existing-model'],
      websites: {
        official: 'https://gateway.example.com',
        apiKey: 'https://gateway.example.com/key'
      },
      rateLimit: {
        enabled: true,
        qpsLimit: 2
      }
    })
  })

  it('hides custom base-url-only providers even if they could be overridden to ollama', async () => {
    homeDir = createHome()
    writeFile(
      path.join(homeDir, '.hermes/config.yaml'),
      [
        'llm:',
        '  providers:',
        '    - id: local-ollama',
        '      name: Local Ollama',
        '      type: openai-compatible',
        '      baseUrl: http://localhost:11434'
      ].join('\n')
    )

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })
    const scan = await service.scan()

    expect(scan.sources.find((source) => source.id === 'hermes')).toMatchObject({
      status: 'found',
      providerCount: 0,
      selectable: false,
      defaultSelected: false
    })
    expect(scan.providers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceProviderId: 'local-ollama' })])
    )
  })

  it('does not default-select custom openai-compatible providers without a base URL', async () => {
    homeDir = createHome()
    writeFile(
      path.join(homeDir, '.hermes/config.yaml'),
      [
        'llm:',
        '  providers:',
        '    - id: missing-endpoint',
        '      name: Missing Endpoint',
        '      type: openai-compatible',
        '      apiKey: sk-missing-endpoint'
      ].join('\n')
    )

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })
    const scan = await service.scan()
    const provider = scan.providers[0]

    expect(scan.sources.find((source) => source.id === 'hermes')).toMatchObject({
      selectable: false,
      defaultSelected: false
    })
    expect(provider).toMatchObject({
      targetKind: 'custom',
      selectable: false,
      defaultSelected: false,
      warnings: ['missing_api_key']
    })

    const result = service.apply({
      sessionId: scan.sessionId,
      selections: [{ sourceId: 'hermes', providerIds: [provider.id] }]
    })

    expect(result.summary).toMatchObject({
      imported: 0,
      skipped: 1
    })
    expect(configPresenter.getCurrentProviders()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'hermes_missing-endpoint'
        })
      ])
    )
  })

  it('scans CC Switch non-Codex providers and hides empty or Codex rows', async () => {
    homeDir = createHome()
    createCcSwitchDb(path.join(homeDir, '.cc-switch/cc-switch.db'), [
      {
        id: 'claude-official',
        appType: 'claude',
        name: 'Claude Official',
        settingsConfig: { env: {} }
      },
      {
        id: 'deepseek',
        appType: 'claude',
        name: 'DeepSeek',
        settingsConfig: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
            ANTHROPIC_AUTH_TOKEN: 'sk-deepseek',
            ANTHROPIC_MODEL: 'deepseek-v4-pro'
          }
        }
      },
      {
        id: 'minimax-en',
        appType: 'claude-desktop',
        name: 'MiniMax en',
        settingsConfig: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic',
            ANTHROPIC_API_KEY: 'sk-minimax',
            ANTHROPIC_MODEL: 'MiniMax-M2.7'
          }
        },
        meta: {
          claudeDesktopModelRoutes: {
            sonnet: {
              model: 'MiniMax-M2.7'
            }
          }
        }
      },
      {
        id: 'gemini-native',
        appType: 'gemini',
        name: 'Gemini Native',
        settingsConfig: {
          env: {
            GEMINI_API_KEY: 'sk-gemini',
            GOOGLE_GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com',
            GEMINI_MODEL: 'gemini-3-pro'
          }
        }
      },
      {
        id: 'opencode-gateway',
        appType: 'opencode',
        name: 'OpenCode Gateway',
        settingsConfig: {
          npm: '@ai-sdk/openai-compatible',
          options: {
            apiKey: 'sk-opencode',
            baseURL: 'https://opencode.example.com/v1'
          },
          models: {
            'gpt-5.4': { name: 'GPT-5.4' }
          }
        }
      },
      {
        id: 'openclaw-gateway',
        appType: 'openclaw',
        name: 'OpenClaw Gateway',
        settingsConfig: {
          apiKey: 'sk-openclaw',
          baseUrl: 'https://openclaw.example.com/v1',
          api: 'openai-responses',
          models: [{ id: 'gpt-5.4', name: 'GPT-5.4' }]
        }
      },
      {
        id: 'hermes-gateway',
        appType: 'hermes',
        name: 'Hermes Gateway',
        settingsConfig: {
          api_key: 'sk-hermes',
          base_url: 'https://hermes.example.com/v1',
          api_mode: 'anthropic_messages',
          models: {
            'claude-sonnet': { name: 'Claude Sonnet' }
          }
        }
      },
      {
        id: 'codex-gateway',
        appType: 'codex',
        name: 'Codex Gateway',
        settingsConfig: {
          auth: { OPENAI_API_KEY: 'sk-codex' },
          config: 'model = "gpt-5.4"'
        }
      }
    ])

    const configPresenter = createConfigPresenter([
      {
        id: 'openai',
        name: 'OpenAI',
        apiType: 'openai',
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        enable: false
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        apiType: 'deepseek',
        apiKey: '',
        baseUrl: 'https://api.deepseek.com/v1',
        enable: false
      },
      {
        id: 'minimax',
        name: 'MiniMax',
        apiType: 'anthropic',
        apiKey: '',
        baseUrl: 'https://api.minimaxi.com/anthropic',
        enable: false
      },
      {
        id: 'gemini',
        name: 'Gemini',
        apiType: 'gemini',
        apiKey: '',
        baseUrl: 'https://generativelanguage.googleapis.com',
        enable: false
      }
    ] as LLM_PROVIDER[])
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const scan = await service.scan()

    expect(scan.sourceOrder[0]).toBe('cc-switch')
    expect(scan.sources.find((source) => source.id === 'cc-switch')).toMatchObject({
      status: 'found',
      configPath: '~/.cc-switch/cc-switch.db',
      providerCount: 6,
      selectable: true,
      defaultSelected: true
    })
    expect(scan.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'cc-switch',
          sourceProviderId: 'deepseek',
          targetKind: 'builtin',
          targetProviderId: 'deepseek',
          modelPreview: ['deepseek-v4-pro'],
          warnings: ['credential_only_import']
        }),
        expect.objectContaining({
          sourceId: 'cc-switch',
          sourceProviderId: 'minimax-en',
          targetKind: 'builtin',
          targetProviderId: 'minimax',
          targetApiType: 'anthropic',
          modelPreview: ['MiniMax-M2.7']
        }),
        expect.objectContaining({
          sourceId: 'cc-switch',
          sourceProviderId: 'gemini-native',
          targetKind: 'builtin',
          targetProviderId: 'gemini',
          targetApiType: 'gemini'
        }),
        expect.objectContaining({
          sourceId: 'cc-switch',
          sourceProviderId: 'opencode-gateway',
          targetKind: 'custom',
          targetProviderId: 'ccswitch_opencode-gateway',
          targetApiType: 'openai-completions',
          modelPreview: ['GPT-5.4']
        }),
        expect.objectContaining({
          sourceId: 'cc-switch',
          sourceProviderId: 'openclaw-gateway',
          targetKind: 'custom',
          targetApiType: 'openai-responses'
        }),
        expect.objectContaining({
          sourceId: 'cc-switch',
          sourceProviderId: 'hermes-gateway',
          targetKind: 'custom',
          targetApiType: 'anthropic',
          modelPreview: ['Claude Sonnet']
        })
      ])
    )
    expect(scan.providers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceProviderId: 'claude-official' }),
        expect.objectContaining({ sourceProviderId: 'codex-gateway' })
      ])
    )
  })

  it('imports only API key for CC Switch DeepSeek Anthropic-compatible provider', async () => {
    homeDir = createHome()
    createCcSwitchDb(path.join(homeDir, '.cc-switch/cc-switch.db'), [
      {
        id: 'deepseek',
        appType: 'claude',
        name: 'DeepSeek',
        settingsConfig: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
            ANTHROPIC_AUTH_TOKEN: 'sk-deepseek',
            ANTHROPIC_MODEL: 'deepseek-v4-pro'
          }
        }
      }
    ])

    const configPresenter = createConfigPresenter([
      {
        id: 'deepseek',
        name: 'DeepSeek',
        apiType: 'deepseek',
        apiKey: '',
        baseUrl: 'https://api.deepseek.com/v1',
        enable: false
      }
    ] as LLM_PROVIDER[])
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })
    const scan = await service.scan()
    const provider = scan.providers[0]

    expect(provider).toMatchObject({
      sourceProviderId: 'deepseek',
      targetProviderId: 'deepseek',
      targetApiType: 'deepseek',
      warnings: ['credential_only_import']
    })

    const result = service.apply({
      sessionId: scan.sessionId,
      selections: [{ sourceId: 'cc-switch', providerIds: [provider.id] }]
    })

    expect(result.summary).toMatchObject({
      imported: 1,
      updated: 1,
      models: 0
    })
    expect(configPresenter.getCurrentProviders()[0]).toMatchObject({
      id: 'deepseek',
      apiType: 'deepseek',
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      enable: true
    })
    expect(configPresenter.addCustomModel).not.toHaveBeenCalled()
  })

  it('maps CC Switch MiniMax to built-in Anthropic runtime provider', async () => {
    homeDir = createHome()
    createCcSwitchDb(path.join(homeDir, '.cc-switch/cc-switch.db'), [
      {
        id: 'minimax',
        appType: 'claude',
        name: 'MiniMax',
        settingsConfig: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
            ANTHROPIC_AUTH_TOKEN: 'sk-minimax',
            ANTHROPIC_MODEL: 'MiniMax-M2.7'
          }
        }
      }
    ])

    const configPresenter = createConfigPresenter([
      {
        id: 'minimax',
        name: 'MiniMax',
        apiType: 'anthropic',
        apiKey: '',
        baseUrl: 'https://api.minimaxi.com/anthropic',
        enable: false
      }
    ] as LLM_PROVIDER[])
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })
    const scan = await service.scan()
    const provider = scan.providers[0]

    expect(provider).toMatchObject({
      sourceProviderId: 'minimax',
      targetKind: 'builtin',
      targetProviderId: 'minimax',
      targetApiType: 'anthropic',
      warnings: []
    })

    const result = service.apply({
      sessionId: scan.sessionId,
      selections: [{ sourceId: 'cc-switch', providerIds: [provider.id] }]
    })

    expect(result.summary).toMatchObject({
      imported: 1,
      updated: 1,
      models: 1
    })
    expect(configPresenter.getCurrentProviders()[0]).toMatchObject({
      id: 'minimax',
      apiType: 'anthropic',
      apiKey: 'sk-minimax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      enable: true
    })
    expect(configPresenter.addCustomModel).toHaveBeenCalledWith(
      'minimax',
      expect.objectContaining({
        id: 'MiniMax-M2.7',
        providerId: 'minimax'
      })
    )
  })

  it('maps CC Switch Claude official identity to built-in Anthropic provider', async () => {
    homeDir = createHome()
    createCcSwitchDb(path.join(homeDir, '.cc-switch/cc-switch.db'), [
      {
        id: 'claude-official',
        appType: 'claude',
        name: 'Claude Official',
        settingsConfig: {
          env: {
            ANTHROPIC_AUTH_TOKEN: 'sk-anthropic',
            ANTHROPIC_MODEL: 'claude-sonnet-4-5'
          }
        }
      }
    ])

    const configPresenter = createConfigPresenter([
      {
        id: 'anthropic',
        name: 'Anthropic',
        apiType: 'anthropic',
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        enable: false
      }
    ] as LLM_PROVIDER[])
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const scan = await service.scan()

    expect(scan.providers[0]).toMatchObject({
      sourceProviderId: 'claude-official',
      targetKind: 'builtin',
      targetProviderId: 'anthropic',
      targetApiType: 'anthropic',
      warnings: []
    })
  })

  it('maps Kimi Code base URL to the built-in Kimi For Coding provider', async () => {
    homeDir = createHome()
    const defaultCherryPath = path.join(
      homeDir,
      'Library/Application Support/CherryStudio/Local Storage/leveldb'
    )
    await createCherryStudioLevelDb(defaultCherryPath, [
      {
        id: 'kimi-code',
        name: 'Kimi Code',
        type: 'openai',
        apiKey: 'sk-kimi',
        apiHost: 'https://api.kimi.com/coding/v1',
        models: [{ id: 'kimi-for-coding', name: 'K2.7 Code' }]
      }
    ])

    const configPresenter = createConfigPresenter([
      {
        id: 'kimi-for-coding',
        name: 'Kimi For Coding',
        apiType: 'anthropic',
        apiKey: '',
        baseUrl: 'https://api.kimi.com/coding/',
        enable: false
      }
    ] as LLM_PROVIDER[])
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const scan = await service.scan()

    expect(scan.providers[0]).toMatchObject({
      sourceProviderId: 'kimi-code',
      targetKind: 'builtin',
      targetProviderId: 'kimi-for-coding',
      targetApiType: 'anthropic',
      modelPreview: ['K2.7 Code'],
      warnings: []
    })
  })

  it('uses Cherry Studio custom data directory from app config', async () => {
    homeDir = createHome()
    const defaultCherryPath = path.join(
      homeDir,
      'Library/Application Support/CherryStudio/Local Storage/leveldb'
    )
    const customCherryDataDir = path.join(homeDir, 'Downloads/cherrydata')
    const customCherryPath = path.join(customCherryDataDir, 'Local Storage/leveldb')
    writeCherryStudioConfig(homeDir, [
      {
        executablePath: '/Applications/Cherry Studio.app/Contents/MacOS/Cherry Studio',
        dataPath: customCherryDataDir
      }
    ])
    await createCherryStudioLevelDb(defaultCherryPath, [
      {
        id: 'default-openai',
        name: 'Default OpenAI',
        type: 'openai',
        apiKey: 'sk-default',
        apiHost: 'https://api.openai.com/v1'
      }
    ])
    await createCherryStudioLevelDb(customCherryPath, [
      {
        id: 'ppio',
        name: 'PPIO',
        type: 'openai',
        apiKey: 'sk-ppio',
        apiHost: 'https://api.ppinfra.com/v3/openai',
        models: [{ id: 'deepseek-r1', name: 'DeepSeek R1' }]
      }
    ])

    const configPresenter = createConfigPresenter([
      {
        id: 'ppio',
        name: 'PPIO',
        apiType: 'ppio',
        apiKey: '',
        baseUrl: 'https://api.ppinfra.com/v3/openai',
        enable: false
      } as LLM_PROVIDER
    ])
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const result = await service.scan()

    expect(result.sources.find((source) => source.id === 'cherry-studio')).toMatchObject({
      status: 'found',
      configPath: '~/Downloads/cherrydata/Local Storage/leveldb',
      providerCount: 1,
      selectable: true
    })
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'cherry-studio',
          sourceProviderId: 'ppio',
          targetKind: 'builtin',
          targetProviderId: 'ppio',
          modelPreview: ['DeepSeek R1']
        })
      ])
    )
    expect(result.providers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceProviderId: 'default-openai' })])
    )
  })

  it('falls back to the default Cherry Studio LevelDB when configured data directory is missing', async () => {
    homeDir = createHome()
    const defaultCherryPath = path.join(
      homeDir,
      'Library/Application Support/CherryStudio/Local Storage/leveldb'
    )
    writeCherryStudioConfig(homeDir, path.join(homeDir, 'Downloads/missing-cherry'))
    await createCherryStudioLevelDb(defaultCherryPath, [
      {
        id: 'ppio',
        name: 'PPIO',
        type: 'openai',
        apiKey: 'sk-ppio',
        apiHost: 'https://api.ppinfra.com/v3/openai',
        models: [{ id: 'deepseek-r1', name: 'DeepSeek R1' }]
      }
    ])

    const configPresenter = createConfigPresenter([
      {
        id: 'ppio',
        name: 'PPIO',
        apiType: 'ppio',
        apiKey: '',
        baseUrl: 'https://api.ppinfra.com/v3/openai',
        enable: false
      } as LLM_PROVIDER
    ])
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const result = await service.scan()

    expect(result.sources.find((source) => source.id === 'cherry-studio')).toMatchObject({
      status: 'found',
      configPath: '~/Library/Application Support/CherryStudio/Local Storage/leveldb',
      providerCount: 1,
      selectable: true
    })
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'cherry-studio',
          sourceProviderId: 'ppio',
          targetKind: 'builtin',
          targetProviderId: 'ppio'
        })
      ])
    )
  })

  it('reads Cherry Studio providers from a LevelDB snapshot', async () => {
    homeDir = createHome()
    const cherryPath = path.join(
      homeDir,
      'Library/Application Support/CherryStudio/Local Storage/leveldb'
    )
    await createCherryStudioLevelDb(cherryPath, [
      {
        id: 'ppio',
        name: 'PPIO',
        type: 'openai',
        apiKey: 'sk-ppio',
        apiHost: 'https://api.ppinfra.com/v3/openai',
        models: [{ id: 'deepseek-r1', name: 'DeepSeek R1' }]
      }
    ])

    const configPresenter = createConfigPresenter([
      {
        id: 'ppio',
        name: 'PPIO',
        apiType: 'ppio',
        apiKey: '',
        baseUrl: 'https://api.ppinfra.com/v3/openai',
        enable: false
      } as LLM_PROVIDER
    ])
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })

    const result = await service.scan()

    expect(result.sources.find((source) => source.id === 'cherry-studio')).toMatchObject({
      status: 'found',
      providerCount: 1,
      selectable: true
    })
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'cherry-studio',
          sourceProviderId: 'ppio',
          targetKind: 'builtin',
          targetProviderId: 'ppio',
          modelPreview: ['DeepSeek R1']
        })
      ])
    )
  })

  it('applies selected providers in source order and lets later sources overwrite earlier ones', async () => {
    homeDir = createHome()
    writeFile(
      path.join(homeDir, '.hermes/config.yaml'),
      [
        'llm:',
        '  providers:',
        '    - id: openai',
        '      name: OpenAI',
        '      type: openai',
        '      apiKey: sk-hermes',
        '      baseUrl: https://api.openai.com/v1'
      ].join('\n')
    )
    writeFile(
      path.join(homeDir, '.openclaw/gateway.yaml'),
      [
        'providers:',
        '  - id: openai',
        '    name: OpenAI',
        '    type: openai',
        '    apiKey: sk-openclaw',
        '    baseUrl: https://api.openai.com/v1'
      ].join('\n')
    )

    const configPresenter = createConfigPresenter()
    const service = new ProviderImportService(configPresenter as any, {
      homeDir,
      platform: 'darwin'
    })
    const scan = await service.scan()
    const hermesProvider = scan.providers.find((provider) => provider.sourceId === 'hermes')!
    const openclawProvider = scan.providers.find((provider) => provider.sourceId === 'openclaw')!

    const result = service.apply({
      sessionId: scan.sessionId,
      selections: [
        { sourceId: 'hermes', providerIds: [hermesProvider.id] },
        { sourceId: 'openclaw', providerIds: [openclawProvider.id] }
      ]
    })

    expect(result.summary).toMatchObject({
      imported: 1,
      updated: 1,
      overwritten: 1
    })
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: hermesProvider.id, status: 'overwritten' }),
        expect.objectContaining({ id: openclawProvider.id, status: 'updated' })
      ])
    )
    expect(
      configPresenter.getCurrentProviders().find((provider) => provider.id === 'openai')
    ).toMatchObject({
      apiKey: 'sk-openclaw',
      enable: true
    })
  })
})
