import { describe, expect, it, vi } from 'vitest'
import { SecretStore } from '@/config/secretStore'

function fixture() {
  const values = new Map([['credential', 'wrapped:previous']])
  const settings = {
    get: (key: string) => values.get(key),
    set: vi.fn((key: string, value: string) => values.set(key, value)),
    delete: (key: string) => values.delete(key)
  }
  const crypto = {
    isAvailable: vi.fn(async () => true),
    encrypt: vi.fn(async (value: string) => `wrapped:${value}`),
    decrypt: vi.fn(async (wrapped: string) => wrapped.slice('wrapped:'.length))
  }
  return { values, settings, crypto, secrets: new SecretStore(settings as never, crypto) }
}

describe('SecretStore lifecycle', () => {
  it.each(['encrypt', 'decrypt'] as const)(
    'rejects a pending %s after maintenance resumes, including native failure',
    async (operation) => {
      for (const failed of [false, true]) {
        const f = fixture()
        const pending = Promise.withResolvers<string>()
        f.crypto[operation].mockImplementationOnce(() => pending.promise)
        const result =
          operation === 'encrypt' ? f.secrets.wrap('next') : f.secrets.get('credential')
        const rejected = expect(result).rejects.toThrow('interrupted')
        await vi.waitFor(() => expect(f.crypto[operation]).toHaveBeenCalledOnce())
        f.secrets.pause()
        await expect(f.secrets.get('credential')).rejects.toThrow('interrupted')
        expect(() => f.secrets.setWrapped('credential', 'unexpected')).toThrow('interrupted')
        f.secrets.resume()
        if (failed) pending.reject(new Error('Native crypto unavailable'))
        else pending.resolve(operation === 'encrypt' ? 'wrapped:next' : 'previous')
        await rejected
        expect(f.values.get('credential')).toBe('wrapped:previous')
        expect(await f.secrets.get('credential')).toBe('previous')
      }
    }
  )

  it('does not release a credential replaced or removed while decrypting', async () => {
    const f = fixture()
    const pending = Promise.withResolvers<string>()
    f.crypto.decrypt.mockReturnValueOnce(pending.promise)
    const read = f.secrets.get('credential')
    f.secrets.restoreWrapped('credential', undefined)
    const rejected = expect(read).rejects.toThrow('credential changed')
    pending.resolve('previous')
    await rejected
    expect(await f.secrets.get('credential')).toBe('')
  })

  it('keeps existing wrapped data when encryption is unavailable or fails', async () => {
    const f = fixture()
    f.crypto.isAvailable.mockResolvedValueOnce(false)
    await expect(f.secrets.wrap('next')).rejects.toThrow('safeStorageUnavailable')
    f.crypto.encrypt.mockRejectedValueOnce(new Error('Native encryption failed'))
    await expect(f.secrets.wrap('next')).rejects.toThrow('Native encryption failed')
    expect(f.settings.set).not.toHaveBeenCalled()
    expect(f.values.get('credential')).toBe('wrapped:previous')
  })

  it('does not cache plaintext or rewrite credentials when native decryption fails', async () => {
    const f = fixture()
    expect(await f.secrets.get('credential')).toBe('previous')
    f.crypto.decrypt.mockRejectedValueOnce(new Error('Native decryption unavailable'))
    expect(await f.secrets.get('credential')).toBe('')
    expect(await f.secrets.get('credential')).toBe('previous')
    expect(f.settings.set).not.toHaveBeenCalled()
  })
})
