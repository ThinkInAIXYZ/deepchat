import { MCP_EVENTS } from '@/events'
import type { McpSamplingDecision, McpSamplingRequestPayload, MCPConfig } from '@shared/presenter'

type ConfigChangedPayload = {
  mcpServers: MCPConfig['mcpServers']
  defaultServers: string[]
  mcpEnabled: boolean
}

type Unsubscribe = () => void

const subscribeEvent = <T>(
  event: string,
  handler: (payload: T) => void,
  transform?: (...args: unknown[]) => T
): Unsubscribe => {
  const listener = (...args: unknown[]) => {
    const payload = transform ? transform(...args) : (args[1] as T)
    handler(payload)
  }

  window.electron.ipcRenderer.on(event, listener)

  return () => {
    window.electron.ipcRenderer.removeListener(event, listener)
  }
}

export function useMcpEventsAdapter() {
  const subscribeServerStarted = (handler: (serverName: string) => void): Unsubscribe => {
    return subscribeEvent<string>(MCP_EVENTS.SERVER_STARTED, handler, (_event, serverName) => {
      return String(serverName)
    })
  }

  const subscribeServerStopped = (handler: (serverName: string) => void): Unsubscribe => {
    return subscribeEvent<string>(MCP_EVENTS.SERVER_STOPPED, handler, (_event, serverName) => {
      return String(serverName)
    })
  }

  const subscribeConfigChanged = (
    handler: (payload?: ConfigChangedPayload) => void
  ): Unsubscribe => {
    return subscribeEvent<ConfigChangedPayload | undefined>(
      MCP_EVENTS.CONFIG_CHANGED,
      handler,
      (_event, payload) => payload as ConfigChangedPayload | undefined
    )
  }

  const subscribeServerStatusChanged = (
    handler: (payload: { serverName: string; isRunning: boolean }) => void
  ): Unsubscribe => {
    return subscribeEvent<{ serverName: string; isRunning: boolean }>(
      MCP_EVENTS.SERVER_STATUS_CHANGED,
      handler,
      (_event, serverName, isRunning) => ({
        serverName: String(serverName),
        isRunning: Boolean(isRunning)
      })
    )
  }

  const subscribeSamplingRequest = (
    handler: (payload: McpSamplingRequestPayload) => void
  ): Unsubscribe => {
    return subscribeEvent<McpSamplingRequestPayload>(
      MCP_EVENTS.SAMPLING_REQUEST,
      handler,
      (_event, payload) => payload as McpSamplingRequestPayload
    )
  }

  const subscribeSamplingCancelled = (handler: (requestId: string) => void): Unsubscribe => {
    return subscribeEvent<string>(MCP_EVENTS.SAMPLING_CANCELLED, handler, (_event, payload) =>
      String(payload)
    )
  }

  const subscribeSamplingDecision = (
    handler: (payload: McpSamplingDecision) => void
  ): Unsubscribe => {
    return subscribeEvent<McpSamplingDecision>(
      MCP_EVENTS.SAMPLING_DECISION,
      handler,
      (_event, payload) => payload as McpSamplingDecision
    )
  }

  const subscribeCustomPromptsChanged = (handler: () => void): Unsubscribe => {
    return subscribeEvent<void>('config:custom-prompts-changed', handler, () => undefined)
  }

  return {
    subscribeServerStarted,
    subscribeServerStopped,
    subscribeConfigChanged,
    subscribeServerStatusChanged,
    subscribeSamplingRequest,
    subscribeSamplingCancelled,
    subscribeSamplingDecision,
    subscribeCustomPromptsChanged
  }
}
