import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  contextMenuAskAiRequestedEvent,
  contextMenuTranslateRequestedEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import { getDeepchatBridge } from './core'

export function createContextMenuClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  function onTranslateRequested(
    listener: (payload: DeepchatEventPayload<'contextMenu.translateRequested'>) => void
  ) {
    return bridge.on(contextMenuTranslateRequestedEvent.name, listener)
  }

  function onAskAiRequested(
    listener: (payload: DeepchatEventPayload<'contextMenu.askAiRequested'>) => void
  ) {
    return bridge.on(contextMenuAskAiRequestedEvent.name, listener)
  }

  return {
    onTranslateRequested,
    onAskAiRequested
  }
}

export type ContextMenuClient = ReturnType<typeof createContextMenuClient>
