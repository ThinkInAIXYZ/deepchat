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

  getCloudConfig(): CloudSyncConfigView {
    const base = this.getCloudBase()
    return {
      ...base,
      hasSecret: Boolean(this.secrets.get(CLOUD_SYNC_SECRET_KEY)),
      safeStorageAvailable: this.secrets.isAvailable()
    }
  }

  setCloudConfig(config: CloudSyncConfigInput): CloudSyncConfigView {
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
      ? this.secrets.wrap(config.secretAccessKey)
      : undefined

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

    return this.getCloudConfig()
  }

  getResolvedCloudConfig(): ResolvedCloudSyncConfig | null {
    const base = this.getCloudBase()
    const secretAccessKey = this.secrets.get(CLOUD_SYNC_SECRET_KEY)
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
