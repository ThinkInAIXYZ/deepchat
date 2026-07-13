import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  acpTerminalErrorEvent,
  acpTerminalExitedEvent,
  acpTerminalExternalDependenciesRequiredEvent,
  acpTerminalOutputEvent,
  acpTerminalStartedEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import { acpTerminalInputRoute, acpTerminalKillRoute } from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createAcpTerminalClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function sendInput(data: string) {
    const result = await bridge.invoke(acpTerminalInputRoute.name, { data })
    return result.sent
  }

  async function kill() {
    const result = await bridge.invoke(acpTerminalKillRoute.name, {})
    return result.killed
  }

  function onStarted(
    listener: (payload: DeepchatEventPayload<typeof acpTerminalStartedEvent.name>) => void
  ) {
    return bridge.on(acpTerminalStartedEvent.name, listener)
  }

  function onOutput(
    listener: (payload: DeepchatEventPayload<typeof acpTerminalOutputEvent.name>) => void
  ) {
    return bridge.on(acpTerminalOutputEvent.name, listener)
  }

  function onExited(
    listener: (payload: DeepchatEventPayload<typeof acpTerminalExitedEvent.name>) => void
  ) {
    return bridge.on(acpTerminalExitedEvent.name, listener)
  }

  function onError(
    listener: (payload: DeepchatEventPayload<typeof acpTerminalErrorEvent.name>) => void
  ) {
    return bridge.on(acpTerminalErrorEvent.name, listener)
  }

  function onExternalDependenciesRequired(
    listener: (
      payload: DeepchatEventPayload<typeof acpTerminalExternalDependenciesRequiredEvent.name>
    ) => void
  ) {
    return bridge.on(acpTerminalExternalDependenciesRequiredEvent.name, listener)
  }

  return {
    sendInput,
    kill,
    onStarted,
    onOutput,
    onExited,
    onError,
    onExternalDependenciesRequired
  }
}

export type AcpTerminalClient = ReturnType<typeof createAcpTerminalClient>
