import * as fs from 'fs'
import { expect, it, vi } from 'vitest'
import { safeStorage } from 'electron'
import { ChatGPTAccountStore } from '@/provider/auth/chatgpt/accountStore'

it('refuses to overwrite wrapped credentials while the keychain cannot read them', () => {
  const wrapped = JSON.stringify({ version: 1, storage: 'safeStorage', wrapped: 'c2VjcmV0' })
  vi.mocked(fs.readFileSync).mockReturnValue(wrapped)
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
  const store = new ChatGPTAccountStore('/tmp/deepchat-chatgpt/credentials.json')

  expect(store.load()).toBeNull()
  expect(store.isUnavailable()).toBe(true)
  expect(store.getLoadError()).toContain('keychain')
  expect(() => store.save({} as never)).toThrow('locked by the system keychain')
  expect(fs.writeFileSync).not.toHaveBeenCalled()
  expect(fs.copyFileSync).not.toHaveBeenCalled()
})
