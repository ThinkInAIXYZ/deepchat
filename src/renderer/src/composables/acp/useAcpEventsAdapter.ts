import { ACP_WORKSPACE_EVENTS } from '@/events'

type CommandsPayload = {
  conversationId?: string
  agentId?: string
  commands: { name: string; description?: string; input?: { hint: string } | null }[]
}

type ModesPayload = {
  conversationId?: string
  agentId?: string
  workdir?: string
  current: string
  available: { id: string; name: string; description: string }[]
}

type ModelsPayload = {
  conversationId?: string
  agentId?: string
  workdir?: string
  current: string
  available: { id: string; name: string; description?: string }[]
}

export function useAcpEventsAdapter() {
  const subscribeCommandsUpdate = (handler: (payload: CommandsPayload) => void) => {
    const listener = (_: unknown, payload: CommandsPayload) => {
      if (!payload) return
      handler(payload)
    }
    window.electron.ipcRenderer.on(ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE, listener)
    return () => {
      window.electron.ipcRenderer.removeListener(ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE, listener)
    }
  }

  const subscribeSessionModesReady = (handler: (payload: ModesPayload) => void) => {
    const listener = (_: unknown, payload: ModesPayload) => {
      if (!payload) return
      handler(payload)
    }
    window.electron.ipcRenderer.on(ACP_WORKSPACE_EVENTS.SESSION_MODES_READY, listener)
    return () => {
      window.electron.ipcRenderer.removeListener(ACP_WORKSPACE_EVENTS.SESSION_MODES_READY, listener)
    }
  }

  const subscribeSessionModelsReady = (handler: (payload: ModelsPayload) => void) => {
    const listener = (_: unknown, payload: ModelsPayload) => {
      if (!payload) return
      handler(payload)
    }
    window.electron.ipcRenderer.on(ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY, listener)
    return () => {
      window.electron.ipcRenderer.removeListener(
        ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY,
        listener
      )
    }
  }

  return {
    subscribeCommandsUpdate,
    subscribeSessionModesReady,
    subscribeSessionModelsReady
  }
}
