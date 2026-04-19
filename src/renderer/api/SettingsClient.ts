import type { SettingsNavigationPayload } from '@shared/settingsNavigation'
import type { DeepchatBridge } from '@shared/contracts/bridge'
import { settingsChangedEvent } from '@shared/contracts/events'
import {
  settingsGetSnapshotRoute,
  settingsUpdateRoute,
  systemOpenSettingsRoute,
  type SettingsChange,
  type SettingsKey,
  type SettingsSnapshotValues
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export class SettingsClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async getSnapshot(keys?: SettingsKey[]): Promise<Partial<SettingsSnapshotValues>> {
    const result = await this.bridge.invoke(settingsGetSnapshotRoute.name, { keys })
    return result.values
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
