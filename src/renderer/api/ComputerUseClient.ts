import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  computerUsePreviewFrameEvent,
  computerUsePreviewSurfaceChangedEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import {
  computerUseDismissPreviewRoute,
  computerUseSetPreviewModeRoute
} from '@shared/contracts/routes'
import type { ComputerUsePreviewMode } from '@shared/types/computerUse'
import { getDeepchatBridge } from './core'

export function createComputerUseClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function setPreviewMode(sessionId: string, mode: ComputerUsePreviewMode) {
    return await bridge.invoke(computerUseSetPreviewModeRoute.name, { sessionId, mode })
  }

  async function dismissPreview(sessionId: string, runId: string) {
    const result = await bridge.invoke(computerUseDismissPreviewRoute.name, { sessionId, runId })
    return result.dismissed
  }

  function onPreviewFrame(
    listener: (payload: DeepchatEventPayload<typeof computerUsePreviewFrameEvent.name>) => void
  ) {
    return bridge.on(computerUsePreviewFrameEvent.name, listener)
  }

  function onPreviewSurfaceChanged(
    listener: (
      payload: DeepchatEventPayload<typeof computerUsePreviewSurfaceChangedEvent.name>
    ) => void
  ) {
    return bridge.on(computerUsePreviewSurfaceChangedEvent.name, listener)
  }

  return {
    setPreviewMode,
    dismissPreview,
    onPreviewFrame,
    onPreviewSurfaceChanged
  }
}

export type ComputerUseClient = ReturnType<typeof createComputerUseClient>
