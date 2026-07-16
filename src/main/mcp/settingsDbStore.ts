import type { MCPServerConfig } from '@shared/presenter'
import type { SettingsTables } from '@/settings/data/tables/settingsTables'
import type { StoreLike } from '@/config/storeLike'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export class McpDbStore implements StoreLike<Record<string, unknown>> {
  constructor(private readonly getSettingsTables: () => SettingsTables) {}

  private get settingsTables(): SettingsTables {
    return this.getSettingsTables()
  }

  get store(): Record<string, unknown> {
    return {
      ...this.settingsTables.listMcpSettings(),
      mcpServers: this.settingsTables.listMcpServers()
    }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    if (key === 'mcpServers') {
      const servers = this.settingsTables.listMcpServers()
      return (Object.keys(servers).length > 0 ? servers : defaultValue) as TValue | undefined
    }
    const value = this.settingsTables.getMcpSetting<TValue>(key)
    return value === undefined ? defaultValue : value
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      for (const [key, nextValue] of Object.entries(keyOrValues)) this.set(key, nextValue)
      return
    }
    if (keyOrValues === 'mcpServers' && isRecord(value)) {
      this.settingsTables.replaceMcpServers(value as Record<string, MCPServerConfig>)
      return
    }
    this.settingsTables.setMcpSetting(keyOrValues, value)
  }

  delete(key: string): void {
    if (key === 'mcpServers') {
      this.settingsTables.replaceMcpServers({})
      return
    }
    this.settingsTables.deleteMcpSetting(key)
  }

  has(key: string): boolean {
    return key === 'mcpServers'
      ? Object.keys(this.settingsTables.listMcpServers()).length > 0
      : this.settingsTables.getMcpSetting(key) !== undefined
  }
}
