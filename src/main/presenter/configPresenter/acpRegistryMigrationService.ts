import type { IConfigPresenter, ISQLitePresenter } from '@shared/presenter'
import { ACP_LEGACY_AGENT_ID_ALIASES } from './acpRegistryConstants'

const ACP_REGISTRY_MIGRATION_VERSION = 1

type ModelSelection = {
  providerId: string
  modelId: string
}

const isModelSelection = (value: unknown): value is ModelSelection => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.providerId === 'string' && typeof record.modelId === 'string'
}

export class AcpRegistryMigrationService {
  constructor(
    private readonly configPresenter: IConfigPresenter,
    private readonly sqlitePresenter: ISQLitePresenter
  ) {}

  async runIfNeeded(): Promise<boolean> {
    const currentVersion =
      this.configPresenter.getSetting<number>('acpRegistryMigrationVersion') ?? 0
    if (currentVersion >= ACP_REGISTRY_MIGRATION_VERSION) {
      return false
    }

    this.migrateModelSetting('defaultModel')
    this.migrateModelSetting('preferredModel')
    await this.sqlitePresenter.migrateAcpAgentReferences(ACP_LEGACY_AGENT_ID_ALIASES)
    this.configPresenter.setSetting('acpRegistryMigrationVersion', ACP_REGISTRY_MIGRATION_VERSION)
    return true
  }

  async compensateEnabledRegistryAgentInstalls(): Promise<void> {
    const agents = await this.configPresenter.listAcpRegistryAgents()

    for (const agent of agents) {
      if (!agent.enabled) {
        continue
      }

      const status = agent.installState?.status ?? 'not_installed'
      if (status === 'installed' || status === 'installing') {
        continue
      }

      try {
        await this.configPresenter.ensureAcpAgentInstalled(agent.id)
      } catch (error) {
        console.warn(
          `[ACP] Failed to compensate install state for enabled registry agent ${agent.id}:`,
          error
        )
      }
    }
  }

  private migrateModelSetting(key: string): void {
    const value = this.configPresenter.getSetting<unknown>(key)
    if (!isModelSelection(value) || value.providerId !== 'acp') {
      return
    }

    const nextModelId = ACP_LEGACY_AGENT_ID_ALIASES[value.modelId] ?? value.modelId
    if (nextModelId === value.modelId) {
      return
    }

    this.configPresenter.setSetting(key, {
      providerId: value.providerId,
      modelId: nextModelId
    } satisfies ModelSelection)
  }
}
