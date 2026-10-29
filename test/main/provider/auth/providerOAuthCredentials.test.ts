import * as fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CredentialCryptoPort } from '@/config/secretStore'
import { OpenAICodexCredentialStore } from '@/provider/auth/openaiCodex/credentialStore'
import { XaiGrokCredentialStore } from '@/provider/auth/xaiGrok/credentialStore'
import { OpenAICodexAuth } from '@/provider/auth/openaiCodex'
import { XaiGrokAuth } from '@/provider/auth/xaiGrok'

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>())
}))

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const providers = [
  {
    name: 'Codex',
    create: (options: { filePath: string; crypto: CredentialCryptoPort }) => {
      const store = new OpenAICodexCredentialStore(options)
      return {
        store,
        auth: new OpenAICodexAuth(
          store,
          vi.fn(),
          vi.fn(async () => undefined)
        )
      }
    }
  },
  {
    name: 'Grok',
    create: (options: { filePath: string; crypto: CredentialCryptoPort }) => {
      const store = new XaiGrokCredentialStore(options)
      return {
        store,
        auth: new XaiGrokAuth(
          store,
          vi.fn(),
          vi.fn(async () => undefined)
        )
      }
    }
  }
]
const tokens = (accessToken = 'original') => ({
  accessToken,
  refreshToken: 'fixture-refresh',
  tokenType: 'Bearer',
  expiresAt: 0,
  updatedAt: 42
})

for (const provider of providers)
  describe(`${provider.name} private credential ownership`, () => {
    let directory: string
    let filePath: string
    let crypto: {
      isAvailable: ReturnType<typeof vi.fn<() => Promise<boolean>>>
      encrypt: ReturnType<typeof vi.fn<(value: string) => Promise<string>>>
      decrypt: ReturnType<typeof vi.fn<(wrapped: string) => Promise<string>>>
    }
    let owner: ReturnType<typeof provider.create>

    beforeEach(() => {
      directory = fs.mkdtempSync(join(tmpdir(), 'deepchat-provider-oauth-'))
      filePath = join(directory, 'credentials.json')
      crypto = {
        isAvailable: vi.fn(async () => true),
        encrypt: vi.fn(async (value: string) => Buffer.from(value).toString('base64')),
        decrypt: vi.fn(async (wrapped: string) => Buffer.from(wrapped, 'base64').toString('utf8'))
      }
      owner = provider.create({ filePath, crypto })
    })

    afterEach(() => {
      owner.auth.stop()
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
      fs.rmSync(directory, { recursive: true, force: true })
    })

    it('distinguishes a missing file from an unreadable credential', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      expect(await owner.store.load()).toBeNull()
      expect(owner.store.getLoadError()).toBeNull()
      expect(warn).not.toHaveBeenCalled()
      await owner.store.save(tokens())
      const before = fs.readFileSync(filePath, 'utf8')
      crypto.decrypt.mockRejectedValue(new Error('keyring locked'))
      expect(await owner.store.load()).toBeNull()
      expect(owner.store.getLoadError()).toContain('decryption failed')
      expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
      await owner.store.save(tokens('replacement'))
      expect(fs.existsSync(`${filePath}.corrupt`)).toBe(false)
      crypto.decrypt.mockImplementation(async (wrapped) =>
        Buffer.from(wrapped, 'base64').toString('utf8')
      )
      expect((await owner.store.load())?.accessToken).toBe('replacement')
      expect(owner.store.getLoadError()).toBeNull()
    })

    it('rejects oversized payloads before native wrapping', async () => {
      await owner.store.save(tokens())
      const before = fs.readFileSync(filePath, 'utf8')
      crypto.encrypt.mockClear()
      await expect(owner.store.save(tokens('x'.repeat(8 * 1024 * 1024)))).rejects.toThrow(
        'oversized'
      )
      expect(crypto.encrypt).not.toHaveBeenCalled()
      expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
    })

    it('keeps encrypted reads byte-identical and preserves the file fallback policy', async () => {
      await owner.store.save(tokens())
      const before = fs.readFileSync(filePath, 'utf8')
      expect(await owner.store.load()).toMatchObject(tokens())
      expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
      expect(before).not.toContain('fixture-refresh')
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600)
      crypto.isAvailable.mockResolvedValue(false)
      await owner.store.save(tokens('file-fallback'))
      expect(fs.readdirSync(directory)).toEqual(['credentials.json'])
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toMatchObject({
        version: 1,
        storage: 'file',
        tokens: { accessToken: 'file-fallback' }
      })
    })

    it.each(['encrypt', 'fsync', 'rename'] as const)(
      'preserves the previous file after %s failure and recovers',
      async (failure) => {
        await owner.store.save(tokens())
        const before = fs.readFileSync(filePath, 'utf8')
        if (failure === 'encrypt') crypto.encrypt.mockRejectedValueOnce(new Error('native failure'))
        if (failure === 'fsync')
          vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
            throw new Error('flush failure')
          })
        if (failure === 'rename')
          vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
            throw new Error('rename failure')
          })
        await expect(owner.store.save(tokens('replacement'))).rejects.toThrow('failure')
        expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
        expect(fs.readdirSync(directory)).toEqual(['credentials.json'])
        expect((await owner.store.load())?.accessToken).toBe('original')
        await owner.store.save(tokens('recovered'))
        expect((await owner.store.load())?.accessToken).toBe('recovered')
      }
    )

    it('backs up corrupt contents and removes all private artifacts through clear', async () => {
      fs.writeFileSync(filePath, '{broken')
      expect(await owner.store.load()).toBeNull()
      expect(owner.store.getLoadError()).toContain('not valid JSON')
      await owner.store.save(tokens())
      expect(owner.store.getLoadError()).toBeNull()
      expect(fs.readFileSync(`${filePath}.corrupt`, 'utf8')).toBe('{broken')
      fs.writeFileSync(`${filePath}.tmp-stale`, 'stale')
      fs.writeFileSync(`${filePath}.tmp`, 'legacy')
      fs.writeFileSync(join(directory, 'unrelated.txt'), 'unrelated')
      await owner.store.clear()
      expect(fs.readdirSync(directory)).toEqual(['unrelated.txt'])
    })

    it('coalesces pending decrypts and rejects both results after durable removal', async () => {
      await owner.store.save(tokens())
      const raw = Buffer.from(
        JSON.parse(fs.readFileSync(filePath, 'utf8')).wrapped,
        'base64'
      ).toString('utf8')
      const entered = deferred<void>()
      const gate = deferred<string>()
      crypto.decrypt.mockImplementationOnce(() => {
        entered.resolve()
        return gate.promise
      })
      const reads = [owner.store.load(), owner.store.load()]
      const results = Promise.allSettled(reads)
      await entered.promise
      expect(crypto.decrypt).toHaveBeenCalledOnce()
      await owner.store.clear()
      gate.resolve(raw)
      expect((await results).every((item) => item.status === 'rejected')).toBe(true)
      expect(await owner.store.load()).toBeNull()
      expect(fs.existsSync(filePath)).toBe(false)
    })

    it('serializes save/clear/save without exposing a superseded file', async () => {
      await Promise.all([
        owner.store.save(tokens('first')),
        owner.store.clear(),
        owner.store.save(tokens('last'))
      ])
      expect((await owner.store.load())?.accessToken).toBe('last')
      const reopened = provider.create({ filePath, crypto })
      expect((await reopened.store.load())?.accessToken).toBe('last')
      reopened.auth.stop()
    })

    it('reserves control capacity and stops pending native writes and queued mutations', async () => {
      const entered = deferred<void>()
      const gate = deferred<string>()
      crypto.encrypt.mockImplementationOnce(() => {
        entered.resolve()
        return gate.promise
      })
      const normal = Array.from({ length: 24 }, () => owner.store.save(tokens()))
      await entered.promise
      await expect(owner.store.save(tokens('overflow'))).rejects.toThrow('queue is full')
      const control = Array.from({ length: 8 }, () => owner.store.clear())
      const results = Promise.allSettled([...normal, ...control])
      await expect(owner.store.clear()).rejects.toThrow('queue is full')
      owner.auth.stop()
      gate.resolve('late')
      expect((await results).every((item) => item.status === 'rejected')).toBe(true)
      expect(fs.existsSync(filePath)).toBe(false)
      expect(crypto.encrypt).toHaveBeenCalledOnce()
    })

    it('still removes known private artifacts when directory enumeration fails', async () => {
      await owner.store.save(tokens())
      fs.writeFileSync(`${filePath}.corrupt`, 'backup')
      fs.writeFileSync(`${filePath}.tmp`, 'temporary')
      vi.spyOn(fs, 'readdirSync').mockImplementationOnce(() => {
        throw new Error('directory denied')
      })
      await expect(owner.store.clear()).rejects.toThrow('cleanup failed')
      expect(fs.readdirSync(directory)).toEqual([])
    })

    it('does not acknowledge logout while credential deletion fails', async () => {
      await owner.store.save(tokens())
      fs.writeFileSync(`${filePath}.corrupt`, 'backup')
      fs.writeFileSync(`${filePath}.tmp`, 'temporary')
      const remove = fs.rmSync
      vi.spyOn(fs, 'rmSync').mockImplementation((path, options) => {
        if (String(path) === filePath) throw new Error('denied')
        return remove(path, options)
      })
      await expect(owner.auth.logout()).rejects.toThrow('cleanup failed')
      expect((await owner.auth.getStatus()).authenticated).toBe(true)
      expect(fs.existsSync(filePath)).toBe(true)
      expect(fs.readdirSync(directory)).toEqual(['credentials.json'])
    })

    it('waits for a late refresh wrap before logout removes the final file', async () => {
      await owner.store.save(tokens())
      const entered = deferred<void>()
      const gate = deferred<string>()
      crypto.encrypt.mockImplementationOnce(() => {
        entered.resolve()
        return gate.promise
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input) =>
          String(input).includes('openid-configuration')
            ? Response.json({
                device_authorization_endpoint: 'https://auth.x.ai/device',
                token_endpoint: 'https://auth.x.ai/token',
                revocation_endpoint: 'https://auth.x.ai/revoke'
              })
            : Response.json({ access_token: 'refreshed', expires_in: 86400 })
        )
      )
      const refreshing = owner.auth.forceRefreshAccessToken()
      const rejected = expect(refreshing).rejects.toMatchObject({ name: 'AbortError' })
      await entered.promise
      const loggedOut = owner.auth.logout()
      gate.resolve(Buffer.from(JSON.stringify(tokens('refreshed'))).toString('base64'))
      await rejected
      expect((await loggedOut).authenticated).toBe(false)
      expect(fs.existsSync(filePath)).toBe(false)
    })

    it('aborts a refresh response body on stop without changing credentials', async () => {
      await owner.store.save(tokens())
      const before = fs.readFileSync(filePath, 'utf8')
      const entered = deferred<void>()
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input) => {
          if (String(input).includes('openid-configuration'))
            return Response.json({
              device_authorization_endpoint: 'https://auth.x.ai/device',
              token_endpoint: 'https://auth.x.ai/token'
            })
          entered.resolve()
          return new Response(new ReadableStream())
        })
      )
      const pending = owner.auth.forceRefreshAccessToken()
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await entered.promise
      owner.auth.stop()
      await rejected
      expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
    })

    it.each(['declared', 'streamed'] as const)(
      'rejects oversized %s auth data before a credential write',
      async (size) => {
        await owner.store.save(tokens())
        const before = fs.readFileSync(filePath, 'utf8')
        vi.stubGlobal(
          'fetch',
          vi.fn(async (input) =>
            String(input).includes('openid-configuration')
              ? Response.json({
                  device_authorization_endpoint: 'https://auth.x.ai/device',
                  token_endpoint: 'https://auth.x.ai/token'
                })
              : size === 'declared'
                ? new Response('oversized', {
                    headers: { 'content-length': String(8 * 1024 * 1024 + 1) }
                  })
                : new Response(new Uint8Array(8 * 1024 * 1024 + 1))
          )
        )
        await expect(owner.auth.forceRefreshAccessToken()).rejects.toThrow('size limit')
        expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
      }
    )
  })
