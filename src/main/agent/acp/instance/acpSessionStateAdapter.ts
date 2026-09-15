import type {
  DeepChatSessionState,
  PermissionMode,
  SessionAgentContextUpdate,
  SessionGenerationSettings
} from '@shared/types/agent-interface'
import type { SessionStatePort } from '@/session/data/contracts'
import type { SessionSettingsStore } from '@/session/data/settings'

/** ACP state seam over the host-owned session settings store. */
export class AcpSessionStateAdapter implements SessionStatePort {
  constructor(private readonly settings: SessionSettingsStore) {}

  async initSession(
    sessionId: string,
    config: Partial<SessionAgentContextUpdate> &
      Pick<SessionAgentContextUpdate, 'providerId' | 'modelId'>
  ): Promise<void> {
    if (this.settings.get(sessionId)) return
    this.settings.create(
      sessionId,
      config.providerId,
      config.modelId,
      config.permissionMode ?? 'default',
      config.generationSettings
    )
  }

  async destroySession(sessionId: string): Promise<void> {
    if (this.settings.get(sessionId)) this.settings.delete(sessionId)
  }

  async getSessionState(sessionId: string): Promise<DeepChatSessionState | null> {
    const row = this.settings.get(sessionId)
    if (!row) return null
    return {
      status: 'idle',
      providerId: row.provider_id,
      modelId: row.model_id,
      permissionMode: row.permission_mode
    }
  }

  async getSessionListState(sessionId: string): Promise<DeepChatSessionState | null> {
    return await this.getSessionState(sessionId)
  }

  async getPermissionMode(sessionId: string): Promise<PermissionMode> {
    const row = this.settings.get(sessionId)
    if (!row) throw new Error(`Session ${sessionId} not found`)
    return row.permission_mode
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    if (!this.settings.get(sessionId)) throw new Error(`Session ${sessionId} not found`)
    this.settings.updatePermissionMode(sessionId, mode)
  }

  async getGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    const row = this.settings.get(sessionId)
    if (!row) return null
    return this.settings.getGenerationSettings(sessionId) as SessionGenerationSettings
  }

  async updateGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    if (!this.settings.get(sessionId)) throw new Error(`Session ${sessionId} not found`)
    this.settings.updateGenerationSettings(sessionId, settings)
    return (this.settings.getGenerationSettings(sessionId) ?? {}) as SessionGenerationSettings
  }

  async setSessionProjectDir(_sessionId: string, _projectDir: string | null): Promise<void> {
    // Workdir is ACP runtime state; durable assignment remains owned by SessionAssignment.
  }
}
