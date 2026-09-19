import type { SettingsStore } from '@/config/settingsStore'
import type { McpSettings } from '@/mcp/settings'
import type { BuiltinKnowledgeConfig } from '@shared/types/knowledge'

export class KnowledgeSettings {
  constructor(
    private readonly settings: SettingsStore,
    private readonly mcpSettings: McpSettings
  ) {}

  getKnowledgeConfigs(): BuiltinKnowledgeConfig[] {
    const configs = this.settings.get<BuiltinKnowledgeConfig[]>('knowledgeConfigs') || []
    const migrated = this.mcpSettings.migrateBuiltinKnowledgeConfigsFromEnv(configs)
    if (migrated !== configs) this.settings.set('knowledgeConfigs', migrated)
    return migrated
  }

  setKnowledgeConfigs(configs: BuiltinKnowledgeConfig[]): void {
    this.settings.set('knowledgeConfigs', configs)
  }
}
