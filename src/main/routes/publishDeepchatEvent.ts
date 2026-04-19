import { eventBus, SendTarget } from '@/eventbus'
import { DEEPCHAT_EVENT_CHANNEL } from '@shared/contracts/channels'
import {
  getDeepchatEventContract,
  type DeepchatEventEnvelope,
  type DeepchatEventName,
  type DeepchatEventPayload
} from '@shared/contracts/events'

export function publishDeepchatEvent<T extends DeepchatEventName>(
  name: T,
  payload: DeepchatEventPayload<T>
): void {
  const contract = getDeepchatEventContract(name)
  const normalizedPayload = contract.payload.parse(payload)
  const envelope: DeepchatEventEnvelope<T> = {
    name,
    payload: normalizedPayload
  }

  eventBus.sendToRenderer(DEEPCHAT_EVENT_CHANNEL, SendTarget.ALL_WINDOWS, envelope)
}
