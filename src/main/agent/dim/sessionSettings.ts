import { dimDisabledTools } from '@shared/lib/nativeToolPreferences'
import type { JsonValue } from '@shared/contracts/json'
import type {
  PermissionMode,
  SessionAgentContextUpdate,
  SessionGenerationSettings
} from '@shared/types/agent-interface'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { SessionDatabase } from '@/session/data/database'
import { DesktopSessionState } from '@/session/desktopSessionState'
import { DimAgentProfiles } from './agentProfiles'
import { DimModelCatalog, dimModelParameters } from './modelCatalog'
import { DimSessionControls } from './sessionControls'
import type { DimScopeCreation } from './scopeTransitions'

interface SessionIdentity {
  name: string
  description: string
  cwd: string
  tools?: string[]
}
interface SettingsOptions {
  state: DesktopSessionState
  database: SessionDatabase
  profiles: DimAgentProfiles
  models: DimModelCatalog
  controls: DimSessionControls
  identity(sessionId: string): Promise<SessionIdentity>
  configurationChanged(sessionId: string): Promise<void>
}
interface NativePermission {
  version: number | string
  policy: { preset: string; allowedTools: string[]; disallowedTools: string[] }
}

/** Product preferences are adopted by dim's model, prompt and permission owners. */
export class DimSessionSettings {
  private readonly lanes = new Map<string, Promise<unknown>>()
  constructor(private readonly options: SettingsOptions) {}

  async launch(sessionId: string, historyOnly = false): Promise<JsonValue> {
    const row = this.require(sessionId)
    const generation = (await this.options.state.getGenerationSettings(sessionId))!
    const creation = await this.creation(sessionId)
    const model = await this.options.models[historyOnly ? 'registerForHistory' : 'admit'](
      row.provider_id,
      row.model_id,
      { timeout: generation.timeout, session: true }
    )
    return { ...creation, model: { ...model } }
  }

  /** Creation identity can be read for a data-only edit even when a provider is disabled. */
  async creation(sessionId: string): Promise<DimScopeCreation> {
    const row = this.require(sessionId)
    const generation = (await this.options.state.getGenerationSettings(sessionId))!
    const identity = await this.options.identity(sessionId)
    const agent = await this.options.profiles.ensure({
      name: identity.name,
      description: identity.description,
      systemPrompt: generation.systemPrompt,
      ...(identity.tools ? { tools: identity.tools } : {})
    })
    return {
      agent,
      cwd: identity.cwd,
      ...(identity.tools ? { tools: identity.tools } : {}),
      policy: {
        preset: preset(row.permission_mode),
        allowedTools: [],
        disallowedTools: this.disabledTools(sessionId)
      }
    }
  }

  prepare(binding: DimSessionBinding): Promise<void> {
    return this.run(binding.sessionId, () => this.adopt(binding))
  }

  private async adopt(binding: DimSessionBinding): Promise<void> {
    const sessionId = binding.sessionId
    const currentScope = () => this.assertCurrent(binding)
    currentScope()
    const row = this.require(sessionId)
    const generation = (await this.options.state.getGenerationSettings(sessionId))!
    const identity = await this.options.identity(sessionId)
    const ref = { sessionId: binding.dimSessionId, branchId: binding.branchId }
    const agentId = await this.options.profiles.ensure({
      name: identity.name,
      description: identity.description,
      systemPrompt: generation.systemPrompt,
      ...(identity.tools ? { tools: identity.tools } : {})
    })
    const adopted = await this.options.controls.call<{ agentId?: string }>('agent', ref)
    currentScope()
    if (adopted.agentId !== agentId)
      checkOutcome(await this.options.controls.call('set_agent', ref, { agentId }))
    const target = await this.options.models.admit(row.provider_id, row.model_id, {
      timeout: generation.timeout,
      session: true
    })
    const current = await this.options.controls.call<{ providerId: string; modelId: string }>(
      'native_settings',
      ref
    )
    currentScope()
    if (current.providerId !== target.providerId || current.modelId !== target.modelId)
      checkOutcome(await this.options.controls.call('set_model', ref, { ...target }))
    currentScope()
    const parameters = dimModelParameters(generation)
    let mediaOptions: JsonValue = {}
    if (target.modelId === `deepchat-media/${row.model_id}`) {
      const defaults = this.options.models.mediaSettings(row.provider_id, row.model_id)
      mediaOptions = {
        ...defaults,
        image: generation.imageGeneration
          ? JSON.parse(JSON.stringify(generation.imageGeneration))
          : defaults.image,
        video: generation.videoGeneration
          ? JSON.parse(JSON.stringify(generation.videoGeneration))
          : defaults.video
      }
    }
    await this.options.controls.call('native_configure', ref, {
      expectedModel: { ...target },
      replace: true,
      config: parameters as unknown as JsonValue,
      limits: { contextWindow: generation.contextLength, maxOutputTokens: generation.maxTokens },
      productPermissionMode: row.permission_mode,
      mediaOptions
    })
    await this.adoptPermission(binding)
  }

  refreshToolPreferences(sessionId: string): Promise<void> {
    return this.run(sessionId, async () => {
      const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
      if (binding) await this.adoptPermission(binding)
    })
  }

  private async adoptPermission(binding: DimSessionBinding): Promise<void> {
    this.assertCurrent(binding)
    const sessionId = binding.sessionId
    const row = this.require(sessionId)
    const ref = { sessionId: binding.dimSessionId, branchId: binding.branchId }
    const permission = await this.options.controls.call<NativePermission>('permission', ref)
    this.assertCurrent(binding)
    const desired = preset(row.permission_mode)
    const disallowedTools = this.disabledTools(sessionId)
    if (
      permission.policy.preset !== desired ||
      JSON.stringify(permission.policy.disallowedTools) !== JSON.stringify(disallowedTools)
    )
      await this.options.controls.call('set_permission', ref, {
        expectedVersion: String(permission.version),
        policy: {
          ...permission.policy,
          preset: desired,
          disallowedTools
        }
      })
    this.assertCurrent(binding)
  }

  initSession(
    sessionId: string,
    config: Partial<SessionAgentContextUpdate> &
      Pick<SessionAgentContextUpdate, 'providerId' | 'modelId'>
  ): Promise<void> {
    return this.run(sessionId, () => this.options.state.initSession(sessionId, config))
  }
  getPermissionMode(sessionId: string): Promise<PermissionMode> {
    return this.options.state.getPermissionMode(sessionId)
  }
  getGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    return this.options.state.getGenerationSettings(sessionId)
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    await this.run(sessionId, async () => {
      await this.options.state.setPermissionMode(sessionId, mode)
      await this.refresh(sessionId)
    })
  }
  async updateGenerationSettings(
    sessionId: string,
    patch: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    return this.run(sessionId, async () => {
      const settings = await this.options.state.updateGenerationSettings(sessionId, patch)
      await this.refresh(sessionId)
      return settings
    })
  }
  async setSessionModel(sessionId: string, providerId: string, modelId: string): Promise<void> {
    await this.run(sessionId, async () => {
      await this.setTarget(sessionId, providerId, modelId)
      await this.refresh(sessionId)
    })
  }
  async setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<void> {
    await this.run(sessionId, async () => {
      await this.options.state.setSessionProjectDir(sessionId, projectDir)
      // CWD and mount lists are creation-time configuration. This callback marks the
      // scope dirty; replacement runs outside this lane at the next admission boundary.
      await this.options.configurationChanged(sessionId)
    })
  }
  async setSessionAgentContext(
    sessionId: string,
    config: SessionAgentContextUpdate
  ): Promise<void> {
    await this.run(sessionId, async () => {
      await this.options.state.setSessionAgentContext(sessionId, config)
      await this.options.configurationChanged(sessionId)
      await this.refresh(sessionId)
    })
  }
  async applyTurnExecutionSnapshot(
    sessionId: string,
    snapshot: { providerId: string; modelId: string; generationSettings: SessionGenerationSettings }
  ): Promise<void> {
    await this.run(sessionId, async () => {
      await this.setTarget(sessionId, snapshot.providerId, snapshot.modelId)
      await this.options.state.updateGenerationSettings(sessionId, snapshot.generationSettings)
      await this.refresh(sessionId)
    })
  }
  private async refresh(sessionId: string): Promise<void> {
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (binding) await this.adopt(binding)
  }
  private async setTarget(sessionId: string, providerId: string, modelId: string): Promise<void> {
    this.require(sessionId)
    await this.options.models.admit(providerId, modelId)
    this.options.database.deepchatSessionsTable.updateSessionModel(sessionId, providerId, modelId)
  }
  private run<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const task = (this.lanes.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(operation)
    this.lanes.set(sessionId, task)
    void task
      .finally(() => {
        if (this.lanes.get(sessionId) === task) this.lanes.delete(sessionId)
      })
      .catch(() => {})
    return task
  }
  private assertCurrent(binding: DimSessionBinding): void {
    const current = this.options.database.dimSessionBindingsTable.get(binding.sessionId)
    if (
      !current ||
      current.dimSessionId !== binding.dimSessionId ||
      current.branchId !== binding.branchId ||
      current.generation !== binding.generation
    )
      throw new Error('Native configuration belongs to a replaced session scope')
  }

  private disabledTools(sessionId: string): string[] {
    return dimDisabledTools(this.options.database.newSessionsTable.getDisabledAgentTools(sessionId))
  }
  private require(sessionId: string) {
    const row = this.options.database.deepchatSessionsTable.get(sessionId)
    if (!row) throw new Error('Session is not initialized')
    return row
  }
}

function preset(mode: PermissionMode): string {
  return mode === 'full_access'
    ? 'full-access'
    : mode === 'auto_approve'
      ? 'workspace-write'
      : 'workspace-write'
}
function checkOutcome(reply: JsonValue): void {
  if (reply && typeof reply === 'object' && !Array.isArray(reply) && reply.outcome === 'superseded')
    throw new Error('Native session configuration was superseded')
}
