import type { RemoteChannelDescriptor } from '@shared/types/remote'
import { REMOTE_DELIVERY_CHANNELS } from './delivery/service'

/**
 * The channels the app can connect to.
 *
 * Kept out of `remote/index.ts` so a reader that only needs the catalog — such as
 * the Node sidecar, which cannot load the channel runtimes — does not pull them in.
 */
const REMOTE_CHANNEL_CATALOG = [
  {
    id: 'telegram',
    titleKey: 'settings.remote.telegram.title',
    descriptionKey: 'settings.remote.telegram.description'
  },
  {
    id: 'feishu',
    titleKey: 'settings.remote.feishu.title',
    descriptionKey: 'settings.remote.feishu.description'
  },
  {
    id: 'qqbot',
    titleKey: 'settings.remote.qqbot.title',
    descriptionKey: 'settings.remote.qqbot.description'
  },
  {
    id: 'discord',
    titleKey: 'settings.remote.discord.title',
    descriptionKey: 'settings.remote.discord.description'
  },
  {
    id: 'weixin-ilink',
    titleKey: 'settings.remote.weixinIlink.title',
    descriptionKey: 'settings.remote.weixinIlink.description'
  }
] satisfies readonly Omit<RemoteChannelDescriptor, 'supportsCronDelivery'>[]

/** The catalog with the delivery capability each channel has. */
export function listRemoteChannelDescriptors(): RemoteChannelDescriptor[] {
  return REMOTE_CHANNEL_CATALOG.map((channel) => ({
    ...channel,
    supportsCronDelivery: (REMOTE_DELIVERY_CHANNELS as readonly string[]).includes(channel.id)
  }))
}
