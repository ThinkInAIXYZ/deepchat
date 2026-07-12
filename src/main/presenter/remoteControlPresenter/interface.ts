import type {
  DiscordRemoteSettings,
  FeishuRemoteSettings,
  IConfigPresenter,
  IAgentSessionPresenter,
  IFilePresenter,
  IRemoteControlPresenter,
  QQBotRemoteSettings,
  ITabPresenter,
  IWindowPresenter,
  TelegramRemoteSettings,
  WeixinIlinkRemoteSettings
} from '@shared/presenter'
import type { AgentManagerGenerationPort } from '@/agent/manager/agentManager'
import type { CronJobRemoteDeliveryPort } from '../cronJobs/deliveryRouter'

export interface RemoteControlPresenterDeps {
  configPresenter: IConfigPresenter
  agentSessionPresenter: IAgentSessionPresenter
  filePresenter?: IFilePresenter
  agentManager: AgentManagerGenerationPort
  windowPresenter: IWindowPresenter
  tabPresenter: ITabPresenter
}

export interface RemoteRuntimeLifecycle {
  initialize(): Promise<void>
  destroy(): Promise<void>
}

export interface RemoteControlPresenterLike
  extends IRemoteControlPresenter, RemoteRuntimeLifecycle, CronJobRemoteDeliveryPort {
  buildTelegramSettingsSnapshot(): TelegramRemoteSettings
  buildFeishuSettingsSnapshot(): FeishuRemoteSettings
  buildQQBotSettingsSnapshot(): QQBotRemoteSettings
  buildDiscordSettingsSnapshot(): DiscordRemoteSettings
  buildWeixinIlinkSettingsSnapshot(): WeixinIlinkRemoteSettings
}
