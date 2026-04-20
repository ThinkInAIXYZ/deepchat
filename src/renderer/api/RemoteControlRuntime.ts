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

export class RemoteControlRuntime {
  constructor(
    private readonly presenter: RemoteControlPresenterCompat = defaultRemoteControlPresenter
  ) {}

  async listRemoteChannels(): Promise<RemoteChannelDescriptor[] | null> {
    return this.presenter.listRemoteChannels ? await this.presenter.listRemoteChannels() : null
  }

  async getChannelStatus(channel: RemoteChannel): Promise<RemoteChannelStatus | null> {
    return this.presenter.getChannelStatus ? await this.presenter.getChannelStatus(channel) : null
  }

  async getTelegramStatus() {
    return await this.presenter.getTelegramStatus()
  }

  async getWeixinIlinkStatus() {
    return await this.presenter.getWeixinIlinkStatus()
  }
}
