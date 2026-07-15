import type { ConfigServicePort, ISQLitePresenter } from '@shared/presenter'
import { ACP_LEGACY_AGENT_ID_ALIASES } from '@shared/utils/acpAgentAlias'

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
    private readonly configService: ConfigServicePort,
    private readonly sqlitePresenter: ISQLitePresenter
  ) {}

  async runIfNeeded(): Promise<boolean> {
    const currentVersion = this.configService.getSetting<number>('acpRegistryMigrationVersion') ?? 0
    if (currentVersion >= ACP_REGISTRY_MIGRATION_VERSION) {
      return false
    }

    this.migrateModelSetting('defaultModel')
    this.migrateModelSetting('preferredModel')
    await this.sqlitePresenter.migrateAcpAgentReferences(ACP_LEGACY_AGENT_ID_ALIASES)
    this.configService.setSetting('acpRegistryMigrationVersion', ACP_REGISTRY_MIGRATION_VERSION)
    return true
  }

  async compensateEnabledRegistryAgentInstalls(): Promise<void> {
    const agents = await this.configService.listAcpRegistryAgents()

    for (const agent of agents) {
      if (!agent.enabled) {
        continue
      }

      const status = agent.installState?.status ?? 'not_installed'
      if (status === 'installed') {
        continue
      }

      try {
        await this.configService.ensureAcpAgentInstalled(agent.id)
      } catch (error) {
        console.warn(
          `[ACP] Failed to compensate install state for enabled registry agent ${agent.id}:`,
          error
        )
      }
    }
  }

  private migrateModelSetting(key: string): void {
    const value = this.configService.getSetting<unknown>(key)
    if (!isModelSelection(value) || value.providerId !== 'acp') {
      return
    }

    const nextModelId = ACP_LEGACY_AGENT_ID_ALIASES[value.modelId] ?? value.modelId
    if (nextModelId === value.modelId) {
      return
    }

    this.configService.setSetting(key, {
      providerId: value.providerId,
      modelId: nextModelId
    } satisfies ModelSelection)
  }
}
