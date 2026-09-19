interface DeepChatPluginSettingsApi {
  getPluginId(): string
  getStatus(): Promise<{
    pluginId: string
    enabled: boolean
    runtime?: import('../../../src/shared/types/plugin').PluginRuntimeStatus
    mcpServers?: import('../../../src/shared/types/plugin').PluginMcpRuntimeStatus[]
  }>
  enable(): Promise<import('../../../src/shared/types/plugin').PluginActionResult>
  disable(): Promise<import('../../../src/shared/types/plugin').PluginActionResult>
  invokeAction(
    actionId: string,
    payload?: unknown
  ): Promise<import('../../../src/shared/types/plugin').PluginActionResult>
}

interface Window {
  deepchatPlugin?: DeepChatPluginSettingsApi
}
