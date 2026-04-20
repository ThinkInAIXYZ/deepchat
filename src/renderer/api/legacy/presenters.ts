import type { IPresenter } from '@shared/presenter'
import { type IRemoteControlPresenter } from '@shared/presenter'
import {
  useLegacyPresenterTransport,
  useLegacyRemoteControlPresenterTransport
} from './presenterTransport'
export { getLegacyWebContentsId } from './runtime'

interface LegacyPresenterOptions {
  safeCall?: boolean
}

export function useLegacyPresenter<T extends keyof IPresenter>(
  name: T,
  options?: LegacyPresenterOptions
): IPresenter[T] {
  return useLegacyPresenterTransport(name, options)
}

export function useLegacyRemoteControlPresenter(
  options?: LegacyPresenterOptions
): IRemoteControlPresenter {
  return useLegacyRemoteControlPresenterTransport(options)
}

export function useLegacyConfigPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('configPresenter', options)
}

export function useLegacyAgentSessionPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('agentSessionPresenter', options)
}

export function useLegacyWindowPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('windowPresenter', options)
}

export function useLegacyDevicePresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('devicePresenter', options)
}

export function useLegacyLlmProviderPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('llmproviderPresenter', options)
}

export function useLegacySkillPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('skillPresenter', options)
}

export function useLegacyWorkspacePresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('workspacePresenter', options)
}

export function useLegacyProjectPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('projectPresenter', options)
}

export function useLegacyFilePresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('filePresenter', options)
}

export function useLegacyShortcutPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('shortcutPresenter', options)
}

export function useLegacySyncPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('syncPresenter', options)
}

export function useLegacyUpgradePresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('upgradePresenter', options)
}

export function useLegacyDialogPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('dialogPresenter', options)
}

export function useLegacyBrowserPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('yoBrowserPresenter', options)
}

export function useLegacyTabPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('tabPresenter', options)
}

export function useLegacyToolPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('toolPresenter', options)
}

export function useLegacyMcpPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('mcpPresenter', options)
}
