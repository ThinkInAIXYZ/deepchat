import type { SettingsNavigationPayload } from '@shared/settingsNavigation'
import type { DeepchatBridge } from '@shared/contracts/bridge'
import { settingsChangedEvent } from '@shared/contracts/events'
import {
  configGetEntriesRoute,
  configUpdateEntriesRoute,
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdateRoute,
  systemOpenSettingsRoute,
  type ConfigEntryChange,
  type ConfigEntryKey,
  type ConfigEntryValues,
  type SettingsChange,
  type SettingsKey,
  type SettingsSnapshotValues
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export class SettingsClient {
  constructor(protected readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async getSnapshot(keys?: SettingsKey[]): Promise<Partial<SettingsSnapshotValues>> {
    const result = await this.bridge.invoke(settingsGetSnapshotRoute.name, { keys })
    return result.values
  }

  async getSystemFonts(): Promise<string[]> {
    const result = await this.bridge.invoke(settingsListSystemFontsRoute.name, {})
    return result.fonts
  }

  async getConfigEntries(keys?: ConfigEntryKey[]): Promise<Partial<ConfigEntryValues>> {
    const result = await this.bridge.invoke(configGetEntriesRoute.name, { keys })
    return result.values
  }

  async updateConfigEntries(changes: ConfigEntryChange[]) {
    return await this.bridge.invoke(configUpdateEntriesRoute.name, { changes })
  }

  async getConfigEntry<K extends ConfigEntryKey>(
    key: K
  ): Promise<ConfigEntryValues[K] | undefined> {
    const values = await this.getConfigEntries([key])
    return values[key] as ConfigEntryValues[K] | undefined
  }

  async setConfigEntry<K extends ConfigEntryKey>(key: K, value: ConfigEntryValues[K]) {
    const result = await this.updateConfigEntries([{ key, value } as ConfigEntryChange])
    return result.values[key] as ConfigEntryValues[K] | undefined
  }

  async update(changes: SettingsChange[]) {
    return await this.bridge.invoke(settingsUpdateRoute.name, { changes })
  }

  async openSettings(navigation?: SettingsNavigationPayload) {
    return await this.bridge.invoke(systemOpenSettingsRoute.name, navigation ?? {})
  }

  onChanged(
    listener: (payload: {
      changedKeys: SettingsKey[]
      version: number
      values: Partial<SettingsSnapshotValues>
    }) => void
  ) {
    return this.bridge.on(settingsChangedEvent.name, listener)
  }
}
