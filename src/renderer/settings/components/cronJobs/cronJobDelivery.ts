import type { CronJobDeliveryTarget } from '@shared/cronJobs'
import type { RemoteBindingSummary, RemoteChannel } from '@shared/types/remote'

export type RemoteDeliveryOption = {
  value: string
  channel: RemoteChannel
  titleKey: string
  endpointKey: string
  binding: RemoteBindingSummary
}

export const createRemoteDeliveryTarget = (
  option: RemoteDeliveryOption
): CronJobDeliveryTarget => ({
  type: 'remote',
  remoteId: option.channel,
  channelId: option.endpointKey,
  mode: 'summary'
})
