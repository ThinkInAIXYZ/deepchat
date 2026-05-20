import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { parse as parseYaml } from 'yaml'
import { nanoid } from 'nanoid'
import type { IConfigPresenter, LLM_PROVIDER, MODEL_META } from '@shared/presenter'
import { ModelType } from '@shared/model'
import {
  PROVIDER_IMPORT_CUSTOM_API_TYPES,
  PROVIDER_IMPORT_SOURCE_IDS,
  type ProviderImportApplyResult,
  type ProviderImportApplyResultItem,
  type ProviderImportCustomApiType,
  type ProviderImportMapping,
  type ProviderImportPlannedProvider,
  type ProviderImportProviderPreview,
  type ProviderImportRawModel,
  type ProviderImportRawProvider,
  type ProviderImportScanResult,
  type ProviderImportSelection,
  type ProviderImportSourceId,
  type ProviderImportSourceScan
} from '@shared/providerImport'
import type { ProviderChange } from '@shared/provider-operations'

type SourceDefinition = {
  id: ProviderImportSourceId
  name: string
  unixRelativePath: string
  windowsBase: 'appData' | 'home'
  windowsRelativePath: string
}

type SourceReadResult = {
  source: ProviderImportSourceScan
  providers: ProviderImportRawProvider[]
}

type ScanSession = ProviderImportScanResult & {
  rawProviders: ProviderImportRawProvider[]
  createdAt: number
}

type ProviderImportProviderOptions = NonNullable<ProviderImportSelection['providerOptions']>[string]

const SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    id: 'alma',
    name: 'Alma',
    unixRelativePath: 'Library/Application Support/alma/chat_threads.db',
    windowsBase: 'appData',
    windowsRelativePath: 'alma/chat_threads.db'
  },
  {
    id: 'cherry-studio',
    name: 'Cherry Studio',
    unixRelativePath: 'Library/Application Support/CherryStudio/Local Storage/leveldb',
    windowsBase: 'appData',
    windowsRelativePath: 'CherryStudio/Local Storage/leveldb'
  },
  {
    id: 'hermes',
    name: 'Hermes',
    unixRelativePath: '.hermes/config.yaml',
    windowsBase: 'home',
    windowsRelativePath: '.hermes/config.yaml'
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    unixRelativePath: '.openclaw/gateway.yaml',
    windowsBase: 'home',
    windowsRelativePath: '.openclaw/gateway.yaml'
  }
]

const SCAN_SESSION_TTL_MS = 10 * 60 * 1000
const API_TYPE_ALIASES: Record<string, string> = {
  'openai-response': 'openai-responses',
  'openai-responses': 'openai-responses',
  anthropic: 'anthropic',
  gemini: 'gemini',
  ollama: 'ollama',
  'new-api': 'new-api',
  silicon: 'silicon',
  siliconflow: 'silicon',
  siliconcloud: 'silicon',
  deepseek: 'deepseek',
  ppio: 'ppio',
  ppinfra: 'ppio',
  openrouter: 'openrouter',
  jiekou: 'jiekou',
  zenmux: 'zenmux',
  poe: 'poe',
  'vercel-ai-gateway': 'vercel-ai-gateway',
  together: 'together',
  github: 'github',
  'github-copilot': 'github-copilot',
  doubao: 'doubao',
  minimax: 'minimax',
  zhipu: 'zhipu',
  moonshot: 'moonshot',
  dashscope: 'dashscope',
  volcengine: 'doubao',
  ark: 'doubao',
  lmstudio: 'lmstudio',
  groq: 'groq',
  mistral: 'mistral',
  grok: 'grok',
  aihubmix: 'aihubmix',
  hunyuan: 'hunyuan',
  modelscope: 'modelscope',
  'azure-openai': 'azure-openai',
  'aws-bedrock': 'aws-bedrock',
  o3fan: 'o3fan'
}

const OPENAI_COMPATIBLE_TYPES = new Set([
  'custom',
  'openai',
  'openai-chat',
  'openai-compatible',
  'openai-completions',
  'gateway',
  'vertexai',
  'mistral',
  'aws-bedrock'
])

const SOURCE_PREFIX: Record<ProviderImportSourceId, string> = {
  alma: 'alma',
  'cherry-studio': 'cherry',
  hermes: 'hermes',
  openclaw: 'openclaw'
}

const normalizeToken = (value: string | undefined): string =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s.]+/g, '-')

const normalizeUrl = (value: string | undefined): string => (value ?? '').trim().replace(/\/+$/, '')

const hasHttpBaseUrl = (value: string | undefined): boolean =>
  /^https?:\/\//i.test(normalizeUrl(value))

const normalizeName = (value: string | undefined): string =>
  normalizeToken(value).replace(/[^a-z0-9-]/g, '')

const isOpenAIName = (value: string): boolean => {
  const normalized = normalizeName(value)
  return normalized === 'openai' || normalized === 'open-ai'
}

const maskApiKey = (value: string): string => {
  if (!value) return ''
  if (value.length <= 4) return '****'
  if (value.length <= 8) return `${value.slice(0, 2)}***${value.slice(-2)}`
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

const safeJsonParse = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const toStringValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()

const toBooleanValue = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return fallback
}

const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

const replaceDisallowedControlCharacters = (value: string): string => {
  let result = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    result +=
      codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13 ? ' ' : character
  }
  return result
}

const normalizeModels = (models: unknown): ProviderImportRawModel[] => {
  if (!Array.isArray(models)) return []

  return models
    .flatMap((model) => {
      if (typeof model === 'string') {
        return [{ id: model, name: model }]
      }
      if (!model || typeof model !== 'object') {
        return []
      }

      const item = model as Record<string, unknown>
      const id = toStringValue(item.id ?? item.name ?? item.model)
      if (!id) return []
      return [
        {
          id,
          name: toStringValue(item.name) || id,
          group: toStringValue(item.group) || 'custom'
        }
      ]
    })
    .filter((model, index, list) => list.findIndex((item) => item.id === model.id) === index)
}

const buildUnixDisplayPath = (relativePath: string): string => `~/${relativePath}`

const buildWindowsDisplayPath = (base: '%APPDATA%' | '%USERPROFILE%', relativePath: string) =>
  `${base}\\${relativePath.replaceAll('/', '\\')}`

const isSupportedScanPlatform = (
  platform: NodeJS.Platform
): platform is 'darwin' | 'linux' | 'win32' =>
  platform === 'darwin' || platform === 'linux' || platform === 'win32'

type ResolvedSourcePath = {
  sourcePath: string
  displayPath: string
}

type ProviderImportServiceOptions = {
  homeDir?: string
  platform?: NodeJS.Platform
  appDataDir?: string
}

export class ProviderImportService {
  private sessions = new Map<string, ScanSession>()
  private readonly homeDir: string
  private readonly platform: NodeJS.Platform
  private readonly appDataDir: string

  constructor(
    private readonly configPresenter: IConfigPresenter,
    options: ProviderImportServiceOptions = {}
  ) {
    this.homeDir = options.homeDir ?? os.homedir()
    this.platform = options.platform ?? process.platform
    this.appDataDir =
      options.appDataDir ?? process.env.APPDATA ?? path.join(this.homeDir, 'AppData', 'Roaming')
  }

  async scan(): Promise<ProviderImportScanResult> {
    this.pruneSessions()

    if (!isSupportedScanPlatform(this.platform)) {
      const sources = SOURCE_DEFINITIONS.map((definition) => ({
        id: definition.id,
        name: definition.name,
        status: 'unsupported_platform' as const,
        configPath: buildUnixDisplayPath(definition.unixRelativePath),
        providerCount: 0,
        selectable: false,
        defaultSelected: false
      }))
      const session = this.createSession(sources, [])
      return this.toPublicSession(session)
    }

    const results = await Promise.all(
      SOURCE_DEFINITIONS.map((definition) => this.readSource(definition))
    )
    const sources = results.map((result) => result.source)
    const rawProviders = results.flatMap((result) => result.providers)
    const providers = rawProviders.map((provider) => this.toPreview(provider))
    const session = this.createSession(sources, rawProviders, providers)
    return this.toPublicSession(session)
  }

  apply(selections: {
    sessionId: string
    selections: ProviderImportSelection[]
  }): ProviderImportApplyResult {
    this.pruneSessions()

    const session = this.sessions.get(selections.sessionId)
    if (!session) {
      return {
        summary: {
          imported: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          overwritten: 0,
          models: 0
        },
        results: []
      }
    }

    const selectedBySource = new Map<ProviderImportSourceId, Set<string>>(
      selections.selections.map((selection) => [selection.sourceId, new Set(selection.providerIds)])
    )
    const optionsByProviderId = new Map<string, ProviderImportProviderOptions>()
    for (const selection of selections.selections) {
      for (const [providerId, options] of Object.entries(selection.providerOptions ?? {})) {
        optionsByProviderId.set(providerId, options)
      }
    }
    const selectedProviders = PROVIDER_IMPORT_SOURCE_IDS.flatMap((sourceId) => {
      const selectedIds = selectedBySource.get(sourceId)
      if (!selectedIds || selectedIds.size === 0) return []
      return session.rawProviders.filter(
        (provider) => provider.sourceId === sourceId && selectedIds.has(provider.id)
      )
    })

    const plannedByTarget = new Map<string, ProviderImportPlannedProvider>()
    const resultByProviderId = new Map<string, ProviderImportApplyResultItem>()
    const reservedProviderIds = new Set(
      this.configPresenter.getProviders().map((provider) => provider.id)
    )
    const plannedCustomFingerprints = new Map<string, string>()
    for (const rawProvider of selectedProviders) {
      const mapping = this.mapProvider(rawProvider, optionsByProviderId.get(rawProvider.id))
      if (
        mapping.targetKind === 'unsupported' ||
        !this.hasRequiredCredentials(rawProvider, mapping)
      ) {
        resultByProviderId.set(rawProvider.id, this.buildResult(rawProvider, mapping, 'skipped'))
        continue
      }

      const planned = this.planProvider(
        rawProvider,
        mapping,
        reservedProviderIds,
        plannedCustomFingerprints
      )
      const targetKey = `${mapping.targetKind}:${planned.targetProviderId}`
      const previous = plannedByTarget.get(targetKey)
      if (previous) {
        resultByProviderId.set(
          previous.raw.id,
          this.buildResult(previous.raw, previous.mapping, 'overwritten', previous)
        )
      }
      plannedByTarget.set(targetKey, planned)
      resultByProviderId.set(
        rawProvider.id,
        this.buildResult(rawProvider, mapping, 'skipped', planned)
      )
    }

    const plannedProviders = Array.from(plannedByTarget.values())
    const appliedResults = this.applyPlannedProviders(plannedProviders)
    for (const result of appliedResults) {
      resultByProviderId.set(result.id, result)
    }

    const orderedResults = selectedProviders
      .map((provider) => resultByProviderId.get(provider.id))
      .filter((result): result is ProviderImportApplyResultItem => Boolean(result))
    const summary = orderedResults.reduce(
      (acc, result) => {
        if (result.status === 'created') acc.created += 1
        if (result.status === 'updated') acc.updated += 1
        if (result.status === 'skipped') acc.skipped += 1
        if (result.status === 'overwritten') acc.overwritten += 1
        if (result.status === 'created' || result.status === 'updated') {
          acc.imported += 1
          acc.models += result.modelCount
        }
        return acc
      },
      {
        imported: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        overwritten: 0,
        models: 0
      }
    )

    this.sessions.delete(selections.sessionId)
    return {
      summary,
      results: orderedResults
    }
  }

  private createSession(
    sources: ProviderImportSourceScan[],
    rawProviders: ProviderImportRawProvider[],
    providers = rawProviders.map((provider) => this.toPreview(provider))
  ): ScanSession {
    const session: ScanSession = {
      sessionId: nanoid(),
      sourceOrder: [...PROVIDER_IMPORT_SOURCE_IDS],
      sources,
      providers,
      rawProviders,
      createdAt: Date.now()
    }
    this.sessions.set(session.sessionId, session)
    return session
  }

  private toPublicSession(session: ScanSession): ProviderImportScanResult {
    return {
      sessionId: session.sessionId,
      sourceOrder: session.sourceOrder,
      sources: session.sources,
      providers: session.providers
    }
  }

  private pruneSessions(): void {
    const now = Date.now()
    for (const [sessionId, session] of this.sessions) {
      if (now - session.createdAt > SCAN_SESSION_TTL_MS) {
        this.sessions.delete(sessionId)
      }
    }
  }

  private async readSource(definition: SourceDefinition): Promise<SourceReadResult> {
    const { sourcePath, displayPath: configPath } = this.resolveSourcePath(definition)
    if (!fs.existsSync(sourcePath)) {
      return {
        source: {
          id: definition.id,
          name: definition.name,
          status: 'not_found',
          configPath,
          providerCount: 0,
          selectable: false,
          defaultSelected: false
        },
        providers: []
      }
    }

    try {
      const providers = await this.readProviders(definition, sourcePath)
      const previews = providers.map((provider) => this.toPreview(provider))
      return {
        source: {
          id: definition.id,
          name: definition.name,
          status: 'found',
          configPath,
          providerCount: providers.length,
          selectable: previews.some((provider) => provider.selectable),
          defaultSelected: previews.some((provider) => provider.defaultSelected)
        },
        providers
      }
    } catch (error) {
      console.warn('[ProviderImport] Failed reading source', definition.id, error)
      return {
        source: {
          id: definition.id,
          name: definition.name,
          status: 'error',
          configPath,
          providerCount: 0,
          selectable: false,
          defaultSelected: false,
          message: 'Failed to read provider config'
        },
        providers: []
      }
    }
  }

  private async readProviders(
    definition: SourceDefinition,
    sourcePath: string
  ): Promise<ProviderImportRawProvider[]> {
    switch (definition.id) {
      case 'alma':
        return this.readAlma(definition, sourcePath)
      case 'cherry-studio':
        return await this.readCherryStudio(definition, sourcePath)
      case 'hermes':
        return this.readHermes(definition, sourcePath)
      case 'openclaw':
        return this.readOpenClaw(definition, sourcePath)
    }
  }

  private readAlma(definition: SourceDefinition, dbPath: string): ProviderImportRawProvider[] {
    const db = new Database(dbPath, {
      readonly: true,
      fileMustExist: true
    })
    try {
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'providers'")
        .get()
      if (!table) return []

      const rows = db
        .prepare(
          [
            'SELECT id, name, type, api_key, base_url, api_format, enabled, models, available_models',
            'FROM providers',
            "WHERE type != 'acp'"
          ].join(' ')
        )
        .all() as Record<string, unknown>[]

      return rows.flatMap((row, index) => {
        const apiKey = toStringValue(row.api_key)
        const type = toStringValue(row.type)
        const apiFormat = toStringValue(row.api_format)
        const sourceProviderId = toStringValue(row.id) || `provider-${index + 1}`
        const models = normalizeModels(safeJsonParse(row.models))
        const availableModels = normalizeModels(safeJsonParse(row.available_models))
        return [
          {
            id: `${definition.id}:${sourceProviderId}`,
            sourceId: definition.id,
            sourceName: definition.name,
            sourceProviderId,
            name: toStringValue(row.name) || sourceProviderId,
            type,
            apiFormat,
            apiKey,
            baseUrl: toStringValue(row.base_url),
            enabled: toBooleanValue(row.enabled, true),
            models: models.length > 0 ? models : availableModels
          }
        ]
      })
    } finally {
      db.close()
    }
  }

  private async readCherryStudio(
    definition: SourceDefinition,
    dbPath: string
  ): Promise<ProviderImportRawProvider[]> {
    const { Level } = await import('level')
    const snapshotPath = this.createLevelDbSnapshot(dbPath)
    const db = new Level(snapshotPath ?? dbPath, {
      keyEncoding: 'buffer',
      valueEncoding: 'buffer',
      createIfMissing: false
    } as any)

    try {
      await db.open()
      for await (const [key, value] of db.iterator() as AsyncIterable<[Buffer, Buffer]>) {
        const keyText = Buffer.isBuffer(key) ? key.toString('utf8') : String(key)
        if (!keyText.includes('persist:cherry-studio')) {
          continue
        }

        const root = this.parseCherryPersistedValue(value)
        const llm = root && typeof root === 'object' ? safeJsonParse((root as any).llm) : null
        const providers = llm && typeof llm === 'object' ? (llm as any).providers : null
        if (!Array.isArray(providers)) {
          return []
        }

        return providers.flatMap((provider, index) => {
          if (!provider || typeof provider !== 'object') return []
          const item = provider as Record<string, unknown>
          const apiKey = toStringValue(item.apiKey)
          const type = toStringValue(item.type || item.id)
          const sourceProviderId = toStringValue(item.id) || `provider-${index + 1}`
          return [
            {
              id: `${definition.id}:${sourceProviderId}`,
              sourceId: definition.id,
              sourceName: definition.name,
              sourceProviderId,
              name: toStringValue(item.name) || sourceProviderId,
              type,
              apiKey,
              baseUrl: toStringValue(item.apiHost || item.baseUrl),
              enabled: toBooleanValue(item.enabled, false),
              models: normalizeModels(item.models)
            }
          ]
        })
      }

      return []
    } finally {
      try {
        await db.close()
      } catch {
        // Keep the original read error when open or iteration fails.
      }
      if (snapshotPath) {
        fs.rmSync(snapshotPath, { recursive: true, force: true })
      }
    }
  }

  private createLevelDbSnapshot(dbPath: string): string | null {
    const snapshotPath = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-cherry-import-'))
    try {
      fs.cpSync(dbPath, snapshotPath, {
        recursive: true,
        filter: (sourcePath) => path.basename(sourcePath) !== 'LOCK'
      })
      return snapshotPath
    } catch (error) {
      fs.rmSync(snapshotPath, { recursive: true, force: true })
      console.warn('[ProviderImport] Failed to create Cherry Studio LevelDB snapshot:', error)
      return null
    }
  }

  private parseCherryPersistedValue(value: Buffer): Record<string, unknown> | null {
    const cleanBytes: number[] = []
    for (const byte of value) {
      if (byte !== 0) {
        cleanBytes.push(byte)
      }
    }

    const text = replaceDisallowedControlCharacters(Buffer.from(cleanBytes).toString('utf8'))
    const parsed = safeJsonParse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  }

  private readHermes(
    definition: SourceDefinition,
    configPath: string
  ): ProviderImportRawProvider[] {
    const config = parseYaml(fs.readFileSync(configPath, 'utf8'))
    const providers = config?.llm?.providers
    return this.readYamlProviders(definition, Array.isArray(providers) ? providers : [])
  }

  private readOpenClaw(
    definition: SourceDefinition,
    configPath: string
  ): ProviderImportRawProvider[] {
    const config = parseYaml(fs.readFileSync(configPath, 'utf8'))
    const providers = config?.providers
    return this.readYamlProviders(definition, Array.isArray(providers) ? providers : [])
  }

  private readYamlProviders(
    definition: SourceDefinition,
    providers: unknown[]
  ): ProviderImportRawProvider[] {
    return providers.flatMap((provider, index) => {
      if (!provider || typeof provider !== 'object') return []
      const item = provider as Record<string, unknown>
      const apiKey = toStringValue(item.apiKey || item.api_key)
      const type = toStringValue(item.type)
      const sourceProviderId = toStringValue(item.id) || `provider-${index + 1}`
      return [
        {
          id: `${definition.id}:${sourceProviderId}`,
          sourceId: definition.id,
          sourceName: definition.name,
          sourceProviderId,
          name: toStringValue(item.name) || sourceProviderId,
          type,
          apiKey,
          baseUrl: toStringValue(item.apiHost || item.baseUrl || item.base_url),
          enabled: toBooleanValue(item.enabled, true),
          models: normalizeModels(item.models)
        }
      ]
    })
  }

  private toPreview(rawProvider: ProviderImportRawProvider): ProviderImportProviderPreview {
    const mapping = this.mapProvider(rawProvider)
    const configured = this.isConfigured(rawProvider, mapping)
    const hasCredentials = this.hasRequiredCredentials(rawProvider, mapping)
    const selectable =
      mapping.targetKind !== 'unsupported' &&
      (hasCredentials || this.canSelectCustomProviderWithOptions(rawProvider, mapping))
    const warnings = [
      ...(configured ? (['already_configured'] as const) : []),
      ...(!hasCredentials && mapping.targetKind !== 'unsupported'
        ? (['missing_api_key'] as const)
        : []),
      ...(mapping.targetKind === 'unsupported' ? (['unsupported_provider'] as const) : [])
    ]

    return {
      id: rawProvider.id,
      sourceId: rawProvider.sourceId,
      sourceName: rawProvider.sourceName,
      sourceProviderId: rawProvider.sourceProviderId,
      name: rawProvider.name,
      sourceType: rawProvider.apiFormat || rawProvider.type,
      targetKind: mapping.targetKind,
      targetProviderId: mapping.targetProviderId,
      targetProviderName: mapping.targetProviderName,
      targetApiType: mapping.targetApiType,
      apiKeyMasked: maskApiKey(rawProvider.apiKey),
      baseUrl: rawProvider.baseUrl,
      modelCount: rawProvider.models.length,
      modelPreview: rawProvider.models.slice(0, 3).map((model) => model.name || model.id),
      configured,
      selectable,
      defaultSelected: hasCredentials && !configured,
      warnings
    }
  }

  private mapProvider(
    rawProvider: ProviderImportRawProvider,
    options?: ProviderImportProviderOptions
  ): ProviderImportMapping {
    const providers = this.configPresenter.getProviders()
    const providerById = new Map(providers.map((provider) => [provider.id.toLowerCase(), provider]))
    const sourceId = normalizeToken(rawProvider.sourceProviderId)
    const sourceName = normalizeName(rawProvider.name)
    const sourceType = normalizeToken(rawProvider.apiFormat || rawProvider.type)
    const baseUrl = rawProvider.baseUrl.toLowerCase()

    const providerId =
      (baseUrl.includes('ppinfra.com') ? 'ppio' : '') ||
      (providerById.has(sourceId) ? sourceId : '') ||
      API_TYPE_ALIASES[sourceId] ||
      API_TYPE_ALIASES[sourceType] ||
      (providerById.has(sourceName) ? sourceName : '')

    if (providerId && providerById.has(providerId)) {
      const target = providerById.get(providerId)!
      return {
        targetKind: 'builtin',
        targetProviderId: target.id,
        targetProviderName: target.name,
        targetApiType: target.apiType
      }
    }

    if (
      (sourceType === 'openai' ||
        sourceType === 'openai-chat' ||
        sourceType === 'openai-compatible') &&
      (isOpenAIName(rawProvider.sourceProviderId) || isOpenAIName(rawProvider.name))
    ) {
      const target = providerById.get('openai')
      if (target) {
        return {
          targetKind: 'builtin',
          targetProviderId: target.id,
          targetProviderName: target.name,
          targetApiType: target.apiType
        }
      }
    }

    if (OPENAI_COMPATIBLE_TYPES.has(sourceType)) {
      return {
        targetKind: 'custom',
        targetProviderId: this.buildCustomProviderBaseId(rawProvider),
        targetProviderName: rawProvider.name,
        targetApiType: this.resolveCustomApiType(options?.targetApiType)
      }
    }

    if (rawProvider.apiKey.trim() && hasHttpBaseUrl(rawProvider.baseUrl)) {
      return {
        targetKind: 'custom',
        targetProviderId: this.buildCustomProviderBaseId(rawProvider),
        targetProviderName: rawProvider.name,
        targetApiType: this.resolveCustomApiType(options?.targetApiType)
      }
    }

    return {
      targetKind: 'unsupported',
      targetProviderId: '',
      targetProviderName: rawProvider.name,
      targetApiType: ''
    }
  }

  private resolveCustomApiType(value?: string): ProviderImportCustomApiType {
    return PROVIDER_IMPORT_CUSTOM_API_TYPES.includes(value as ProviderImportCustomApiType)
      ? (value as ProviderImportCustomApiType)
      : 'openai-completions'
  }

  private canSelectCustomProviderWithOptions(
    rawProvider: ProviderImportRawProvider,
    mapping: ProviderImportMapping
  ): boolean {
    return mapping.targetKind === 'custom' && Boolean(rawProvider.baseUrl.trim())
  }

  private hasRequiredCredentials(
    rawProvider: ProviderImportRawProvider,
    mapping: ProviderImportMapping
  ): boolean {
    if (mapping.targetKind === 'unsupported') {
      return false
    }

    if (mapping.targetKind === 'custom') {
      if (mapping.targetApiType === 'ollama') {
        return Boolean(rawProvider.baseUrl.trim())
      }

      return Boolean(rawProvider.apiKey.trim()) && hasHttpBaseUrl(rawProvider.baseUrl)
    }

    if (mapping.targetApiType === 'ollama') {
      return Boolean(rawProvider.baseUrl.trim())
    }

    return Boolean(rawProvider.apiKey.trim())
  }

  private isConfigured(
    rawProvider: ProviderImportRawProvider,
    mapping: ProviderImportMapping
  ): boolean {
    const providers = this.configPresenter.getProviders()
    if (mapping.targetKind === 'builtin') {
      const current = providers.find((provider) => provider.id === mapping.targetProviderId)
      const defaultProvider = this.configPresenter
        .getDefaultProviders()
        .find((provider) => provider.id === mapping.targetProviderId)
      return Boolean(
        current &&
        (current.apiKey?.trim() ||
          current.oauthToken?.trim() ||
          current.copilotClientId?.trim() ||
          (current as LLM_PROVIDER & { credential?: unknown }).credential ||
          normalizeUrl(current.baseUrl) !== normalizeUrl(defaultProvider?.baseUrl))
      )
    }

    if (mapping.targetKind === 'custom') {
      const fingerprint = this.getFingerprint(rawProvider.baseUrl, rawProvider.apiKey)
      return providers.some(
        (provider) =>
          provider.custom &&
          fingerprint &&
          this.getFingerprint(provider.baseUrl, provider.apiKey) === fingerprint
      )
    }

    return false
  }

  private getFingerprint(baseUrl: string | undefined, apiKey: string | undefined): string {
    const normalizedBaseUrl = normalizeUrl(baseUrl)
    const normalizedKey = (apiKey ?? '').trim()
    return normalizedBaseUrl && normalizedKey ? `${normalizedBaseUrl}::${normalizedKey}` : ''
  }

  private buildCustomProviderBaseId(rawProvider: ProviderImportRawProvider): string {
    const rawId = normalizeToken(rawProvider.sourceProviderId || rawProvider.name).replace(
      /[^a-z0-9-]/g,
      '-'
    )
    return `${SOURCE_PREFIX[rawProvider.sourceId]}_${rawId || 'provider'}`
  }

  private buildUniqueProviderId(baseId: string, existingIds: Set<string>): string {
    if (!existingIds.has(baseId)) {
      return baseId
    }

    let index = 2
    while (existingIds.has(`${baseId}-${index}`)) {
      index += 1
    }
    return `${baseId}-${index}`
  }

  private planProvider(
    rawProvider: ProviderImportRawProvider,
    mapping = this.mapProvider(rawProvider),
    reservedProviderIds = new Set(
      this.configPresenter.getProviders().map((provider) => provider.id)
    ),
    plannedCustomFingerprints = new Map<string, string>()
  ): ProviderImportPlannedProvider {
    const providers = this.configPresenter.getProviders()
    const targetProviderId =
      mapping.targetKind === 'custom'
        ? this.resolveCustomProviderId(
            rawProvider,
            mapping,
            providers,
            reservedProviderIds,
            plannedCustomFingerprints
          )
        : mapping.targetProviderId
    const current = providers.find((provider) => provider.id === targetProviderId)
    const provider: LLM_PROVIDER = current
      ? {
          ...current,
          ...(mapping.targetKind === 'custom'
            ? {
                name: rawProvider.name,
                apiType: mapping.targetApiType,
                custom: true
              }
            : {}),
          apiKey: rawProvider.apiKey,
          baseUrl: rawProvider.baseUrl || current.baseUrl,
          enable: true
        }
      : {
          id: targetProviderId,
          name: rawProvider.name,
          apiType: mapping.targetApiType,
          apiKey: rawProvider.apiKey,
          baseUrl: rawProvider.baseUrl,
          enable: true,
          custom: true
        }

    return {
      raw: rawProvider,
      mapping,
      targetProviderId,
      provider,
      models: this.buildModelMeta(targetProviderId, rawProvider.models)
    }
  }

  private resolveCustomProviderId(
    rawProvider: ProviderImportRawProvider,
    mapping: ProviderImportMapping,
    providers: LLM_PROVIDER[],
    reservedProviderIds: Set<string>,
    plannedCustomFingerprints: Map<string, string>
  ): string {
    const fingerprint = this.getFingerprint(rawProvider.baseUrl, rawProvider.apiKey)
    const existingByFingerprint = providers.find(
      (provider) =>
        provider.custom &&
        fingerprint &&
        this.getFingerprint(provider.baseUrl, provider.apiKey) === fingerprint
    )
    if (existingByFingerprint) {
      return existingByFingerprint.id
    }

    const plannedByFingerprint = plannedCustomFingerprints.get(fingerprint)
    if (plannedByFingerprint) {
      return plannedByFingerprint
    }

    const providerId = this.buildUniqueProviderId(mapping.targetProviderId, reservedProviderIds)
    reservedProviderIds.add(providerId)
    if (fingerprint) {
      plannedCustomFingerprints.set(fingerprint, providerId)
    }
    return providerId
  }

  private buildModelMeta(providerId: string, models: ProviderImportRawModel[]): MODEL_META[] {
    return uniqueStrings(models.map((model) => model.id)).map((modelId) => {
      const sourceModel = models.find((model) => model.id === modelId)
      return {
        id: modelId,
        name: sourceModel?.name || modelId,
        group: sourceModel?.group || 'custom',
        providerId,
        isCustom: true,
        enabled: true,
        vision: false,
        functionCall: false,
        reasoning: false,
        type: ModelType.Chat
      }
    })
  }

  private applyPlannedProviders(
    plannedProviders: ProviderImportPlannedProvider[]
  ): ProviderImportApplyResultItem[] {
    if (plannedProviders.length === 0) {
      return []
    }

    const currentProviders = this.configPresenter.getProviders()
    const providerIndex = new Map(currentProviders.map((provider, index) => [provider.id, index]))
    const nextProviders = [...currentProviders]
    const changes: ProviderChange[] = []
    const results: ProviderImportApplyResultItem[] = []

    for (const planned of plannedProviders) {
      const existingIndex = providerIndex.get(planned.targetProviderId)
      if (existingIndex === undefined) {
        providerIndex.set(planned.targetProviderId, nextProviders.length)
        nextProviders.push(planned.provider)
        changes.push({
          operation: 'add',
          providerId: planned.targetProviderId,
          requiresRebuild: true,
          provider: planned.provider
        })
        results.push(this.buildResult(planned.raw, planned.mapping, 'created', planned))
      } else {
        nextProviders[existingIndex] = planned.provider
        changes.push({
          operation: 'update',
          providerId: planned.targetProviderId,
          requiresRebuild: true,
          updates: {
            apiKey: planned.provider.apiKey,
            apiType: planned.provider.apiType,
            baseUrl: planned.provider.baseUrl,
            enable: planned.provider.enable,
            ...(planned.provider.custom ? { name: planned.provider.name } : {})
          }
        })
        results.push(this.buildResult(planned.raw, planned.mapping, 'updated', planned))
      }
    }

    if (changes.length > 0) {
      this.configPresenter.updateProvidersBatch({
        changes,
        providers: nextProviders
      })
    }

    for (const planned of plannedProviders) {
      for (const model of planned.models) {
        this.configPresenter.addCustomModel(planned.targetProviderId, model)
      }
    }

    return results
  }

  private buildResult(
    rawProvider: ProviderImportRawProvider,
    mapping: ProviderImportMapping,
    status: ProviderImportApplyResultItem['status'],
    planned?: ProviderImportPlannedProvider
  ): ProviderImportApplyResultItem {
    const targetProviderId = planned?.targetProviderId ?? mapping.targetProviderId
    return {
      id: rawProvider.id,
      sourceId: rawProvider.sourceId,
      sourceName: rawProvider.sourceName,
      sourceProviderId: rawProvider.sourceProviderId,
      name: rawProvider.name,
      targetKind: mapping.targetKind,
      targetProviderId,
      targetProviderName:
        mapping.targetKind === 'custom' ? rawProvider.name : mapping.targetProviderName,
      status,
      modelCount: status === 'created' || status === 'updated' ? rawProvider.models.length : 0
    }
  }

  private resolveSourcePath(definition: SourceDefinition): ResolvedSourcePath {
    if (this.platform === 'win32') {
      const basePath = definition.windowsBase === 'appData' ? this.appDataDir : this.homeDir
      const displayBase = definition.windowsBase === 'appData' ? '%APPDATA%' : '%USERPROFILE%'
      return {
        sourcePath: path.join(basePath, definition.windowsRelativePath),
        displayPath: buildWindowsDisplayPath(displayBase, definition.windowsRelativePath)
      }
    }

    return {
      sourcePath: path.join(this.homeDir, definition.unixRelativePath),
      displayPath: buildUnixDisplayPath(definition.unixRelativePath)
    }
  }
}
