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

export function useLegacyShortcutPresenter(options?: LegacyPresenterOptions) {
  return useLegacyPresenter('shortcutPresenter', options)
}
