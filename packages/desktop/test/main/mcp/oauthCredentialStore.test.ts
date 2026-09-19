import * as fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { safeStorage } from 'electron'
import { McpOAuthCredentialStore } from '@/mcp/oauthCredentialStore'

describe('McpOAuthCredentialStore', () => {
  let savedContent = ''

  beforeEach(() => {
    savedContent = ''
    vi.mocked(fs.existsSync).mockImplementation(() => Boolean(savedContent))
    vi.mocked(fs.readFileSync).mockImplementation(() => savedContent)
    vi.mocked(fs.statSync).mockImplementation(
      () => ({ size: Buffer.byteLength(savedContent, 'utf8') }) as fs.Stats
    )
    vi.mocked(fs.writeFileSync).mockImplementation((_, data) => {
      savedContent = String(data)
    })
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as unknown as string)
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    vi.mocked(safeStorage.encryptString).mockImplementation((value) =>
      Buffer.from(`wrapped:${value.split('').reverse().join('')}`, 'utf8')
    )
    vi.mocked(safeStorage.decryptString).mockImplementation((value) =>
      value
        .toString('utf8')
        .replace(/^wrapped:/, '')
        .split('')
        .reverse()
        .join('')
    )
  })

  it('removes only the requested credential scope', () => {
    const store = new McpOAuthCredentialStore('/tmp/deepchat-mcp-oauth/credentials.json')

    store.saveEntry('linear', {
      tokens: {
        access_token: 'access-token'
      },
      clientInformation: {
        client_id: 'client-id'
      },
      codeVerifier: 'verifier',
      discoveryState: {
        authorizationServerUrl: 'https://mcp.linear.app'
      }
    })

    store.clearEntryScope('linear', 'tokens')

    const entry = store.load('linear')
    expect(entry?.tokens).toBeUndefined()
    expect(entry?.clientInformation?.client_id).toBe('client-id')
    expect(entry?.codeVerifier).toBe('verifier')
    expect(entry?.discoveryState?.authorizationServerUrl).toBe('https://mcp.linear.app')
  })

  it('keeps credentials memory-only when secure storage is unavailable', () => {
    const store = new McpOAuthCredentialStore('/tmp/deepchat-mcp-oauth/credentials.json')
    const binding = {
      serverId: '71e8637a-1889-4749-b04e-f5a79adefb06',
      configGeneration: 1,
      bindingHash: 'binding',
      endpoint: 'https://mcp.example.com/mcp'
    }

    store.saveClientSecret('secret-key', 'not-plaintext-on-disk', binding)

    expect(store.loadClientSecret('secret-key')).toMatchObject({
      secret: 'not-plaintext-on-disk',
      binding
    })
    expect(fs.writeFileSync).not.toHaveBeenCalled()
    expect(store.getStorageState()).toBe('memory')
  })

  it('persists only a safeStorage envelope when encryption is available', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    const store = new McpOAuthCredentialStore('/tmp/deepchat-mcp-oauth/credentials.json')
    const binding = {
      serverId: '71e8637a-1889-4749-b04e-f5a79adefb06',
      configGeneration: 1,
      bindingHash: 'binding',
      endpoint: 'https://mcp.example.com/mcp'
    }

    store.saveClientSecret('secret-key', 'protected-value', binding)

    const envelope = JSON.parse(savedContent)
    expect(envelope).toMatchObject({ version: 2, storage: 'safeStorage' })
    expect(envelope).not.toHaveProperty('entries')
    expect(savedContent).not.toContain('protected-value')
    expect(fs.renameSync).toHaveBeenCalledOnce()
  })

  it('removes a stale envelope when secure storage becomes unavailable at runtime', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    const filePath = '/tmp/deepchat-mcp-oauth/credentials.json'
    const store = new McpOAuthCredentialStore(filePath)
    const binding = {
      serverId: '71e8637a-1889-4749-b04e-f5a79adefb06',
      configGeneration: 1,
      bindingHash: 'binding',
      endpoint: 'https://mcp.example.com/mcp'
    }

    store.saveClientSecret('secret-key', 'protected-value', binding)
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    store.clearEntry('secret-key')

    expect(fs.unlinkSync).toHaveBeenCalledWith(filePath)
    expect(store.loadClientSecret('secret-key')).toBeNull()
  })

  it('loads a legacy plaintext envelope into memory and removes the file', () => {
    savedContent = JSON.stringify({
      version: 1,
      storage: 'file',
      entries: {
        legacy: {
          tokens: { access_token: 'legacy-token' },
          updatedAt: 42
        }
      },
      updatedAt: 42
    })
    const store = new McpOAuthCredentialStore('/tmp/deepchat-mcp-oauth/credentials.json')

    expect(store.load('legacy')?.tokens?.access_token).toBe('legacy-token')
    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/deepchat-mcp-oauth/credentials.json')
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('preserves an unreadable envelope and refuses to overwrite stored credentials', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    vi.mocked(safeStorage.decryptString).mockImplementationOnce(() => {
      throw new Error('cannot decrypt')
    })
    savedContent = JSON.stringify({
      version: 2,
      storage: 'safeStorage',
      wrapped: 'encrypted',
      updatedAt: 42
    })
    const store = new McpOAuthCredentialStore('/tmp/deepchat-mcp-oauth/credentials.json')

    expect(store.load('stale')).toBeNull()
    expect(safeStorage.decryptString).toHaveBeenCalledOnce()
    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(() =>
      store.saveClientSecret('replacement', 'new-secret', {
        serverId: '71e8637a-1889-4749-b04e-f5a79adefb06',
        configGeneration: 1,
        bindingHash: 'binding',
        endpoint: 'https://mcp.example.com/mcp'
      })
    ).toThrow('MCP credential store is unavailable')
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('matches interactive credentials by every finalized binding field', () => {
    const store = new McpOAuthCredentialStore('/tmp/deepchat-mcp-oauth/credentials.json')
    const baseBinding = {
      serverId: '71e8637a-1889-4749-b04e-f5a79adefb06',
      configGeneration: 1,
      bindingHash: 'binding',
      endpoint: 'https://mcp.example.com/mcp',
      protectedResourceUrl: 'https://mcp.example.com/mcp'
    }
    store.saveEntry('issuer-a', {
      tokens: { access_token: 'token-a' },
      binding: {
        ...baseBinding,
        authorizationServerIssuer: 'https://auth-a.example.com/',
        clientId: 'client-a'
      }
    })
    store.saveEntry('issuer-b', {
      tokens: { access_token: 'token-b' },
      binding: {
        ...baseBinding,
        authorizationServerIssuer: 'https://auth-b.example.com/',
        clientId: 'client-b'
      }
    })

    expect(
      store.findInteractiveCredential({
        ...baseBinding,
        authorizationServerIssuer: 'https://auth-a.example.com/',
        clientId: 'client-a'
      })?.key
    ).toBe('issuer-a')
    expect(
      store.findInteractiveCredential({
        ...baseBinding,
        authorizationServerIssuer: 'https://auth-a.example.com/',
        clientId: 'client-b'
      })
    ).toBeNull()
    expect(store.findInteractiveCredential(baseBinding)).toBeNull()
  })
})
