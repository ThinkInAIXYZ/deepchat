import { afterEach, expect, it, vi } from 'vitest'
import { credentialCrypto, secureCredentialCrypto } from '@/app/credentialCrypto'

const native = vi.hoisted(() => ({
  isAsyncEncryptionAvailable: vi.fn(async () => true),
  encryptStringAsync: vi.fn(async (value: string) => Buffer.from(`wrapped:${value}`)),
  decryptStringAsync: vi.fn(async (value: Buffer) => ({
    result: value.toString().slice(8),
    shouldReEncrypt: false
  })),
  getSelectedStorageBackend: vi.fn(() => 'basic_text')
}))
vi.mock('electron', () => ({ safeStorage: native }))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.restoreAllMocks()
})

it('uses acknowledged native ciphertext without changing its encoding', async () => {
  const wrapped = await credentialCrypto.encrypt('fixture')
  expect(wrapped).toBe(Buffer.from('wrapped:fixture').toString('base64'))
  expect(await credentialCrypto.decrypt(wrapped)).toBe('fixture')
})

it.each(['basic_text', 'kwallet5', 'unavailable', 'error'])(
  'enforces the Linux secure backend policy for %s',
  async (backend) => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    native.isAsyncEncryptionAvailable.mockResolvedValue(backend !== 'unavailable')
    native.getSelectedStorageBackend.mockImplementation(() => {
      if (backend === 'error') throw new Error('backend unavailable')
      return backend
    })
    expect(await secureCredentialCrypto.isAvailable()).toBe(backend === 'kwallet5')
  }
)
