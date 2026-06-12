import type {
  IRemoteControlPresenter,
  RemoteChannel,
  RemoteChannelDescriptor,
  RemoteChannelStatus
} from '@shared/presenter'
import { useLegacyRemoteControlPresenter } from './legacy/presenters'

type RemoteControlPresenterCompat = IRemoteControlPresenter & {
  listRemoteChannels?: () => Promise<RemoteChannelDescriptor[]>
  getChannelStatus?: (channel: RemoteChannel) => Promise<RemoteChannelStatus>
}

const defaultRemoteControlPresenter =
  useLegacyRemoteControlPresenter() as RemoteControlPresenterCompat

export function createRemoteControlRuntime(
  presenter: RemoteControlPresenterCompat = defaultRemoteControlPresenter
) {
  async function listRemoteChannels(): Promise<RemoteChannelDescriptor[] | null> {
    return presenter.listRemoteChannels ? await presenter.listRemoteChannels() : null
  }

  async function getChannelStatus(channel: RemoteChannel): Promise<RemoteChannelStatus | null> {
    return presenter.getChannelStatus ? await presenter.getChannelStatus(channel) : null
  }

  async function getTelegramStatus() {
    return await presenter.getTelegramStatus()
  }

  async function getWeixinIlinkStatus() {
    return await presenter.getWeixinIlinkStatus()
  }

  return {
    listRemoteChannels,
    getChannelStatus,
    getTelegramStatus,
    getWeixinIlinkStatus
  }
}

export type RemoteControlRuntime = ReturnType<typeof createRemoteControlRuntime>
