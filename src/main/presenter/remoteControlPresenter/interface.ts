import type { HookTestResult, HooksNotificationsSettings } from '@shared/hooksNotifications'
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
  getHooksNotificationsConfig: () => HooksNotificationsSettings
  setHooksNotificationsConfig: (config: HooksNotificationsSettings) => HooksNotificationsSettings
  testTelegramHookNotification: () => Promise<HookTestResult>
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
