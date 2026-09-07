import { app } from 'electron'
import path from 'path'
import type { SettingsStore } from '@/config/settingsStore'
import type { ScanCache } from '@shared/types/skillSync'
import type {
  SkillManagementState,
  StoredSkillManagementState
} from '@shared/types/skillManagement'
import { BUILTIN_SKILL_AGENT_ID } from './agentSkillRoots'

const SKILL_MANAGEMENT_STATE_KEY = 'skills.managementState'
const SKILL_SCAN_CACHE_KEY = 'skills.scanCache'

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

  getManagementState(): StoredSkillManagementState | null {
    return this.store.get<StoredSkillManagementState>(SKILL_MANAGEMENT_STATE_KEY) ?? null
  }

  setManagementState(state: SkillManagementState): void {
    this.store.set(SKILL_MANAGEMENT_STATE_KEY, state)
  }

  freezeLegacyMigrationTargets(
    agentIds: string[],
    legacySkillAllowLists: Record<string, string[]> = {}
  ): void {
    const stored = this.getManagementState()
    if (stored?.version === 3) return
    if (stored?.migration?.targetAgentIds) return

    const targetAgentIds = Array.from(
      new Set(agentIds.filter((agentId) => agentId && agentId !== BUILTIN_SKILL_AGENT_ID))
    ).sort()
    const migration = {
      ...stored?.migration,
      targetAgentIds,
      completedAgentIds: [...(stored?.migration?.completedAgentIds ?? [])],
      legacySkillAllowLists: Object.fromEntries(
        targetAgentIds.flatMap((agentId) => {
          const names = legacySkillAllowLists[agentId]
          return Array.isArray(names)
            ? [
                [
                  agentId,
                  Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))).sort(
                    (left, right) => left.localeCompare(right)
                  )
                ] as const
              ]
            : []
        })
      )
    }
    const nextState: StoredSkillManagementState = stored
      ? { ...stored, migration }
      : {
          version: 2,
          agents: { [BUILTIN_SKILL_AGENT_ID]: { skills: {} } },
          migration
        }
    this.store.set(SKILL_MANAGEMENT_STATE_KEY, nextState)
  }

  getScanCache(): ScanCache | null {
    return this.store.get<ScanCache>(SKILL_SCAN_CACHE_KEY) ?? null
  }

  setScanCache(cache: ScanCache): void {
    this.store.set(SKILL_SCAN_CACHE_KEY, cache)
  }
}
