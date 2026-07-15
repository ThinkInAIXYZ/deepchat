import { app } from 'electron'
import path from 'path'
import type { SettingsStore } from '@/config/settingsStore'
import type { ScanCache } from '@shared/types/skillSync'
import type { SkillManagementState } from '@shared/types/skillManagement'

const SKILL_MANAGEMENT_STATE_KEY = 'skills.managementState'
const SKILL_SCAN_CACHE_KEY = 'skills.scanCache'

export interface SkillSettingsPort {
  isEnabled(): boolean
  isDraftSuggestionsEnabled(): boolean
  setDraftSuggestionsEnabled(enabled: boolean): void
  getPath(): string
  getManagementState(): SkillManagementState | null
  setManagementState(state: SkillManagementState): void
  getScanCache(): ScanCache | null
  setScanCache(cache: ScanCache): void
}

export class SkillSettings implements SkillSettingsPort {
  constructor(private readonly store: SettingsStore) {}

  isEnabled(): boolean {
    return this.store.get<boolean>('enableSkills') ?? true
  }

  isDraftSuggestionsEnabled(): boolean {
    return this.store.get<boolean>('skillDraftSuggestionsEnabled') ?? false
  }

  setDraftSuggestionsEnabled(enabled: boolean): void {
    this.store.set('skillDraftSuggestionsEnabled', Boolean(enabled))
  }

  getPath(): string {
    return (
      this.store.get<string>('skillsPath') || path.join(app.getPath('home'), '.deepchat', 'skills')
    )
  }

  getManagementState(): SkillManagementState | null {
    return this.store.get<SkillManagementState>(SKILL_MANAGEMENT_STATE_KEY) ?? null
  }

  setManagementState(state: SkillManagementState): void {
    this.store.set(SKILL_MANAGEMENT_STATE_KEY, state)
  }

  getScanCache(): ScanCache | null {
    return this.store.get<ScanCache>(SKILL_SCAN_CACHE_KEY) ?? null
  }

  setScanCache(cache: ScanCache): void {
    this.store.set(SKILL_SCAN_CACHE_KEY, cache)
  }
}
