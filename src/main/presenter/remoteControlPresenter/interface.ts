import type { HookTestResult, HooksNotificationsSettings } from '@shared/hooksNotifications'
import type {
  FeishuRemoteSettings,
  IConfigPresenter,
  INewAgentPresenter,
  IRemoteControlPresenter,
  ITabPresenter,
  IWindowPresenter,
  TelegramRemoteSettings
} from '@shared/presenter'
import type { DeepChatAgentPresenter } from '../deepchatAgentPresenter'

export interface RemoteControlPresenterDeps {
  configPresenter: IConfigPresenter
  newAgentPresenter: INewAgentPresenter
  deepchatAgentPresenter: DeepChatAgentPresenter
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
}
