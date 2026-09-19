import type { JsonValue } from '@deepchat/shared/contracts/common'
import type { PluginActionResult, PluginSettingsApiStatus } from '@deepchat/shared/types/plugin'

export interface DeepChatPluginSettingsApi {
  getPluginId(): string
  getStatus(): Promise<PluginSettingsApiStatus>
  enable(): Promise<PluginActionResult>
  disable(): Promise<PluginActionResult>
  invokeAction(actionId: string, payload?: JsonValue): Promise<PluginActionResult>
}

declare global {
  interface Window {
    deepchatPlugin: DeepChatPluginSettingsApi
  }
}
