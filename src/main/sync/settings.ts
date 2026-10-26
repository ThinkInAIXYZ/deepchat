import { app } from 'electron'
import path from 'node:path'
import type { SecretStore } from '@/config/secretStore'
import type { SettingsStore } from '@/config/settingsStore'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type {
  CloudSyncConfigBase,
  CloudSyncConfigInput,
  CloudSyncConfigView,
  ResolvedCloudSyncConfig
} from '@shared/types/sync'

const CLOUD_SYNC_BASE_KEY = 'cloudSyncConfig'
const CLOUD_SYNC_SECRET_KEY = 'cloudSyncSecret'

export class SyncSettings {
  private cloudMutation: Promise<void> = Promise.resolve()

  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets: SecretStore,
    private readonly publishEvent: DeepchatEventPublisher
  ) {}

  getEnabled(): boolean {
    return this.settings.get<boolean>('syncEnabled') ?? false
  }

  setEnabled(enabled: boolean): void {
    this.settings.set('syncEnabled', enabled)
    this.publishChanged()
  }

  getFolderPath(): string {
    return (
      this.settings.get<string>('syncFolderPath') || path.join(app.getPath('home'), 'DeepchatSync')
    )
  }

  setFolderPath(folderPath: string): void {
    this.settings.set('syncFolderPath', folderPath)
    this.publishChanged()
  }

  getLastSyncTime(): number {
    return this.settings.get<number>('lastSyncTime') ?? 0
  }

  setLastSyncTime(time: number): void {
    this.settings.set('lastSyncTime', time)
  }

  async getCloudConfig(): Promise<CloudSyncConfigView> {
    const check = this.secrets.captureOperation()
    const base = this.getCloudBase()
    const [secret, safeStorageAvailable] = await Promise.all([
      this.secrets.get(CLOUD_SYNC_SECRET_KEY),
      this.secrets.isAvailable()
    ])
    check()
    return {
      ...base,
      hasSecret: Boolean(secret),
      safeStorageAvailable
    }
  }

  setCloudConfig(config: CloudSyncConfigInput): Promise<CloudSyncConfigView> {
    const check = this.secrets.captureOperation()
    const operation = this.cloudMutation.then(() => this.writeCloudConfig(config, check))
    this.cloudMutation = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  private async writeCloudConfig(
    config: CloudSyncConfigInput,
    check: () => void
  ): Promise<CloudSyncConfigView> {
    check()
    const current = this.getCloudBase()
    const next: CloudSyncConfigBase = {
      enabled: config.enabled ?? current.enabled,
      endpoint: config.endpoint ?? current.endpoint,
      bucket: config.bucket ?? current.bucket,
      region: config.region ?? current.region,
      prefix: config.prefix ?? current.prefix,
      accessKeyId: config.accessKeyId ?? current.accessKeyId
    }
    const currentWrappedSecret = this.secrets.getWrapped(CLOUD_SYNC_SECRET_KEY)
    const nextWrappedSecret = config.secretAccessKey?.length
      ? await this.secrets.wrap(config.secretAccessKey)
      : undefined
    const hasSecret =
      nextWrappedSecret !== undefined || Boolean(await this.secrets.get(CLOUD_SYNC_SECRET_KEY))
    const safeStorageAvailable =
      nextWrappedSecret !== undefined || (await this.secrets.isAvailable())

    check()
    let secretWritten = false
    try {
      if (nextWrappedSecret !== undefined) {
        this.secrets.setWrapped(CLOUD_SYNC_SECRET_KEY, nextWrappedSecret)
        secretWritten = true
      }
      this.settings.set(CLOUD_SYNC_BASE_KEY, next)
    } catch (error) {
      if (secretWritten) {
        this.secrets.restoreWrapped(CLOUD_SYNC_SECRET_KEY, currentWrappedSecret)
      }
      throw error
    }

    return { ...next, hasSecret, safeStorageAvailable }
  }

  async getResolvedCloudConfig(): Promise<ResolvedCloudSyncConfig | null> {
    const check = this.secrets.captureOperation()
    const base = this.getCloudBase()
    const secretAccessKey = await this.secrets.get(CLOUD_SYNC_SECRET_KEY)
    check()
    if (!base.endpoint || !base.bucket || !base.accessKeyId || !secretAccessKey) {
      return null
    }
    return {
      endpoint: base.endpoint,
      bucket: base.bucket,
      region: base.region,
      prefix: base.prefix,
      accessKeyId: base.accessKeyId,
      secretAccessKey
    }
  }

  private getCloudBase(): CloudSyncConfigBase {
    const stored = this.settings.get<Partial<CloudSyncConfigBase>>(CLOUD_SYNC_BASE_KEY)
    return {
      enabled: stored?.enabled ?? false,
      endpoint: stored?.endpoint ?? '',
      bucket: stored?.bucket ?? '',
      region: stored?.region ?? 'auto',
      prefix: stored?.prefix ?? 'deepchat-backups',
      accessKeyId: stored?.accessKeyId ?? ''
    }
  }

  private publishChanged(): void {
    this.publishEvent('config.syncSettings.changed', {
      enabled: this.getEnabled(),
      folderPath: this.getFolderPath(),
      version: Date.now()
    })
  }
}
