import { MCP_EVENTS } from '@/events'
import type { MCPToolResponse } from '@shared/presenter'

type ToolCallResultPayload = MCPToolResponse & {
  function_name?: string
}

type ToolCallResultHandler = (payload: ToolCallResultPayload) => void

/**
 * MCP tooling adapter for tool-call result subscriptions.
 */
export function useMcpToolingAdapter() {
  const subscribeToolResults = (handler: ToolCallResultHandler) => {
    const listener = (_: unknown, payload: ToolCallResultPayload) => {
      if (!payload) return
      handler(payload)
    }

    window.electron.ipcRenderer.on(MCP_EVENTS.TOOL_CALL_RESULT, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(MCP_EVENTS.TOOL_CALL_RESULT, listener)
    }
  }

  return {
    subscribeToolResults
  }
}
