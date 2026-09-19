import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  acpAuthOutputEvent,
  acpAuthStateChangedEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import {
  acpAuthCancelRoute,
  acpAuthInputRoute,
  acpAuthInspectRoute,
  acpAuthStartRoute,
  acpAuthStatusRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createAcpAuthClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  const inspect = (agentId: string, workdir?: string) =>
    bridge.invoke(acpAuthInspectRoute.name, { agentId, workdir })

  const start = (challengeId: string, methodId: string) =>
    bridge.invoke(acpAuthStartRoute.name, { challengeId, methodId })

  const sendInput = (runId: string, data: string) =>
    bridge.invoke(acpAuthInputRoute.name, { runId, data })

  const cancel = (runId: string) => bridge.invoke(acpAuthCancelRoute.name, { runId })

  const getStatus = (challengeId: string) => bridge.invoke(acpAuthStatusRoute.name, { challengeId })

  const onOutput = (
    listener: (payload: DeepchatEventPayload<typeof acpAuthOutputEvent.name>) => void
  ) => bridge.on(acpAuthOutputEvent.name, listener)

  const onStateChanged = (
    listener: (payload: DeepchatEventPayload<typeof acpAuthStateChangedEvent.name>) => void
  ) => bridge.on(acpAuthStateChangedEvent.name, listener)

  return { inspect, start, sendInput, cancel, getStatus, onOutput, onStateChanged }
}

export type AcpAuthClient = ReturnType<typeof createAcpAuthClient>
