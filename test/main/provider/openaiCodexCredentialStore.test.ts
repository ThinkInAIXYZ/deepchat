import * as fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { safeStorage } from 'electron'
import {
  OpenAICodexCredentialStore,
  type OpenAICodexTokenSet
} from '@/provider/auth/openaiCodex/credentialStore'

const filePath = '/tmp/deepchat-openai-codex/credentials.json'

const tokens: OpenAICodexTokenSet = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  tokenType: 'Bearer',
  expiresAt: Date.now() + 3_600_000,
  updatedAt: Date.now()
}

function fileEnvelope(value: OpenAICodexTokenSet): string {
  return JSON.stringify({ version: 1, storage: 'file', tokens: value, updatedAt: 1 })
}

describe('OpenAICodexCredentialStore', () => {
  let savedContent: string | null = null

  beforeEach(() => {
    savedContent = null
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      if (savedContent === null) {
        throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
      }
      return savedContent
    })
    vi.mocked(fs.writeFileSync).mockImplementation((_, data) => {
      savedContent = String(data)
    })
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as unknown as string)
    vi.mocked(fs.renameSync).mockImplementation(() => {})
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
  })

  it('returns null without an error when the credential file is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = new OpenAICodexCredentialStore(filePath)

    expect(store.load()).toBeNull()
    expect(store.getLoadError()).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('reports corrupted JSON instead of treating it as signed out', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    savedContent = '{broken'
    const store = new OpenAICodexCredentialStore(filePath)

    expect(store.load()).toBeNull()
    expect(store.getLoadError()).toContain('not valid JSON')
    expect(warn).toHaveBeenCalled()
  })

  it('reports decryption failures instead of treating them as signed out', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(safeStorage.decryptString).mockImplementationOnce(() => {
      throw new Error('keyring locked')
    })
    savedContent = JSON.stringify({
      version: 1,
      storage: 'safeStorage',
      wrapped: Buffer.from('ciphertext').toString('base64'),
      updatedAt: 1
    })
    const store = new OpenAICodexCredentialStore(filePath)

    expect(store.load()).toBeNull()
    expect(store.getLoadError()).toContain('decryption failed')
  })

  it('returns tokens and clears the load error for a healthy envelope', () => {
    savedContent = fileEnvelope(tokens)
    const store = new OpenAICodexCredentialStore(filePath)

    expect(store.load()?.accessToken).toBe('access-token')
    expect(store.getLoadError()).toBeNull()
  })

  it('writes through a temporary file and renames it into place', () => {
    const store = new OpenAICodexCredentialStore(filePath)

    store.save(tokens)

    const temporaryPath = String(vi.mocked(fs.openSync).mock.calls[0][0])
    expect(temporaryPath).toMatch(/^\/tmp\/deepchat-openai-codex\/credentials\.json\.tmp-/)
    expect(fs.openSync).toHaveBeenCalledWith(temporaryPath, 'w', 0o600)
    expect(fs.fsyncSync).toHaveBeenCalled()
    expect(fs.renameSync).toHaveBeenCalledWith(temporaryPath, filePath)
    expect(fs.rmSync).toHaveBeenCalledWith(temporaryPath, { force: true })
    expect(store.load()?.accessToken).toBe('access-token')
  })

  it('removes the temporary file when the rename fails', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(fs.renameSync).mockImplementation(() => {
      throw new Error('EPERM: operation not permitted')
    })
    const store = new OpenAICodexCredentialStore(filePath)

    expect(() => store.save(tokens)).toThrow('EPERM')
    const temporaryPath = String(vi.mocked(fs.openSync).mock.calls[0][0])
    expect(fs.rmSync).toHaveBeenCalledWith(temporaryPath, { force: true })
  })

  it('backs up a corrupted file before overwriting it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    savedContent = '{broken'
    let backupSnapshot: string | null = null
    vi.mocked(fs.copyFileSync).mockImplementation(() => {
      backupSnapshot = savedContent
    })
    const store = new OpenAICodexCredentialStore(filePath)

    store.save(tokens)

    expect(fs.copyFileSync).toHaveBeenCalledWith(filePath, `${filePath}.corrupt`)
    expect(fs.renameSync).not.toHaveBeenCalledWith(filePath, `${filePath}.corrupt`)
    expect(backupSnapshot).toBe('{broken')
    expect(store.getLoadError()).toBeNull()
  })

  it('does not back up an undecryptable file before overwriting it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(safeStorage.decryptString).mockImplementation(() => {
      throw new Error('keyring locked')
    })
    savedContent = JSON.stringify({
      version: 1,
      storage: 'safeStorage',
      wrapped: Buffer.from('ciphertext').toString('base64'),
      updatedAt: 1
    })
    const store = new OpenAICodexCredentialStore(filePath)

    store.save(tokens)

    expect(fs.copyFileSync).not.toHaveBeenCalled()
  })

  it('does not back up a healthy file before overwriting it', () => {
    savedContent = fileEnvelope(tokens)
    const store = new OpenAICodexCredentialStore(filePath)

    store.save({ ...tokens, accessToken: 'new-access-token' })

    expect(fs.copyFileSync).not.toHaveBeenCalled()
    expect(store.load()?.accessToken).toBe('new-access-token')
  })

  it('clear removes the credential file together with its backup and temp file', () => {
    const store = new OpenAICodexCredentialStore(filePath)

    store.clear()

    expect(fs.rmSync).toHaveBeenCalledWith(filePath, { force: true })
    expect(fs.rmSync).toHaveBeenCalledWith(`${filePath}.corrupt`, { force: true })
    expect(fs.rmSync).toHaveBeenCalledWith(`${filePath}.tmp`, { force: true })
  })

  it('clear still attempts the backup and temp files when the main removal fails', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(fs.rmSync).mockImplementation((target) => {
      if (String(target) === filePath) {
        throw new Error('EISDIR: illegal operation on a directory')
      }
    })
    const store = new OpenAICodexCredentialStore(filePath)

    store.clear()

    expect(fs.rmSync).toHaveBeenCalledWith(`${filePath}.corrupt`, { force: true })
    expect(fs.rmSync).toHaveBeenCalledWith(`${filePath}.tmp`, { force: true })
  })
})
