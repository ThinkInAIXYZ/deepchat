import type { SettingsStore } from '@/config/settingsStore'

export interface PrivacySettingsPort {
  isEnabled(): boolean
  setEnabled(enabled: boolean): void
}

export class PrivacySettings implements PrivacySettingsPort {
  constructor(private readonly store: SettingsStore) {}

  isEnabled(): boolean {
    return this.store.get<boolean>('privacyModeEnabled') ?? false
  }

  setEnabled(enabled: boolean): void {
    this.store.set('privacyModeEnabled', Boolean(enabled))
  }
}
