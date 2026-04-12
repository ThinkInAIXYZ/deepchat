import type {
  DiscordRemoteSettings,
  FeishuRemoteSettings,
  IConfigPresenter,
  IAgentSessionPresenter,
  IRemoteControlPresenter,
  QQBotRemoteSettings,
  ITabPresenter,
  IWindowPresenter,
  TelegramRemoteSettings,
  WeixinIlinkRemoteSettings
} from '@shared/presenter'
import type { AgentRuntimePresenter } from '../agentRuntimePresenter'

export interface RemoteControlPresenterDeps {
  configPresenter: IConfigPresenter
  agentSessionPresenter: IAgentSessionPresenter
  agentRuntimePresenter: AgentRuntimePresenter
  windowPresenter: IWindowPresenter
  tabPresenter: ITabPresenter
}

export interface RemoteRuntimeLifecycle {
  initialize(): Promise<void>
  destroy(): Promise<void>
}

export interface RemoteControlPresenterLike
  extends IRemoteControlPresenter, RemoteRuntimeLifecycle {
  buildTelegramSettingsSnapshot(): TelegramRemoteSettings
  buildFeishuSettingsSnapshot(): FeishuRemoteSettings
  buildQQBotSettingsSnapshot(): QQBotRemoteSettings
  buildDiscordSettingsSnapshot(): DiscordRemoteSettings
  buildWeixinIlinkSettingsSnapshot(): WeixinIlinkRemoteSettings
}
