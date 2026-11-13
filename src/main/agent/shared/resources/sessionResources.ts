import type { AppSessionId } from '../agentSessionIds'
import type { DeepChatSessionState } from '@shared/types/agent-interface'
import type { MCPToolDefinition } from '@shared/types/core/mcp'

export type SessionToolProfileKind = 'code' | 'research' | 'analysis' | 'general'
export interface SessionToolProfileCacheEntry {
  readonly profile: SessionToolProfileKind
  readonly fingerprint: string
  readonly tools: MCPToolDefinition[]
}

/** Desktop resource selection only. No generation, model, queue or tool executor state. */
export class SessionResources {
  private runtimeState?: DeepChatSessionState
  private agentId?: string
  private projectDir?: string | null
  private readonly runtimeActivatedSkills = new Set<string>()
  private toolProfileCache?: SessionToolProfileCacheEntry
  private toolProfileRevisionToken = Symbol('session-tool-profile-revision')
  constructor(readonly sessionId: AppSessionId) {}
  getRuntimeState(): DeepChatSessionState | undefined {
    return this.runtimeState
  }

  setRuntimeState(state: DeepChatSessionState): void {
    this.runtimeState = state
  }

  getAgentId(): string | undefined {
    return this.agentId
  }

  setAgentId(agentId: string): void {
    this.agentId = agentId
  }

  hasProjectDir(): boolean {
    return this.projectDir !== undefined
  }

  getProjectDir(): string | null {
    return this.projectDir ?? null
  }

  setProjectDir(projectDir: string | null): void {
    this.projectDir = projectDir
  }

  replaceRuntimeActivatedSkills(skillNames: readonly string[]): void {
    this.runtimeActivatedSkills.clear()
    for (const skillName of skillNames) {
      const normalized = skillName.trim()
      if (normalized) this.runtimeActivatedSkills.add(normalized)
    }
  }

  getRuntimeActivatedSkills(): string[] {
    return [...this.runtimeActivatedSkills].sort((left, right) => left.localeCompare(right))
  }

  activateRuntimeSkill(skillName: string): string[] {
    const normalized = skillName.trim()
    if (!normalized) return this.getRuntimeActivatedSkills()

    this.runtimeActivatedSkills.add(normalized)
    this.invalidateToolProfileCache()
    return this.getRuntimeActivatedSkills()
  }

  getToolProfileCache(): SessionToolProfileCacheEntry | undefined {
    return this.toolProfileCache
  }

  setToolProfileCache(entry: SessionToolProfileCacheEntry): void {
    this.toolProfileCache = entry
  }

  getToolProfileRevisionToken(): symbol {
    return this.toolProfileRevisionToken
  }

  invalidateToolProfileCache(): void {
    this.toolProfileCache = undefined
    this.toolProfileRevisionToken = Symbol('session-tool-profile-revision')
  }
}

export type SessionResourceHandle = Pick<SessionResources, keyof SessionResources>
