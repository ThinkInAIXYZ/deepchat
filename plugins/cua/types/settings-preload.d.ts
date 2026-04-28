export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[]

export interface PluginRuntimeStatus {
  runtimeId: string
  displayName: string
  state: 'missing' | 'installed' | 'running' | 'error'
  command?: string
  version?: string
  lastError?: string
  checkedAt?: number
}

export interface PluginActionResult {
  ok: boolean
  data?: JsonValue
  error?: string
}

export interface DeepChatPluginSettingsApi {
  getPluginId(): string
  getStatus(): Promise<{
    pluginId: string
    enabled: boolean
    runtime?: PluginRuntimeStatus
  }>
  enable(): Promise<PluginActionResult>
  disable(): Promise<PluginActionResult>
  invokeAction(actionId: string, payload?: JsonValue): Promise<PluginActionResult>
}

declare global {
  interface Window {
    deepchatPlugin: DeepChatPluginSettingsApi
  }
}
