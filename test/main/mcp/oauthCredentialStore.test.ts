import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpOAuthCredentialStore } from '@/mcp/oauthCredentialStore'

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>())
}))

const binding = {
  serverId: '71e8637a-1889-4749-b04e-f5a79adefb06',
  configGeneration: 1,
  bindingHash: 'binding',
  endpoint: 'https://mcp.example.com/mcp'
}

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const unwrap = (wrapped: string) => Buffer.from(wrapped, 'base64').toString('utf8')

describe('McpOAuthCredentialStore', () => {
  let directory: string
  let filePath: string
  let crypto: {
    isAvailable: ReturnType<typeof vi.fn<() => Promise<boolean>>>
    encrypt: ReturnType<typeof vi.fn<(value: string) => Promise<string>>>
    decrypt: ReturnType<typeof vi.fn<(wrapped: string) => Promise<string>>>
  }
  let store: McpOAuthCredentialStore

  beforeEach(() => {
    directory = fs.mkdtempSync(join(tmpdir(), 'deepchat-oauth-'))
    filePath = join(directory, 'credentials.json')
    crypto = {
      isAvailable: vi.fn(async () => true),
      encrypt: vi.fn(async (value: string) => Buffer.from(value).toString('base64')),
      decrypt: vi.fn(async (wrapped: string) => unwrap(wrapped))
    }
    store = new McpOAuthCredentialStore({ filePath, crypto })
  })

  afterEach(() => {
    store.stop()
    vi.restoreAllMocks()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('removes only the requested credential scope', async () => {
    await store.saveEntry('linear', {
      tokens: { access_token: 'access-token', token_type: 'Bearer' },
      clientInformation: { client_id: 'client-id' },
      codeVerifier: 'verifier',
      discoveryState: { authorizationServerUrl: 'https://mcp.linear.app' }
    })
    await store.clearEntryScope('linear', 'tokens')
    expect(await store.load('linear')).toMatchObject({
      clientInformation: { client_id: 'client-id' },
      codeVerifier: 'verifier',
      discoveryState: { authorizationServerUrl: 'https://mcp.linear.app' }
    })
    expect((await store.load('linear'))?.tokens).toBeUndefined()
  })

  it('keeps credentials memory-only when secure storage is unavailable', async () => {
    crypto.isAvailable.mockResolvedValue(false)
    await store.saveClientSecret('secret-key', 'not-plaintext-on-disk', binding)
    expect(await store.loadClientSecret('secret-key')).toMatchObject({
      secret: 'not-plaintext-on-disk',
      binding
    })
    expect(fs.existsSync(filePath)).toBe(false)
    expect(await store.getStorageState()).toBe('memory')
  })

  it('persists only a safeStorage envelope and reads v2 without rewriting it', async () => {
    await store.saveClientSecret('secret-key', 'protected-value', binding)
    const serialized = fs.readFileSync(filePath, 'utf8')
    expect(JSON.parse(serialized)).toMatchObject({ version: 2, storage: 'safeStorage' })
    expect(JSON.parse(serialized)).not.toHaveProperty('entries')
    expect(serialized).not.toContain('protected-value')
    const reloaded = new McpOAuthCredentialStore({ filePath, crypto })
    expect(await reloaded.loadClientSecret('secret-key')).toMatchObject({
      secret: 'protected-value'
    })
    expect(fs.readFileSync(filePath, 'utf8')).toBe(serialized)
    expect(crypto.encrypt).toHaveBeenCalledOnce()
    reloaded.stop()
  })

  it('removes a stale envelope when secure storage becomes unavailable at runtime', async () => {
    await store.saveClientSecret('secret-key', 'protected-value', binding)
    crypto.isAvailable.mockResolvedValue(false)
    await store.clearEntry('secret-key')
    expect(fs.existsSync(filePath)).toBe(false)
    expect(await store.loadClientSecret('secret-key')).toBeNull()
  })

  it.each([false, true])('loads a legacy envelope with secure storage=%s', async (secure) => {
    crypto.isAvailable.mockResolvedValue(secure)
    const entries = { legacy: { tokens: { access_token: 'legacy-token' }, updatedAt: 42 } }
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        secure
          ? {
              version: 1,
              storage: 'safeStorage',
              wrapped: await crypto.encrypt(JSON.stringify(entries)),
              updatedAt: 42
            }
          : { version: 1, storage: 'file', entries, updatedAt: 42 }
      )
    )
    expect((await store.load('legacy'))?.tokens?.access_token).toBe('legacy-token')
    if (secure) expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).version).toBe(2)
    else expect(fs.existsSync(filePath)).toBe(false)
  })

  it('preserves an unreadable envelope and refuses to overwrite stored credentials', async () => {
    crypto.decrypt.mockRejectedValueOnce(new Error('cannot decrypt'))
    const serialized = JSON.stringify({
      version: 2,
      storage: 'safeStorage',
      wrapped: 'encrypted',
      updatedAt: 42
    })
    fs.writeFileSync(filePath, serialized)
    expect(await store.load('stale')).toBeNull()
    await expect(store.saveClientSecret('replacement', 'new-secret', binding)).rejects.toThrow(
      'unavailable'
    )
    expect(crypto.decrypt).toHaveBeenCalledOnce()
    expect(fs.readFileSync(filePath, 'utf8')).toBe(serialized)
  })

  it('matches interactive credentials by every finalized binding field', async () => {
    const base = { ...binding, protectedResourceUrl: binding.endpoint }
    for (const id of ['a', 'b'])
      await store.saveEntry(`issuer-${id}`, {
        tokens: { access_token: `token-${id}`, token_type: 'Bearer' },
        binding: {
          ...base,
          authorizationServerIssuer: `https://auth-${id}.example/`,
          clientId: `client-${id}`
        }
      })
    expect(
      (
        await store.findInteractiveCredential({
          ...base,
          authorizationServerIssuer: 'https://auth-a.example/',
          clientId: 'client-a'
        })
      )?.key
    ).toBe('issuer-a')
    expect(
      await store.findInteractiveCredential({
        ...base,
        authorizationServerIssuer: 'https://auth-a.example/',
        clientId: 'client-b'
      })
    ).toBeNull()
    expect(await store.findInteractiveCredential(base)).toBeNull()
  })

  it('serializes partial updates and shares a pending initial decrypt', async () => {
    await store.saveEntry('entry', { codeVerifier: 'initial' })
    const raw = unwrap(JSON.parse(fs.readFileSync(filePath, 'utf8')).wrapped)
    const gate = deferred<string>()
    const entered = deferred<void>()
    crypto.decrypt.mockImplementationOnce(() => {
      entered.resolve()
      return gate.promise
    })
    const reloaded = new McpOAuthCredentialStore({ filePath, crypto })
    const reads = [reloaded.load('entry'), reloaded.load('entry')]
    await entered.promise
    expect(crypto.decrypt).toHaveBeenCalledOnce()
    gate.resolve(raw)
    expect(await Promise.all(reads)).toEqual([
      expect.objectContaining({ codeVerifier: 'initial' }),
      expect.objectContaining({ codeVerifier: 'initial' })
    ])
    await Promise.all([
      reloaded.saveEntry('entry', { tokens: { access_token: 'new', token_type: 'Bearer' } }),
      reloaded.saveEntry('entry', { clientInformation: { client_id: 'client' } })
    ])
    expect(await reloaded.load('entry')).toMatchObject({
      codeVerifier: 'initial',
      tokens: { access_token: 'new' },
      clientInformation: { client_id: 'client' }
    })
    reloaded.stop()
  })

  it.each(['encrypt', 'rename'] as const)(
    'preserves RAM and disk after %s failure and recovers',
    async (failure) => {
      await store.saveClientSecret('key', 'original', binding)
      const serialized = fs.readFileSync(filePath, 'utf8')
      if (failure === 'encrypt') crypto.encrypt.mockRejectedValueOnce(new Error('native failure'))
      else
        vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
          throw new Error('rename failure')
        })
      await expect(store.saveClientSecret('key', 'replacement', binding)).rejects.toThrow('failure')
      expect((await store.loadClientSecret('key'))?.secret).toBe('original')
      expect(fs.readFileSync(filePath, 'utf8')).toBe(serialized)
      expect(fs.readdirSync(directory)).toEqual(['credentials.json'])
      await store.saveClientSecret('key', 'recovered', binding)
      expect((await store.loadClientSecret('key'))?.secret).toBe('recovered')
    }
  )

  it('moves an interactive binding atomically without losing either entry on failure', async () => {
    await store.saveEntry('from', { codeVerifier: 'source' })
    await store.saveEntry('to', { codeVerifier: 'target' })
    const serialized = fs.readFileSync(filePath, 'utf8')
    crypto.encrypt.mockRejectedValueOnce(new Error('native failure'))
    await expect(store.moveInteractiveEntry('from', 'to', binding)).rejects.toThrow(
      'native failure'
    )
    expect(fs.readFileSync(filePath, 'utf8')).toBe(serialized)
    expect((await store.load('from'))?.codeVerifier).toBe('source')
    await store.moveInteractiveEntry('from', 'to', binding)
    expect(await store.load('from')).toBeNull()
    expect(await store.load('to')).toMatchObject({
      codeVerifier: 'source',
      binding
    })
  })

  it.each(['encrypt', 'decrypt'] as const)(
    'rejects a delayed %s result after stop',
    async (operation) => {
      await store.saveEntry('entry', { codeVerifier: 'original' })
      const serialized = fs.readFileSync(filePath, 'utf8')
      const gate = deferred<string>()
      const entered = deferred<void>()
      crypto[operation].mockImplementationOnce(() => {
        entered.resolve()
        return gate.promise
      })
      const owner =
        operation === 'decrypt' ? new McpOAuthCredentialStore({ filePath, crypto }) : store
      const pending =
        operation === 'decrypt'
          ? owner.load('entry')
          : owner.saveEntry('entry', { codeVerifier: 'late' })
      const result = expect(pending).rejects.toThrow('interrupted')
      await entered.promise
      owner.stop()
      gate.resolve(
        operation === 'decrypt' ? unwrap(JSON.parse(serialized).wrapped) : 'late-wrapped'
      )
      await result
      await expect(owner.load('entry')).rejects.toThrow('interrupted')
      expect(fs.readFileSync(filePath, 'utf8')).toBe(serialized)
    }
  )

  it('bounds pending writes while reserving control capacity and stops the entire queue', async () => {
    const gate = deferred<string>()
    const entered = deferred<void>()
    crypto.encrypt.mockImplementationOnce(() => {
      entered.resolve()
      return gate.promise
    })
    const normal = Array.from({ length: 24 }, (_, i) =>
      store.saveEntry(`key-${i}`, { codeVerifier: 'pending' })
    )
    await entered.promise
    await expect(store.saveEntry('overflow', { codeVerifier: 'rejected' })).rejects.toThrow(
      'queue is full'
    )
    const controls = Array.from({ length: 8 }, () => store.clearEntry('key-0'))
    const result = Promise.allSettled([...normal, ...controls])
    await expect(store.clearEntry('overflow')).rejects.toThrow('queue is full')
    store.stop()
    gate.resolve('late')
    expect((await result).every((item) => item.status === 'rejected')).toBe(true)
    expect(fs.existsSync(filePath)).toBe(false)
    expect(crypto.encrypt).toHaveBeenCalledOnce()
  })
})
