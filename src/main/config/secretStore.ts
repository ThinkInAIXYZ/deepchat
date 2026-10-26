import type { SettingsStore } from './settingsStore'

export interface CredentialCryptoPort {
  isAvailable(): Promise<boolean>
  encrypt(value: string): Promise<string>
  decrypt(wrapped: string): Promise<string>
}

export class SecretStore {
  private generation = 0
  private paused = false

  constructor(
    private readonly settings: SettingsStore,
    private readonly crypto: CredentialCryptoPort
  ) {}

  pause(): void {
    this.paused = true
    this.generation++
  }

  resume(): void {
    this.generation++
    this.paused = false
  }

  captureOperation(): () => void {
    const generation = this.generation
    const check = () => {
      if (this.paused || generation !== this.generation)
        throw new Error('Credential operation interrupted by maintenance or shutdown')
    }
    check()
    return check
  }

  async isAvailable(): Promise<boolean> {
    const check = this.captureOperation()
    let available = false
    try {
      available = await this.crypto.isAvailable()
    } catch {
      available = false
    }
    check()
    return available
  }

  async get(key: string): Promise<string> {
    const check = this.captureOperation()
    const wrapped = this.settings.get<string>(key)
    if (!wrapped) {
      return ''
    }
    let value = ''
    try {
      value = await this.crypto.decrypt(wrapped)
    } catch (error) {
      console.error(`[SecretStore] Failed to decrypt ${key}:`, error)
    }
    check()
    if (this.getWrapped(key) !== wrapped) throw new Error('The saved credential changed')
    return value
  }

  getWrapped(key: string): string | undefined {
    return this.settings.get<string>(key)
  }

  async wrap(value: string): Promise<string> {
    const check = this.captureOperation()
    if (!(await this.isAvailable())) {
      throw new Error('sync.error.safeStorageUnavailable')
    }
    check()
    try {
      return await this.crypto.encrypt(value)
    } finally {
      check()
    }
  }

  setWrapped(key: string, wrapped: string): void {
    this.captureOperation()
    this.settings.set(key, wrapped)
  }

  restoreWrapped(key: string, wrapped: string | undefined): void {
    this.captureOperation()
    if (wrapped === undefined) {
      this.settings.delete(key)
      return
    }
    this.settings.set(key, wrapped)
  }
}
