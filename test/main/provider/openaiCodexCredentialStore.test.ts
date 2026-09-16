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

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      `${filePath}.tmp`,
      expect.any(String),
      expect.objectContaining({ mode: 0o600 })
    )
    expect(fs.renameSync).toHaveBeenCalledWith(`${filePath}.tmp`, filePath)
    expect(store.load()?.accessToken).toBe('access-token')
  })

  it('backs up a corrupted file before overwriting it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    savedContent = '{broken'
    const store = new OpenAICodexCredentialStore(filePath)

    store.save(tokens)

    expect(fs.copyFileSync).toHaveBeenCalledWith(filePath, `${filePath}.corrupt`)
    expect(fs.renameSync).not.toHaveBeenCalledWith(filePath, `${filePath}.corrupt`)
    expect(store.getLoadError()).toBeNull()
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
})
