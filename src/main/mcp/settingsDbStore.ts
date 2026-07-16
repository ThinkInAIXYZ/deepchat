import type { MCPServerConfig } from '@shared/presenter'
import type { ConfigTables } from '@/settings/data/tables/configTables'
import type { StoreLike } from '@/config/storeLike'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export class McpDbStore implements StoreLike<Record<string, unknown>> {
  constructor(private readonly getConfigTables: () => ConfigTables) {}

  private get configTables(): ConfigTables {
    return this.getConfigTables()
  }

  get store(): Record<string, unknown> {
    return {
      ...this.configTables.listMcpSettings(),
      mcpServers: this.configTables.listMcpServers()
    }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    if (key === 'mcpServers') {
      const servers = this.configTables.listMcpServers()
      return (Object.keys(servers).length > 0 ? servers : defaultValue) as TValue | undefined
    }
    const value = this.configTables.getMcpSetting<TValue>(key)
    return value === undefined ? defaultValue : value
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      for (const [key, nextValue] of Object.entries(keyOrValues)) this.set(key, nextValue)
      return
    }
    if (keyOrValues === 'mcpServers' && isRecord(value)) {
      this.configTables.replaceMcpServers(value as Record<string, MCPServerConfig>)
      return
    }
    this.configTables.setMcpSetting(keyOrValues, value)
  }

  delete(key: string): void {
    if (key === 'mcpServers') {
      this.configTables.replaceMcpServers({})
      return
    }
    this.configTables.deleteMcpSetting(key)
  }

  has(key: string): boolean {
    return key === 'mcpServers'
      ? Object.keys(this.configTables.listMcpServers()).length > 0
      : this.configTables.getMcpSetting(key) !== undefined
  }
}
