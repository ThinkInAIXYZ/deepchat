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
  type NowledgeProfileId
} from '@shared/types/nowledgeMemPlugin'
import { memHeaders, type NowledgeMemConfig } from '@/exporter/nowledgeMemClient'

const SETTINGS_KEY = 'nowledgeMemPlugin'
const KEY_VARIABLE = 'NOWLEDGE_MEM_API_KEY'
type StoredConnection = Omit<NowledgeConnection, 'hasApiKey'> & { credentialId?: string }
type StoredState = {
  connections: Partial<Record<NowledgeProfileId, StoredConnection>>
  exportProfile: NowledgeProfileId | null
  credentials?: Record<string, string>
}

export function normalizeMemUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid Nowledge Mem server URL')
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Use HTTPS, or HTTP on this computer, without URL credentials or query parameters'
    )
  return url.toString().replace(/\/+$/, '')
}

export function resolveMemEndpoints(
  input: Pick<NowledgeConnectionInput, 'baseUrl' | 'apiBaseUrl' | 'mcpUrl' | 'profile'>
) {
  const baseUrl = normalizeMemUrl(input.baseUrl)
  const apiBaseUrl = normalizeMemUrl(input.apiBaseUrl || baseUrl.replace(/\/mcp$/, ''))
  const mcpUrl = normalizeMemUrl(input.mcpUrl || `${apiBaseUrl}/mcp`) + '/'
  if ([apiBaseUrl, mcpUrl].some((value) => new URL(value).origin !== new URL(baseUrl).origin)) {
    throw new Error('API and MCP must belong to the selected server origin')
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname)
  if (input.profile === 'local' && !local)
    throw new Error('The local connection must use this computer’s loopback address')
  if (input.profile === 'remote' && (local || new URL(baseUrl).protocol !== 'https:')) {
    throw new Error('The remote connection must use a remote HTTPS server')
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
    private readonly secrets: Pick<SecretStore, 'get' | 'wrap' | 'setWrapped'>,
    private readonly mcpSettings: Pick<McpSettings, 'getMcpServers'>
  ) {}

  private read(): StoredState {
    return this.settings.get<StoredState>(SETTINGS_KEY) ?? { connections: {}, exportProfile: null }
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
      exportProfile: state.exportProfile,
      connections: Object.fromEntries(
        Object.entries(state.connections).map(([id, { credentialId, ...connection }]) => [
          id,
          { ...connection, hasApiKey: Boolean(credentialId) }
        ])
      ),
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

  getExportConfig(profile?: NowledgeProfileId): NowledgeMemConfig {
    const state = this.read()
    const selected = profile ?? state.exportProfile
    const connection = selected && state.connections[selected]
    if (!connection)
      throw new Error('Select a verified export connection in the Nowledge Mem plugin')
    return {
      baseUrl: connection.apiBaseUrl,
      apiKey: this.key(connection),
      timeout: connection.timeout
    }
  }

  getPublicExportConfig(): NowledgeMemConfig {
    const state = this.read()
    const connection = state.exportProfile && state.connections[state.exportProfile]
    return {
      baseUrl: connection ? connection.apiBaseUrl : 'http://127.0.0.1:14242',
      timeout: connection ? connection.timeout : 30000
    }
  }

  selectExport(profile: NowledgeProfileId): void {
    if (this.busy) throw new Error('A connection update is in progress')
    const state = this.read()
    if (!state.connections[profile])
      throw new Error('Verify this connection before using it for exports')
    this.settings.set(SETTINGS_KEY, { ...state, exportProfile: profile })
  }

  getMcpConnection(profile: NowledgeProfileId): Partial<MCPServerConfig> | undefined {
    const connection = this.read().connections[profile]
    if (!connection) return undefined
    return {
      baseUrl: connection.mcpUrl,
      customHeaders: memHeaders(connection.credentialId ? `\${${KEY_VARIABLE}}` : ''),
      environmentVariables: connection.credentialId ? [KEY_VARIABLE] : []
    }
  }

  getMcpBindings(config: Partial<MCPServerConfig>): Record<string, string> {
    if (config.ownerPluginId !== NOWLEDGE_PLUGIN_ID) return {}
    for (const profile of ['local', 'remote'] as const) {
      const connection = this.read().connections[profile]
      if (
        connection &&
        config.baseUrl === connection.mcpUrl &&
        config.sourceId === NOWLEDGE_PLUGIN_ID
      ) {
        return { [KEY_VARIABLE]: this.key(connection) }
      }
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
      const previous = state.connections[input.profile]
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
      if (input.connectLink?.trim()) {
        if (apiKey) throw new Error('Use an API key or a connect link, not both')
        apiKey = await this.redeem(input.connectLink.trim(), endpoints.baseUrl, input.timeout)
      }
      // Reuse only credentials bound to these exact destinations, never ambient nmem settings.
      const suppliedKey = apiKey
      const savedCredential = state.credentials?.[this.credentialId(endpoints)]
      apiKey ||= savedCredential ? this.secrets.get(savedCredential) : ''
      if (input.profile === 'remote' && !apiKey)
        throw new Error('Enter an API key or a one-time connect link for this server')
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
        if (!suppliedKey && savedCredential) {
          const resolvedCredential = state.credentials?.[this.credentialId(endpoints)]
          apiKey = resolvedCredential ? this.secrets.get(resolvedCredential) : ''
          if (!apiKey)
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
      const credentialId = apiKey ? `${this.credentialId(endpoints)}.${randomUUID()}` : undefined
      if (credentialId) this.secrets.setWrapped(credentialId, this.secrets.wrap(apiKey))
      const connection: StoredConnection = {
        ...endpoints,
        profile: input.profile,
        timeout: input.timeout,
        verifiedAt: Date.now(),
        ...(credentialId ? { credentialId } : {})
      }
      this.settings.set(SETTINGS_KEY, {
        connections: { ...state.connections, [input.profile]: connection },
        exportProfile: state.exportProfile ?? input.profile,
        credentials: {
          ...state.credentials,
          ...(credentialId ? { [this.credentialId(endpoints)]: credentialId } : {})
        }
      })
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

  private async redeem(link: string, baseUrl: string, timeout: number): Promise<string> {
    let url: URL
    try {
      url = new URL(link)
    } catch {
      throw new Error('Invalid connect link')
    }
    if (url.origin !== new URL(baseUrl).origin || url.username || url.password)
      throw new Error('The connect link must belong to the selected server')
    const token = url.searchParams.get('nmem_connect') || url.searchParams.get('token')
    if (!token) throw new Error('The link does not contain a one-time connect token')
    let response: Response
    try {
      response = await fetch(`${url.origin}/api/remote-access/redeem-connect-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        redirect: 'error',
        signal: AbortSignal.timeout(timeout)
      })
    } catch {
      throw new Error('Connect link redemption failed; obtain a new link before trying again')
    }
    if (!response.ok)
      throw new Error(`Connect link redemption: HTTP ${response.status}; obtain a new link`)
    const data = (await response.json().catch(() => null)) as {
      api_key?: unknown
      url?: unknown
    } | null
    if (!data || typeof data.api_key !== 'string' || !data.api_key)
      throw new Error('Connect link response did not contain a credential')
    if (typeof data.url === 'string') {
      let returned: URL
      try {
        returned = new URL(data.url)
      } catch {
        throw new Error('Connect link returned an invalid server URL')
      }
      if (returned.origin !== url.origin)
        throw new Error('Connect link returned a different server')
    }
    return data.api_key
  }
}
