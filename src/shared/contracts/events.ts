import type { z } from 'zod'
import type { EventContract } from './common'
import {
  chatStreamCompletedEvent,
  chatStreamFailedEvent,
  chatStreamUpdatedEvent
} from './events/chat.events'
import { settingsChangedEvent } from './events/settings.events'
import { sessionsUpdatedEvent } from './events/sessions.events'

export * from './events/chat.events'
export * from './events/settings.events'
export * from './events/sessions.events'

export const DEEPCHAT_EVENT_CATALOG = {
  [settingsChangedEvent.name]: settingsChangedEvent,
  [sessionsUpdatedEvent.name]: sessionsUpdatedEvent,
  [chatStreamUpdatedEvent.name]: chatStreamUpdatedEvent,
  [chatStreamCompletedEvent.name]: chatStreamCompletedEvent,
  [chatStreamFailedEvent.name]: chatStreamFailedEvent
} satisfies Record<string, EventContract>

export type DeepchatEventCatalog = typeof DEEPCHAT_EVENT_CATALOG
export type DeepchatEventName = keyof DeepchatEventCatalog
export type DeepchatEventContract<T extends DeepchatEventName> = DeepchatEventCatalog[T]
export type DeepchatEventPayload<T extends DeepchatEventName> = z.output<
  DeepchatEventContract<T>['payload']
>

export type DeepchatEventEnvelope<T extends DeepchatEventName = DeepchatEventName> = {
  name: T
  payload: DeepchatEventPayload<T>
}

export function hasDeepchatEventContract(name: string): name is DeepchatEventName {
  return Object.prototype.hasOwnProperty.call(DEEPCHAT_EVENT_CATALOG, name)
}

export function getDeepchatEventContract<T extends DeepchatEventName>(
  name: T
): DeepchatEventContract<T> {
  return DEEPCHAT_EVENT_CATALOG[name]
}
