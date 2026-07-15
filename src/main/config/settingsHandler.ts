import {
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdateRoute
} from '@shared/contracts/routes'
import { pickSettingsSnapshot, type SettingsRouteAdapter } from './settingsAdapter'

export class SettingsRouteHandler {
  constructor(private readonly adapter: SettingsRouteAdapter) {}

  getSnapshot(rawInput: unknown) {
    const input = settingsGetSnapshotRoute.input.parse(rawInput)
    const snapshot = this.adapter.readSnapshot()

    return settingsGetSnapshotRoute.output.parse({
      version: Date.now(),
      values: pickSettingsSnapshot(snapshot, input.keys)
    })
  }

  async listSystemFonts(rawInput: unknown) {
    settingsListSystemFontsRoute.input.parse(rawInput)

    return settingsListSystemFontsRoute.output.parse({
      fonts: await this.adapter.listSystemFonts()
    })
  }

  update(rawInput: unknown) {
    const input = settingsUpdateRoute.input.parse(rawInput)

    for (const change of input.changes) {
      this.adapter.applyChange(change)
    }

    const snapshot = this.adapter.readSnapshot()
    const changedKeys = input.changes.map((change) => change.key)

    return settingsUpdateRoute.output.parse({
      version: Date.now(),
      changedKeys,
      values: pickSettingsSnapshot(snapshot, changedKeys)
    })
  }
}

export function createSettingsRouteHandler(adapter: SettingsRouteAdapter): SettingsRouteHandler {
  return new SettingsRouteHandler(adapter)
}
