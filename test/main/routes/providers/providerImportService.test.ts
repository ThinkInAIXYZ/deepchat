import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderImportService } from '../../../../src/main/routes/providers/providerImportService'
import type { LLM_PROVIDER } from '../../../../src/shared/presenter'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    default: actual
  }
})

const writeFile = (filePath: string, content: string) => {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
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

  it('previews missing-key providers and maps unknown key-url providers to custom', async () => {
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
      providerCount: 3,
      selectable: true,
      defaultSelected: true
    })
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceProviderId: 'deepseek',
          targetProviderId: 'deepseek',
          selectable: false,
          defaultSelected: false,
          warnings: ['missing_api_key']
        }),
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

  it('allows custom base-url-only providers to import when overridden to ollama', async () => {
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
    const provider = scan.providers[0]

    expect(provider).toMatchObject({
      targetKind: 'custom',
      targetApiType: 'openai-completions',
      selectable: true,
      defaultSelected: false,
      warnings: ['missing_api_key']
    })

    const result = service.apply({
      sessionId: scan.sessionId,
      selections: [
        {
          sourceId: 'hermes',
          providerIds: [provider.id],
          providerOptions: {
            [provider.id]: {
              targetApiType: 'ollama'
            }
          }
        }
      ]
    })

    expect(result.summary).toMatchObject({
      imported: 1,
      created: 1,
      skipped: 0
    })
    expect(configPresenter.getCurrentProviders()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'hermes_local-ollama',
          apiType: 'ollama',
          apiKey: '',
          baseUrl: 'http://localhost:11434'
        })
      ])
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

  it('reads Cherry Studio providers from a LevelDB snapshot', async () => {
    homeDir = createHome()
    const cherryPath = path.join(
      homeDir,
      'Library/Application Support/CherryStudio/Local Storage/leveldb'
    )
    mkdirSync(cherryPath, { recursive: true })
    const { Level } = await import('level')
    const db = new Level(cherryPath, {
      keyEncoding: 'buffer',
      valueEncoding: 'buffer'
    } as any)
    await db.open()
    await db.put(
      Buffer.from('persist:cherry-studio'),
      Buffer.from(
        JSON.stringify({
          llm: JSON.stringify({
            providers: [
              {
                id: 'ppio',
                name: 'PPIO',
                type: 'openai',
                apiKey: 'sk-ppio',
                apiHost: 'https://api.ppinfra.com/v3/openai',
                models: [{ id: 'deepseek-r1', name: 'DeepSeek R1' }]
              }
            ]
          })
        })
      )
    )
    await db.close()

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
