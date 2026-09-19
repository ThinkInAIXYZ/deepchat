import type { ScanCache } from '@deepchat/shared/types/skillSync'
import type {
  SkillManagementState,
  StoredSkillManagementState
} from '@deepchat/shared/types/skillManagement'

/**
 * Skill management surface the built-in kernel needs. Declared here so kernel modules depend on
 * this structural port instead of the Desktop skill settings service; the host class implements
 * it.
 */
export interface SkillSettingsPort {
  isEnabled(): boolean
  isDraftSuggestionsEnabled(): boolean
  setDraftSuggestionsEnabled(enabled: boolean): void
  getPath(): string
  getManagementState(): StoredSkillManagementState | null
  setManagementState(state: SkillManagementState): void
  freezeLegacyMigrationTargets(
    agentIds: string[],
    legacySkillAllowLists?: Record<string, string[]>
  ): void
  getScanCache(): ScanCache | null
  setScanCache(cache: ScanCache): void
}
