import type { IConversationExporter } from './interface'
import type { IConfigPresenter, NowledgeMemConfig } from '@shared/presenter'
import { NowledgeMemPresenter } from '../nowledgeMemPresenter'

interface ExporterDependencies {
  configPresenter: IConfigPresenter
}

export class ConversationExporterService implements IConversationExporter {
  private readonly nowledgeMemPresenter: NowledgeMemPresenter

  constructor(deps: ExporterDependencies) {
    this.nowledgeMemPresenter = new NowledgeMemPresenter(deps.configPresenter)
  }

  async testNowledgeMemConnection(): Promise<{
    success: boolean
    message?: string
    error?: string
  }> {
    try {
      const result = await this.nowledgeMemPresenter.testConnection()
      return {
        success: result.success,
        message: result.success ? 'Connection successful' : undefined,
        error: result.error || undefined
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed'
      }
    }
  }

  async updateNowledgeMemConfig(config: Partial<NowledgeMemConfig>): Promise<void> {
    await this.nowledgeMemPresenter.updateConfig(config)
  }

  getNowledgeMemConfig() {
    return this.nowledgeMemPresenter.getConfig()
  }
}
