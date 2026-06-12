import { eventBus, SendTarget } from '@/eventbus'
import { DEEPCHAT_EVENT_CHANNEL } from '@shared/contracts/channels'
import {
  getDeepchatEventContract,
  type DeepchatEventEnvelope,
  type DeepchatEventName,
  type DeepchatEventPayload
} from '@shared/contracts/events'

export function createDeepchatEventEnvelope<T extends DeepchatEventName>(
  name: T,
  payload: unknown
): DeepchatEventEnvelope<T> {
  const contract = getDeepchatEventContract(name)
  const normalizedPayload = contract.payload.parse(payload) as DeepchatEventPayload<T>
  return {
    name,
    payload: normalizedPayload
  }
}

export function publishDeepchatEvent<T extends DeepchatEventName>(name: T, payload: unknown): void {
  const envelope = createDeepchatEventEnvelope(name, payload)

  eventBus.sendToRenderer(DEEPCHAT_EVENT_CHANNEL, SendTarget.ALL_WINDOWS, envelope)
}

export function publishDeepchatEventToWebContents<T extends DeepchatEventName>(
  webContentsId: number,
  name: T,
  payload: unknown
): void {
  const envelope = createDeepchatEventEnvelope(name, payload)

  eventBus.sendToWebContents(webContentsId, DEEPCHAT_EVENT_CHANNEL, envelope)
}
