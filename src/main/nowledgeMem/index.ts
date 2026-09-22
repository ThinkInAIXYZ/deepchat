import { createHash, randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { SettingsStore } from '@/config/settingsStore'
import type { SecretStore } from '@/config/secretStore'
import type { McpSettings } from '@/mcp/settings'
import type { MCPServerConfig } from '@shared/types/mcp'
import {
  NOWLEDGE_PLUGIN_ID,
  NowledgeConnectionInputSchema,
  type NowledgeConnection,
  type NowledgeConnectionInput,
  type NowledgePluginState,
  isNowledgeMachineLocalSetting
} from '@shared/types/nowledgeMemPlugin'
import { memHeaders, type NowledgeMemConfig } from '@/exporter/nowledgeMemClient'

const SETTINGS_KEY = 'nowledgeMemPlugin'
const KEY_VARIABLE = 'NOWLEDGE_MEM_API_KEY'
type StoredConnection = Omit<NowledgeConnection, 'hasApiKey'> & { credentialId?: string }
type StoredState = {
  connection: StoredConnection | null
  credentials?: Record<string, string>
}

export function normalizeMemUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid Nowledge Mem server URL')
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Use an HTTP or HTTPS URL without credentials or query parameters')
  return url.toString().replace(/\/+$/, '')
}

export function resolveMemEndpoints(
  input: Pick<NowledgeConnectionInput, 'baseUrl' | 'apiBaseUrl' | 'mcpUrl'>
) {
  const baseUrl = normalizeMemUrl(input.baseUrl)
  const apiBaseUrl = normalizeMemUrl(input.apiBaseUrl || baseUrl.replace(/\/mcp$/, ''))
  const mcpUrl = normalizeMemUrl(input.mcpUrl || `${apiBaseUrl}/mcp`) + '/'
  if ([apiBaseUrl, mcpUrl].some((value) => new URL(value).origin !== new URL(baseUrl).origin)) {
    throw new Error('API and MCP must belong to the selected server origin')
  }
  return { baseUrl, apiBaseUrl, mcpUrl }
}

class MemHttpError extends Error {
  constructor(
    readonly status: number,
    stage: string
  ) {
    super(`${stage}: HTTP ${status}`)
  }
}

export class NowledgeMemConnections {
  private busy = false

  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets: Pick<SecretStore, 'get' | 'wrap' | 'setWrapped' | 'restoreWrapped'>,
    private readonly mcpSettings: Pick<McpSettings, 'getMcpServers'>
  ) {}

  private read(): StoredState {
    const state = this.settings.get<
      Partial<StoredState> & {
        connections?: Partial<Record<'local' | 'remote', StoredConnection>>
        exportProfile?: 'local' | 'remote' | null
      }
    >(SETTINGS_KEY)
    if (!state) return { connection: null }
    if ('connection' in state)
      return { connection: state.connection ?? null, credentials: state.credentials }
    // Retain the selected destination and all destination-bound credentials from profile settings.
    return {
      connection:
        state.connections?.[state.exportProfile ?? 'local'] ??
        state.connections?.remote ??
        state.connections?.local ??
        null,
      credentials: state.credentials
    }
  }

  private key(connection: StoredConnection): string {
    const key = connection.credentialId ? this.secrets.get(connection.credentialId) : ''
    if (connection.credentialId && !key)
      throw new Error('The saved credential is unavailable; enter it again')
    return key
  }

  private credentialId(endpoints: { apiBaseUrl: string; mcpUrl: string }): string {
    return `nowledgeMem.credentials.${createHash('sha256')
      .update(JSON.stringify([endpoints.apiBaseUrl, endpoints.mcpUrl]))
      .digest('hex')}`
  }

  async getState(): Promise<NowledgePluginState> {
    const state = this.read()
    return {
      connection: state.connection
        ? {
            baseUrl: state.connection.baseUrl,
            apiBaseUrl: state.connection.apiBaseUrl,
            mcpUrl: state.connection.mcpUrl,
            timeout: state.connection.timeout,
            verifiedAt: state.connection.verifiedAt,
            hasApiKey: Boolean(state.connection.credentialId)
          }
        : null,
      legacy: (await this.legacyConnections()).map(({ apiKey, ...connection }) => ({
        ...connection,
        hasApiKey: Boolean(apiKey)
      }))
    }
  }

  private async legacyConnections() {
    const result: Array<{
      source: 'export' | 'mcp'
      baseUrl: string
      apiBaseUrl: string
      mcpUrl: string
      apiKey: string
    }> = []
    const legacy = this.settings.get<NowledgeMemConfig>('nowledgeMemConfig')
    if (legacy?.baseUrl) {
      try {
        const base = normalizeMemUrl(legacy.baseUrl)
        result.push({
          source: 'export',
          baseUrl: base,
          apiBaseUrl: base,
          mcpUrl: `${base}/mcp/`,
          apiKey: legacy.apiKey ?? ''
        })
      } catch {
        /* Keep invalid legacy settings intact for manual recovery. */
      }
    }
    const mcp = (await this.mcpSettings.getMcpServers())['nowledge-mem']
    if (mcp?.baseUrl && !mcp.ownerPluginId) {
      try {
        const mcpUrl = normalizeMemUrl(mcp.baseUrl) + '/'
        const base = mcpUrl.replace(/\/mcp\/$/, '')
        const headers = Object.fromEntries(
          Object.entries(mcp.customHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v])
        )
        const key =
          headers['x-nmem-api-key'] || headers.authorization?.replace(/^Bearer\s+/i, '') || ''
        result.push({
          source: 'mcp',
          baseUrl: base,
          apiBaseUrl: base,
          mcpUrl,
          apiKey: key.includes('${') ? '' : key
        })
      } catch {
        /* Legacy MCP entries remain user-owned. */
      }
    }
    return result
  }

  getExportConfig(): NowledgeMemConfig {
    const state = this.read()
    const connection = state.connection
    if (!connection) throw new Error('Verify a connection in the Nowledge Mem plugin')
    return {
      baseUrl: connection.apiBaseUrl,
      apiKey: this.key(connection),
      timeout: connection.timeout
    }
  }

  getPublicExportConfig(): NowledgeMemConfig {
    const state = this.read()
    const connection = state.connection
    return {
      baseUrl: connection ? connection.apiBaseUrl : 'http://127.0.0.1:14242',
      timeout: connection ? connection.timeout : 30000
    }
  }

  clear(): void {
    if (this.busy) throw new Error('A connection update is in progress')
    for (const key of Object.keys(this.settings.store)) {
      if (isNowledgeMachineLocalSetting(key)) this.settings.delete(key)
    }
  }

  getMcpConnection(): Partial<MCPServerConfig> | undefined {
    const connection = this.read().connection
    if (!connection) return undefined
    return {
      baseUrl: connection.mcpUrl,
      customHeaders: memHeaders(connection.credentialId ? `\${${KEY_VARIABLE}}` : ''),
      environmentVariables: connection.credentialId ? [KEY_VARIABLE] : []
    }
  }

  getMcpBindings(config: Partial<MCPServerConfig>): Record<string, string> {
    if (config.ownerPluginId !== NOWLEDGE_PLUGIN_ID) return {}
    const connection = this.read().connection
    if (
      connection &&
      config.baseUrl === connection.mcpUrl &&
      config.sourceId === NOWLEDGE_PLUGIN_ID
    ) {
      return { [KEY_VARIABLE]: this.key(connection) }
    }
    throw new Error('The Nowledge MCP destination no longer matches its saved connection')
  }

  async save(rawInput: unknown): Promise<NowledgePluginState> {
    const input = NowledgeConnectionInputSchema.parse(rawInput)
    if (this.busy) throw new Error('A connection update is in progress')
    this.busy = true
    try {
      let endpoints = resolveMemEndpoints(input)
      const state = this.read()
      const previous = state.connection
      if (
        previous &&
        (previous.apiBaseUrl !== endpoints.apiBaseUrl || previous.mcpUrl !== endpoints.mcpUrl) &&
        !input.replace
      ) {
        throw new Error(
          'Confirm replacing this connection; its previous credentials will be retained'
        )
      }
      let apiKey = input.apiKey?.trim() || ''
      if (input.legacySource) {
        const legacy = (await this.legacyConnections()).find((c) => c.source === input.legacySource)
        if (
          !legacy ||
          legacy.apiBaseUrl !== endpoints.apiBaseUrl ||
          legacy.mcpUrl !== endpoints.mcpUrl
        ) {
          throw new Error('The selected legacy connection changed; reload it before importing')
        }
        apiKey ||= legacy.apiKey
      }
      // Reuse only credentials bound to these exact destinations, never ambient nmem settings.
      const suppliedKey = apiKey
      const savedCredential = state.credentials?.[this.credentialId(endpoints)]
      apiKey ||= savedCredential ? this.secrets.get(savedCredential) : ''
      try {
        await this.verify(endpoints, apiKey, input.timeout)
      } catch (error) {
        if (
          !(error instanceof MemHttpError) ||
          error.status !== 404 ||
          input.apiBaseUrl ||
          input.mcpUrl ||
          new URL(endpoints.apiBaseUrl).pathname !== '/'
        )
          throw error
        endpoints = resolveMemEndpoints({ ...input, apiBaseUrl: `${endpoints.baseUrl}/remote-api` })
        if (!suppliedKey) {
          const resolvedCredential = state.credentials?.[this.credentialId(endpoints)]
          apiKey = resolvedCredential ? this.secrets.get(resolvedCredential) : ''
          if (!apiKey && savedCredential)
            throw new Error('Enter a credential for the resolved API and MCP destinations')
        }
        await this.verify(endpoints, apiKey, input.timeout)
      }
      if (
        previous &&
        (previous.apiBaseUrl !== endpoints.apiBaseUrl || previous.mcpUrl !== endpoints.mcpUrl) &&
        !input.replace
      ) {
        throw new Error('Confirm replacing this connection with the resolved endpoints')
      }
      const destinationKey = this.credentialId(endpoints)
      const previousCredentialId = state.credentials?.[destinationKey]
      const reuse = Boolean(
        previousCredentialId && this.secrets.get(previousCredentialId) === apiKey
      )
      const credentialId = apiKey
        ? reuse
          ? previousCredentialId
          : `${destinationKey}.${randomUUID()}`
        : undefined
      if (credentialId && !reuse) this.secrets.setWrapped(credentialId, this.secrets.wrap(apiKey))
      const connection: StoredConnection = {
        ...endpoints,
        timeout: input.timeout,
        verifiedAt: Date.now(),
        ...(credentialId ? { credentialId } : {})
      }
      try {
        this.settings.set(SETTINGS_KEY, {
          connection,
          credentials: {
            ...state.credentials,
            ...(credentialId ? { [destinationKey]: credentialId } : {})
          }
        })
      } catch (error) {
        if (credentialId && !reuse) this.secrets.restoreWrapped(credentialId, undefined)
        throw error
      }
      if (previousCredentialId && previousCredentialId !== credentialId) {
        this.secrets.restoreWrapped(previousCredentialId, undefined)
      }
      if (input.legacySource === 'export') {
        const legacy = this.settings.get<NowledgeMemConfig>('nowledgeMemConfig')
        if (legacy)
          this.settings.set('nowledgeMemConfig', {
            baseUrl: legacy.baseUrl,
            timeout: legacy.timeout
          })
      }
      return await this.getState()
    } finally {
      this.busy = false
    }
  }

  private async readJson(
    url: string,
    apiKey: string,
    timeout: number,
    stage: string
  ): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(url, {
        headers: memHeaders(apiKey),
        redirect: 'error',
        signal: AbortSignal.timeout(timeout)
      })
    } catch {
      throw new Error(`${stage}: connection failed or timed out`)
    }
    if (!response.ok) throw new MemHttpError(response.status, stage)
    try {
      return await response.json()
    } catch {
      throw new Error(`${stage}: expected a JSON response`)
    }
  }

  async verify(
    endpoints: { apiBaseUrl: string; mcpUrl: string },
    apiKey: string,
    timeout: number
  ): Promise<void> {
    await this.readJson(`${endpoints.apiBaseUrl}/health`, apiKey, timeout, 'Health check')
    await this.readJson(
      `${endpoints.apiBaseUrl}/memories?limit=1`,
      apiKey,
      timeout,
      'REST authentication'
    )
    const client = new Client({ name: 'DeepChat', version: '1.0.0' })
    const deadline = AbortSignal.timeout(timeout)
    const transport = new StreamableHTTPClientTransport(new URL(endpoints.mcpUrl), {
      requestInit: { headers: memHeaders(apiKey), redirect: 'error' },
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          redirect: 'error',
          signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline
        })
    })
    try {
      await client.connect(transport, { timeout, signal: deadline })
      const catalog = await client.listTools({}, { timeout, signal: deadline })
      const name = ['read_context_bundle', 'read_working_memory'].find((candidate) =>
        catalog.tools.some((tool) => tool.name === candidate)
      )
      if (!name) throw new Error('Missing context tool')
      const result = await client.callTool(
        { name, arguments: name === 'read_context_bundle' ? { source_app: 'deepchat' } : {} },
        undefined,
        { timeout, signal: deadline }
      )
      if (result.isError) throw new Error('Context tool failed')
    } catch {
      throw new Error(
        'MCP verification failed: check the endpoint, credential and read-context permission'
      )
    } finally {
      await client.close().catch(() => {})
    }
  }
}
