import type { SessionStatePort } from './data/contracts'
import type { SessionDatabase } from './data/database'
import type { ProviderModelResolutionPort } from '@/provider/settings'
import type { PromptSettingsPort } from '@/agent/promptSettings'
import type {
  DeepChatSessionState,
  SessionAgentContextUpdate,
  SessionGenerationSettings,
  PermissionMode
} from '@shared/types/agent-interface'
import {
  resolveSessionGenerationSettings,
  sanitizeGenerationSettings,
  buildPersistedGenerationSettingsPatch,
  buildPersistedGenerationSettingsReplacement
} from '@/agent/shared/generationSettings'

export interface DesktopSessionStateOptions {
  database: SessionDatabase
  providerSettings: ProviderModelResolutionPort
  promptSettings: PromptSettingsPort
}

/** Product settings and identity, shared by ACP and dim. This class cannot execute an agent. */
export class DesktopSessionState implements SessionStatePort {
  constructor(private readonly options: DesktopSessionStateOptions) {}

  async initSession(
    sessionId: string,
    config: Partial<SessionAgentContextUpdate> &
      Pick<SessionAgentContextUpdate, 'providerId' | 'modelId'>
  ): Promise<void> {
    const settings = await sanitizeGenerationSettings(
      this.options.providerSettings,
      this.options.promptSettings,
      config.providerId,
      config.modelId,
      config.generationSettings ?? {}
    )
    this.options.database.getDatabase().transaction(() => {
      this.options.database.deepchatSessionsTable.create(
        sessionId,
        config.providerId,
        config.modelId,
        config.permissionMode ?? 'default',
        settings
      )
      if (config.projectDir !== undefined)
        this.options.database.newSessionsTable.update(sessionId, {
          project_dir: config.projectDir?.trim() || null
        })
    })()
  }

  async destroySession(sessionId: string): Promise<void> {
    this.options.database.deepchatSessionsTable.delete(sessionId)
  }

  async getSessionState(sessionId: string): Promise<DeepChatSessionState | null> {
    const row = this.options.database.deepchatSessionsTable.get(sessionId)
    if (!row) return null
    return {
      providerId: row.provider_id,
      modelId: row.model_id,
      permissionMode: row.permission_mode,
      status: this.options.database.dimSessionBindingsTable.get(sessionId)?.status ?? 'idle'
    }
  }

  getSessionListState(sessionId: string): Promise<DeepChatSessionState | null> {
    return this.getSessionState(sessionId)
  }

  async getPermissionMode(sessionId: string): Promise<PermissionMode> {
    return this.require(sessionId).permission_mode
  }
  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    this.require(sessionId)
    this.options.database.deepchatSessionsTable.updatePermissionMode(sessionId, mode)
  }
  async getGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    if (!this.options.database.deepchatSessionsTable.get(sessionId)) return null
    return resolveSessionGenerationSettings(
      {
        providerSettings: this.options.providerSettings,
        promptSettings: this.options.promptSettings,
        readPersisted: () => this.options.database.deepchatSessionsTable.get(sessionId)
      },
      sessionId
    )
  }
  async updateGenerationSettings(
    sessionId: string,
    patch: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    const row = this.require(sessionId)
    const base = await this.getGenerationSettings(sessionId)
    const settings = await sanitizeGenerationSettings(
      this.options.providerSettings,
      this.options.promptSettings,
      row.provider_id,
      row.model_id,
      patch,
      base ?? undefined
    )
    // A slow settings lookup must not recreate a session or overwrite a concurrent model switch.
    const current = this.require(sessionId)
    if (current.provider_id !== row.provider_id || current.model_id !== row.model_id)
      throw new Error('Session model changed while updating generation settings')
    this.options.database.deepchatSessionsTable.updateGenerationSettings(
      sessionId,
      buildPersistedGenerationSettingsPatch(patch, settings)
    )
    return settings
  }
  async setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<void> {
    this.require(sessionId)
    this.options.database.newSessionsTable.update(sessionId, {
      project_dir: projectDir?.trim() || null
    })
  }

  private require(sessionId: string) {
    const row = this.options.database.deepchatSessionsTable.get(sessionId)
    if (!row) throw new Error(`Session ${sessionId} not found`)
    return row
  }

  async setSessionAgentContext(
    sessionId: string,
    config: SessionAgentContextUpdate
  ): Promise<void> {
    this.require(sessionId)
    if (this.options.database.dimSessionBindingsTable.get(sessionId)?.status === 'generating')
      throw new Error('Cannot move a session while it is generating')
    const settings = await sanitizeGenerationSettings(
      this.options.providerSettings,
      this.options.promptSettings,
      config.providerId,
      config.modelId,
      config.generationSettings ?? {}
    )
    this.options.database.getDatabase().transaction(() => {
      this.require(sessionId)
      if (this.options.database.dimSessionBindingsTable.get(sessionId)?.status === 'generating')
        throw new Error('Cannot move a session while it is generating')
      this.options.database.deepchatSessionsTable.updateSessionModel(
        sessionId,
        config.providerId,
        config.modelId
      )
      this.options.database.deepchatSessionsTable.updatePermissionMode(
        sessionId,
        config.permissionMode
      )
      this.options.database.deepchatSessionsTable.updateGenerationSettings(
        sessionId,
        buildPersistedGenerationSettingsReplacement(settings)
      )
      if (config.projectDir !== undefined)
        this.options.database.newSessionsTable.update(sessionId, {
          project_dir: config.projectDir?.trim() || null
        })
    })()
  }
}
