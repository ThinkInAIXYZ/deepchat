import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { NowledgeMemConnections, resolveMemEndpoints } from '@/nowledgeMem'
import { NOWLEDGE_PLUGIN_ID } from '@shared/types/nowledgeMemPlugin'
import type { SettingsStore } from '@/config/settingsStore'
import type { McpSettings } from '@/mcp/settings'

const nativeFetch = globalThis.fetch
let server: Server
let baseUrl: string
let requests: Array<{ path: string; key?: string; method?: string }>
let healthStatus: number
let contextFails: boolean
let rejectKey: string
let legacyOnly: boolean

beforeEach(async () => {
  requests = []
  healthStatus = 200
  contextFails = false
  rejectKey = 'wrong-key'
  legacyOnly = false
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url!, 'http://localhost').pathname
    const key = req.headers['x-nmem-api-key'] as string | undefined
    requests.push({ path: pathname, key, method: req.method })
    res.setHeader('Content-Type', 'application/json')
    if (legacyOnly && !pathname.startsWith('/remote-api')) {
      res.writeHead(404).end('{}')
      return
    }
    if (key === rejectKey) {
      res.writeHead(401).end('{}')
      return
    }
    if (pathname.endsWith('/health')) {
      res.writeHead(healthStatus).end('{"status":"ok"}')
      return
    }
    if (pathname.endsWith('/memories')) {
      res.end('{"memories":[]}')
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end('{}')
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    const message = JSON.parse(body)
    if (!('id' in message)) {
      res.writeHead(202).end()
      return
    }
    const result =
      message.method === 'initialize'
        ? {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'Mem fixture', version: '1' }
          }
        : message.method === 'tools/list'
          ? { tools: [{ name: 'read_context_bundle', inputSchema: { type: 'object' } }] }
          : { content: [{ type: 'text', text: '{}' }], ...(contextFails ? { isError: true } : {}) }
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterEach(async () => {
  vi.unstubAllGlobals()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function setup(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial))
  const encrypted = new Map<string, string>()
  const settings = {
    get store() {
      return { ...Object.fromEntries(data), ...Object.fromEntries(encrypted) }
    },
    delete: (key: string) => {
      data.delete(key)
      encrypted.delete(key)
    },
    get: (key: string) => data.get(key),
    set: vi.fn((key: string, value: unknown) => {
      data.set(key, structuredClone(value))
    })
  }
  const secrets = {
    get: (key: string) => encrypted.get(key) ?? '',
    wrap: vi.fn((value: string) => `encrypted:${value}`),
    setWrapped: (key: string, wrapped: string) => {
      encrypted.set(key, wrapped.slice('encrypted:'.length))
    },
    restoreWrapped: (key: string, wrapped: string | undefined) => {
      if (wrapped === undefined) encrypted.delete(key)
      else encrypted.set(key, wrapped.slice('encrypted:'.length))
    }
  }
  const mcp = { getMcpServers: async () => ({}) }
  const create = () =>
    new NowledgeMemConnections(
      settings as unknown as SettingsStore,
      secrets,
      mcp as unknown as McpSettings
    )
  return { service: create(), create, data, encrypted, settings, secrets }
}

function routeRemoteToFixture() {
  vi.stubGlobal('fetch', (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(url instanceof Request ? url.url : url)
    if (target.protocol === 'https:')
      return nativeFetch(`${baseUrl}${target.pathname}${target.search}`, init)
    return nativeFetch(url, init)
  })
}

const local = () => ({ baseUrl, timeout: 5000 })
const remote = (base = 'https://mem.example.test') => ({
  baseUrl: base,
  apiKey: 'remote-key',
  timeout: 5000
})

describe('Nowledge connection contract', () => {
  it('verifies REST and MCP and restores the same connection for tools and exports', async () => {
    routeRemoteToFixture()
    const { service, create, data } = setup()
    await service.save(local())
    await service.save({ ...remote(), replace: true })
    const state = await service.getState()
    expect(state.connection?.baseUrl).toBe('https://mem.example.test')
    expect(JSON.stringify([...data])).not.toContain('remote-key')
    expect(JSON.stringify(state)).not.toContain('remote-key')
    expect(create().getExportConfig()).toMatchObject({
      baseUrl: 'https://mem.example.test',
      apiKey: 'remote-key'
    })
    expect(service.getPublicExportConfig()).not.toHaveProperty('apiKey')
    const config = {
      ...service.getMcpConnection(),
      ownerPluginId: NOWLEDGE_PLUGIN_ID,
      sourceId: NOWLEDGE_PLUGIN_ID
    }
    expect(service.getMcpBindings(config)).toEqual({ NOWLEDGE_MEM_API_KEY: 'remote-key' })
    expect(requests.some((r) => r.path === '/mcp/' && r.key === 'remote-key')).toBe(true)
  })

  it.each(['http://192.168.1.2:14242', 'https://mem.example.test'])(
    'accepts %s without an API key when the server allows it',
    async (address) => {
      vi.stubGlobal('fetch', (url: string | URL | Request, init?: RequestInit) => {
        const target = new URL(url instanceof Request ? url.url : url)
        return nativeFetch(`${baseUrl}${target.pathname}${target.search}`, init)
      })
      const { service } = setup()
      const state = await service.save({ baseUrl: address, timeout: 5000 })
      expect(state.connection).toMatchObject({ baseUrl: address, hasApiKey: false })
      expect(requests.every((request) => request.key === undefined)).toBe(true)
    }
  )

  it('keeps the selected profile and credentials when reading previous settings', async () => {
    routeRemoteToFixture()
    const { service, data, encrypted } = setup()
    await service.save({ ...local(), apiKey: 'local-key' })
    const localConnection = (data.get('nowledgeMemPlugin') as { connection: object }).connection
    await service.save({ ...remote(), replace: true })
    const saved = structuredClone(data.get('nowledgeMemPlugin')) as {
      connection: object
      credentials: object
    }
    data.set('nowledgeMemPlugin', {
      connections: {
        local: localConnection,
        remote: { ...saved.connection, profile: 'remote' }
      },
      exportProfile: 'remote',
      credentials: saved.credentials
    })
    expect((await service.getState()).connection?.baseUrl).toBe('https://mem.example.test')
    expect(service.getExportConfig().apiKey).toBe('remote-key')
    await service.save({ ...remote(), apiKey: '' })
    expect(data.get('nowledgeMemPlugin')).not.toHaveProperty('connections')
    expect([...encrypted.values()]).toEqual(['local-key', 'remote-key'])
  })

  it('does not commit bad authentication or retry it at another path', async () => {
    routeRemoteToFixture()
    const { service, data } = setup()
    await service.save(remote())
    const before = structuredClone([...data])
    requests = []
    await expect(service.save({ ...remote(), apiKey: 'wrong-key' })).rejects.toThrow('HTTP 401')
    expect([...data]).toEqual(before)
    expect(service.getExportConfig().apiKey).toBe('remote-key')
    expect(requests).toHaveLength(1)
  })

  it('requires context-tool success and leaves the prior connection intact', async () => {
    const { service, data } = setup()
    await service.save(local())
    const before = structuredClone([...data])
    contextFails = true
    await expect(service.save(local())).rejects.toThrow('MCP verification failed')
    expect([...data]).toEqual(before)
  })

  it('retains credentials per destination, requires replacement confirmation and rejects stale MCP binding', async () => {
    routeRemoteToFixture()
    const { service } = setup()
    await service.save(remote())
    const old = {
      ...service.getMcpConnection(),
      ownerPluginId: NOWLEDGE_PLUGIN_ID,
      sourceId: NOWLEDGE_PLUGIN_ID
    }
    const next = { ...remote('https://other.example.test'), apiKey: '' }
    await expect(service.save(next)).rejects.toThrow('Confirm replacing')
    await service.save({ ...next, replace: true })
    expect(service.getExportConfig().apiKey).toBe('')
    await service.save({ ...next, replace: true, apiKey: 'other-key' })
    expect(() => service.getMcpBindings(old)).toThrow('no longer matches')
    await service.save({ ...remote(), replace: true, apiKey: '' })
    expect(service.getExportConfig().apiKey).toBe('remote-key')
  })

  it('imports legacy export credentials only on explicit save and clears plaintext after encryption', async () => {
    const { service, data, secrets } = setup({
      nowledgeMemConfig: { baseUrl, apiKey: 'legacy-key', timeout: 5000 }
    })
    const state = await service.getState()
    expect(state.connection).toBeNull()
    expect(state.legacy[0].hasApiKey).toBe(true)
    expect(JSON.stringify(state)).not.toContain('legacy-key')
    await service.save({ ...local(), legacySource: 'export' })
    expect(secrets.wrap).toHaveBeenCalledWith('legacy-key')
    expect(data.get('nowledgeMemConfig')).not.toHaveProperty('apiKey')
    expect(service.getExportConfig().apiKey).toBe('legacy-key')
  })

  it('does not lose the previous credential when persisting a rotation fails', async () => {
    routeRemoteToFixture()
    const { service, settings, encrypted } = setup()
    await service.save(remote())
    settings.set.mockImplementationOnce(() => {
      throw new Error('Disk full')
    })
    await expect(service.save({ ...remote(), apiKey: 'replacement-key' })).rejects.toThrow(
      'Disk full'
    )
    expect(service.getExportConfig().apiKey).toBe('remote-key')
    expect([...encrypted.values()]).toEqual(['remote-key'])
  })

  it('reuses unchanged keys, removes replaced keys and explicitly clears retained destinations', async () => {
    routeRemoteToFixture()
    const { service, encrypted } = setup()
    await service.save(remote())
    const original = [...encrypted.keys()]
    await service.save({ ...remote(), apiKey: '' })
    expect([...encrypted.keys()]).toEqual(original)
    await service.save({ ...remote(), apiKey: 'rotated-key' })
    expect([...encrypted.values()]).toEqual(['rotated-key'])
    await service.save({ ...remote('https://other.example.test'), replace: true })
    expect(encrypted.size).toBe(2)
    service.clear()
    expect(encrypted.size).toBe(0)
    expect((await service.getState()).connection).toBeNull()
  })

  it('resolves legacy API prefixes only on a missing route, preserving the full MCP prefix', async () => {
    routeRemoteToFixture()
    legacyOnly = true
    const { service } = setup()
    const state = await service.save(remote())
    expect(state.connection?.apiBaseUrl).toBe('https://mem.example.test/remote-api')
    expect(state.connection?.mcpUrl).toBe('https://mem.example.test/remote-api/mcp/')
  })

  it('recovers the matching prefix credential when reconnecting with an empty key', async () => {
    routeRemoteToFixture()
    legacyOnly = true
    const { service } = setup()
    await service.save(remote())
    await service.save({
      ...remote('https://other.example.test'),
      replace: true,
      apiKey: 'other-key'
    })
    requests = []
    await service.save({ ...remote(), replace: true, apiKey: '' })
    expect(service.getExportConfig().apiKey).toBe('remote-key')
    expect(
      requests
        .filter((request) => request.path.startsWith('/remote-api'))
        .every((request) => request.key === 'remote-key')
    ).toBe(true)
  })

  it('does not forward a saved root credential to newly discovered legacy routes', async () => {
    routeRemoteToFixture()
    const { service } = setup()
    await service.save(remote())
    const before = await service.getState()
    requests = []
    legacyOnly = true
    await expect(service.save({ ...remote(), apiKey: '' })).rejects.toThrow(
      'Enter a credential for the resolved'
    )
    expect(requests.map((request) => request.path)).toEqual(['/health'])
    expect(await service.getState()).toEqual(before)
  })

  it('rejects cross-origin endpoints and credentials in URLs before network access', () => {
    for (const input of [
      { ...remote(), apiBaseUrl: 'https://other.example.test' },
      { ...remote(), baseUrl: 'https://key:secret@mem.example.test' }
    ])
      expect(() => resolveMemEndpoints(input as never)).toThrow()
    expect(requests).toEqual([])
  })
})
