import type { DeepchatEventName } from '@shared/contracts/events'
import type { SettingsStore } from '@/config/settingsStore'
import type { PrivacySettingsPort } from '@/app/privacy'
import { ProviderSettings } from '@/provider/settings'
import type { ProviderDatabase } from '@/provider/data/database'

/**
 * Builds the provider settings service.
 *
 * Extracted from `createComposition` so the Node sidecar builds the same
 * service against the same encrypted database. `publish` stays loose because the
 * Electron main process hands in a publisher that takes an unknown payload.
 */
export function createProviderSubsystem(deps: {
  store: SettingsStore
  privacy: PrivacySettingsPort
  database: ProviderDatabase
  publish: (name: DeepchatEventName, payload: unknown) => void
  previousAppVersion?: string
}): { providerSettings: ProviderSettings } {
  return {
    providerSettings: new ProviderSettings(
      deps.store,
      deps.privacy,
      deps.database,
      deps.publish,
      deps.previousAppVersion
    )
  }
}
