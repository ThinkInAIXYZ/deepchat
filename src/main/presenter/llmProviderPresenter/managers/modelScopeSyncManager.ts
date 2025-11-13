import {
  IConfigPresenter,
  ModelScopeMcpSyncOptions,
  ModelScopeMcpSyncResult
} from '@shared/presenter'
import { BaseLLMProvider } from '../baseProvider'

interface ModelScopeSyncManagerOptions {
  configPresenter: IConfigPresenter
  getProviderInstance: (providerId: string) => BaseLLMProvider
}

export class ModelScopeSyncManager {
  constructor(private readonly options: ModelScopeSyncManagerOptions) {}

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

    if (provider.constructor.name !== 'ModelscopeProvider') {
      const error = 'Provider is not a ModelScope provider instance'
      console.error(`[ModelScope MCP Sync] Error: ${error}`)
      throw new Error(error)
    }

    const result: ModelScopeMcpSyncResult = {
      imported: 0,
      skipped: 0,
      errors: []
    }

    try {
      const syncTask = async () => {
        console.log(`[ModelScope MCP Sync] Fetching MCP servers from ModelScope API...`)

        const modelscopeProvider = provider as any
        const mcpResponse = await modelscopeProvider.syncMcpServers(syncOptions)

        if (!mcpResponse || !mcpResponse.success || !mcpResponse.data?.mcp_server_list) {
          const errorMsg = 'Invalid response from ModelScope MCP API'
          console.error(`[ModelScope MCP Sync] ${errorMsg}`, mcpResponse)
          result.errors.push(errorMsg)
          return result
        }

        const mcpServers = mcpResponse.data.mcp_server_list
        console.log(`[ModelScope MCP Sync] Fetched ${mcpServers.length} MCP servers from API`)

        const convertedServers = mcpServers
          .map((server: any) => {
            try {
              if (!server.operational_urls || server.operational_urls.length === 0) {
                const errorMsg = `No operational URLs found for server ${server.id}`
                console.warn(`[ModelScope MCP Sync] ${errorMsg}`)
                result.errors.push(errorMsg)
                return null
              }

              const modelscopeProviderInstance = provider as any
              const converted = modelscopeProviderInstance.convertMcpServerToConfig(server)

              console.log(
                `[ModelScope MCP Sync] Converted operational server: ${converted.displayName} (${converted.name})`
              )
              return converted
            } catch (conversionError) {
              const errorMsg = `Failed to convert server ${server.name || server.id}: ${conversionError instanceof Error ? conversionError.message : String(conversionError)}`
              console.error(`[ModelScope MCP Sync] ${errorMsg}`)
              result.errors.push(errorMsg)
              return null
            }
          })
          .filter((server: any) => server !== null) as any[]

        console.log(
          `[ModelScope MCP Sync] Successfully converted ${convertedServers.length} servers`
        )

        for (const serverConfig of convertedServers) {
          try {
            const existingServers = await this.options.configPresenter.getMcpServers()

            if (existingServers[serverConfig.name]) {
              console.log(
                `[ModelScope MCP Sync] Server ${serverConfig.name} already exists, skipping`
              )
              result.skipped++
              continue
            }

            const success = await this.options.configPresenter.addMcpServer(
              serverConfig.name,
              serverConfig
            )
            if (success) {
              console.log(
                `[ModelScope MCP Sync] Successfully imported server: ${serverConfig.name}`
              )
              result.imported++
            } else {
              const errorMsg = `Failed to add server ${serverConfig.name} to configuration`
              console.error(`[ModelScope MCP Sync] ${errorMsg}`)
              result.errors.push(errorMsg)
            }
          } catch (importError) {
            const errorMsg = `Failed to import server ${serverConfig.name}: ${importError instanceof Error ? importError.message : String(importError)}`
            console.error(`[ModelScope MCP Sync] ${errorMsg}`)
            result.errors.push(errorMsg)
          }
        }

        console.log(
          `[ModelScope MCP Sync] Sync completed. Imported: ${result.imported}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`
        )
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
