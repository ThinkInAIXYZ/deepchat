import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  terminalExitEvent,
  terminalOutputEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import {
  terminalAttachRoute,
  terminalInputRoute,
  terminalKillRoute,
  terminalResizeRoute,
  terminalRestartRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export interface TerminalOpenInput {
  sessionId: string
  cols: number
  rows: number
  draftWorkdir?: string
}

export function createTerminalClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  const attach = (input: TerminalOpenInput) => bridge.invoke(terminalAttachRoute.name, input)

  const restart = (input: TerminalOpenInput) => bridge.invoke(terminalRestartRoute.name, input)

  const sendInput = (terminalId: string, data: string) =>
    bridge.invoke(terminalInputRoute.name, { terminalId, data })

  const resize = (terminalId: string, cols: number, rows: number) =>
    bridge.invoke(terminalResizeRoute.name, { terminalId, cols, rows })

  const kill = (terminalId: string) => bridge.invoke(terminalKillRoute.name, { terminalId })

  const onOutput = (
    listener: (payload: DeepchatEventPayload<typeof terminalOutputEvent.name>) => void
  ) => bridge.on(terminalOutputEvent.name, listener)

  const onExit = (
    listener: (payload: DeepchatEventPayload<typeof terminalExitEvent.name>) => void
  ) => bridge.on(terminalExitEvent.name, listener)

  return { attach, restart, sendInput, resize, kill, onOutput, onExit }
}

export type TerminalClient = ReturnType<typeof createTerminalClient>
