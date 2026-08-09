import type { DeepchatBridge } from '@shared/contracts/bridge'
import type { AgentCommandShellConfig } from '@shared/commandShell'
import { settingsChangedEvent, settingsCommandShellChangedEvent } from '@shared/contracts/events'
import type { SettingsNavigationPayload } from '@shared/settingsNavigation'
import {
  configGetEntriesRoute,
  configUpdateEntriesRoute,
  settingsCheckCommandShellRoute,
  settingsGetCommandShellRoute,
  settingsGetSnapshotRoute,
  settingsActivityListRoute,
  settingsListSystemFontsRoute,
  settingsUpdateRoute,
  settingsUpdateCommandShellRoute,
  systemOpenSettingsRoute,
  type ConfigEntryChange,
  type ConfigEntryKey,
  type ConfigEntryValues,
  type SettingsChange,
  type SettingsKey,
  type SettingsSnapshotValues
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

const normalizeSettingsNavigationPayload = (
  navigation?: SettingsNavigationPayload
): SettingsNavigationPayload | undefined => {
  if (!navigation) {
    return undefined
  }

  const params = navigation.params
    ? Object.entries(navigation.params).reduce<Record<string, string>>((acc, [key, value]) => {
        if (typeof value === 'string') {
          acc[key] = value
        }
        return acc
      }, {})
    : undefined

  return {
    routeName: navigation.routeName,
    params: params && Object.keys(params).length > 0 ? params : undefined,
    section: navigation.section
  }
}

export function createSettingsClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getSnapshot(keys?: SettingsKey[]): Promise<Partial<SettingsSnapshotValues>> {
    const result = await bridge.invoke(settingsGetSnapshotRoute.name, { keys })
    return result.values
  }

  async function getSystemFonts(): Promise<string[]> {
    const result = await bridge.invoke(settingsListSystemFontsRoute.name, {})
    return result.fonts
  }

  async function getCommandShell() {
    const result = await bridge.invoke(settingsGetCommandShellRoute.name, {})
    return result.config
  }

  async function updateCommandShell(config: AgentCommandShellConfig) {
    const result = await bridge.invoke(settingsUpdateCommandShellRoute.name, { config })
    return result.config
  }

  async function checkCommandShell(forceRefresh = false) {
    const result = await bridge.invoke(settingsCheckCommandShellRoute.name, { forceRefresh })
    return result.gitBash
  }

  async function getConfigEntries(keys?: ConfigEntryKey[]): Promise<Partial<ConfigEntryValues>> {
    const result = await bridge.invoke(configGetEntriesRoute.name, { keys })
    return result.values
  }

  async function updateConfigEntries(changes: ConfigEntryChange[]) {
    return await bridge.invoke(configUpdateEntriesRoute.name, { changes })
  }

  async function getConfigEntry<K extends ConfigEntryKey>(
    key: K
  ): Promise<ConfigEntryValues[K] | undefined> {
    const values = await getConfigEntries([key])
    return values[key] as ConfigEntryValues[K] | undefined
  }

  async function setConfigEntry<K extends ConfigEntryKey>(key: K, value: ConfigEntryValues[K]) {
    const result = await updateConfigEntries([{ key, value } as ConfigEntryChange])
    return result.values[key] as ConfigEntryValues[K] | undefined
  }

  async function update(changes: SettingsChange[]) {
    return await bridge.invoke(settingsUpdateRoute.name, { changes })
  }

  async function listRecentActivity(limit = 200) {
    const result = await bridge.invoke(settingsActivityListRoute.name, { limit })
    return result.activities
  }

  async function openSettings(navigation?: SettingsNavigationPayload) {
    return await bridge.invoke(
      systemOpenSettingsRoute.name,
      normalizeSettingsNavigationPayload(navigation) ?? {}
    )
  }

  function onChanged(
    listener: (payload: {
      changedKeys: SettingsKey[]
      version: number
      values: Partial<SettingsSnapshotValues>
    }) => void
  ) {
    return bridge.on(settingsChangedEvent.name, listener)
  }

  function onCommandShellChanged(
    listener: (payload: { config: AgentCommandShellConfig; version: number }) => void
  ) {
    return bridge.on(settingsCommandShellChangedEvent.name, listener)
  }

  return {
    getSnapshot,
    getSystemFonts,
    getCommandShell,
    updateCommandShell,
    checkCommandShell,
    getConfigEntries,
    updateConfigEntries,
    getConfigEntry,
    setConfigEntry,
    update,
    listRecentActivity,
    openSettings,
    onChanged,
    onCommandShellChanged
  }
}

export type SettingsClient = ReturnType<typeof createSettingsClient>
