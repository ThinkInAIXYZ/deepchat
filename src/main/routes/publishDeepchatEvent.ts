import { DEEPCHAT_EVENT_CHANNEL } from '@shared/contracts/channels'
import {
  getDeepchatEventContract,
  type DeepchatEventEnvelope,
  type DeepchatEventName,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import type { IWindowPresenter } from '@shared/presenter'

type DeepchatEventWindowPresenter = Pick<IWindowPresenter, 'sendToAllWindows' | 'sendToWebContents'>

let deepchatEventWindowPresenter: DeepchatEventWindowPresenter | null = null

export function setDeepchatEventWindowPresenter(
  windowPresenter: DeepchatEventWindowPresenter | null
): void {
  deepchatEventWindowPresenter = windowPresenter
}

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

  if (!deepchatEventWindowPresenter) {
    console.warn(`WindowPresenter not available, cannot publish deepchat event ${name}`)
    return
  }

  deepchatEventWindowPresenter.sendToAllWindows(DEEPCHAT_EVENT_CHANNEL, envelope)
}

export function publishDeepchatEventToWebContents<T extends DeepchatEventName>(
  webContentsId: number,
  name: T,
  payload: unknown
): void {
  const envelope = createDeepchatEventEnvelope(name, payload)

  if (!deepchatEventWindowPresenter) {
    console.warn(
      `WindowPresenter not available, cannot publish deepchat event ${name} to webContents ${webContentsId}`
    )
    return
  }

  deepchatEventWindowPresenter
    .sendToWebContents(webContentsId, DEEPCHAT_EVENT_CHANNEL, envelope)
    .then((sent) => {
      if (!sent) {
        console.warn(
          `webContents ${webContentsId} not found or destroyed, cannot publish deepchat event ${name}`
        )
      }
    })
    .catch((error) => {
      console.error(
        `Error publishing deepchat event ${name} to webContents ${webContentsId}:`,
        error
      )
    })
}
