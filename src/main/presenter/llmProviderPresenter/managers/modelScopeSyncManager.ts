import {
  IConfigPresenter,
  MCPServerConfig,
  ModelScopeMcpSyncOptions,
  ModelScopeMcpSyncResult
} from '@shared/presenter'
import { BaseLLMProvider } from '../baseProvider'
import { ModelscopeProvider, ModelScopeMcpServer } from '../providers/modelscopeProvider'

interface ModelScopeSyncManagerOptions {
  configPresenter: IConfigPresenter
  getProviderInstance: (providerId: string) => BaseLLMProvider
}

export class ModelScopeSyncManager {
  constructor(private readonly options: ModelScopeSyncManagerOptions) {}

  private isModelscopeProvider(provider: BaseLLMProvider): provider is ModelscopeProvider {
    return (
      typeof (provider as Partial<ModelscopeProvider>).syncMcpServers === 'function' &&
      typeof (provider as Partial<ModelscopeProvider>).convertMcpServerToConfig === 'function'
    )
  }

  async syncModelScopeMcpServers(
    providerId: string,
    syncOptions?: ModelScopeMcpSyncOptions
  ): Promise<ModelScopeMcpSyncResult> {
    console.log(`[ModelScope MCP Sync] Starting sync for provider: ${providerId}`)
    console.log(`[ModelScope MCP Sync] Sync options:`, syncOptions)

    if (providerId !== 'modelscope') {
      const error = 'MCP sync is only supported for ModelScope provider'
      console.error(`[ModelScope MCP Sync] Error: ${error}`)
      throw new Error(error)
    }

    const provider = this.options.getProviderInstance(providerId)

    if (!this.isModelscopeProvider(provider)) {
      const error = 'Provider is not a ModelScope provider instance'
      console.error(`[ModelScope MCP Sync] Error: ${error}`)
      throw new Error(error)
    }

    const result: ModelScopeMcpSyncResult = {
      success: false,
      message: '',
      synced: 0,
      imported: 0,
      skipped: 0,
      errors: []
    }

    try {
      const syncTask = async () => {
        console.log(`[ModelScope MCP Sync] Fetching MCP servers from ModelScope API...`)

        const mcpResponse = await provider.syncMcpServers(syncOptions)

        if (!mcpResponse || !mcpResponse.success || !mcpResponse.data?.mcp_server_list) {
          const errorMsg = 'Invalid response from ModelScope MCP API'
          console.error(`[ModelScope MCP Sync] ${errorMsg}`, mcpResponse)
          result.errors.push(errorMsg)
          return result
        }

        const mcpServers = mcpResponse.data.mcp_server_list as ModelScopeMcpServer[]
        console.log(`[ModelScope MCP Sync] Fetched ${mcpServers.length} MCP servers from API`)

        interface ConvertedServer {
          name: string
          displayName: string
          config: MCPServerConfig
        }

        const convertedServers = mcpServers
          .map<ConvertedServer | null>((server) => {
            try {
              if (!server.operational_urls || server.operational_urls.length === 0) {
                const errorMsg = `No operational URLs found for server ${server.id}`
                console.warn(`[ModelScope MCP Sync] ${errorMsg}`)
                result.errors.push(errorMsg)
                return null
              }

              const config = provider.convertMcpServerToConfig(server)

              const name = server.name || server.id
              const displayName = server.chinese_name || server.name || server.id

              console.log(
                `[ModelScope MCP Sync] Converted operational server: ${displayName} (${name})`
              )
              return { name, displayName, config }
            } catch (conversionError) {
              const errorMsg = `Failed to convert server ${server.name || server.id}: ${conversionError instanceof Error ? conversionError.message : String(conversionError)}`
              console.error(`[ModelScope MCP Sync] ${errorMsg}`)
              result.errors.push(errorMsg)
              return null
            }
          })
          .filter((entry): entry is ConvertedServer => entry !== null)

        console.log(
          `[ModelScope MCP Sync] Successfully converted ${convertedServers.length} servers`
        )

        for (const serverEntry of convertedServers) {
          try {
            const existingServers = await this.options.configPresenter.getMcpServers()
            const serverName = serverEntry.name

            if (existingServers[serverName]) {
              console.log(`[ModelScope MCP Sync] Server ${serverName} already exists, skipping`)
              result.skipped++
              continue
            }

            const success = await this.options.configPresenter.addMcpServer(
              serverName,
              serverEntry.config
            )
            if (success) {
              console.log(
                `[ModelScope MCP Sync] Successfully imported server: ${serverEntry.displayName}`
              )
              result.imported++
            } else {
              const errorMsg = `Failed to add server ${serverName} to configuration`
              console.error(`[ModelScope MCP Sync] ${errorMsg}`)
              result.errors.push(errorMsg)
            }
          } catch (importError) {
            const errorMsg = `Failed to import server ${serverEntry.name}: ${importError instanceof Error ? importError.message : String(importError)}`
            console.error(`[ModelScope MCP Sync] ${errorMsg}`)
            result.errors.push(errorMsg)
          }
        }

        console.log(
          `[ModelScope MCP Sync] Sync completed. Imported: ${result.imported}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`
        )
        result.synced = result.imported + result.skipped
        result.success = result.errors.length === 0
        result.message = result.success
          ? 'ModelScope MCP servers synced successfully'
          : 'ModelScope MCP sync completed with errors'
        return result
      }

      return await syncTask()
    } catch (error) {
      const errorMsg = `ModelScope MCP sync failed: ${error instanceof Error ? error.message : String(error)}`
      console.error(`[ModelScope MCP Sync] ${errorMsg}`)
      result.errors.push(errorMsg)
      return result
    }
  }
}
