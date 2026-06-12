import type { IShortcutPresenter } from '@shared/presenter'
import { useLegacyShortcutPresenter } from './legacy/presenters'

const defaultShortcutPresenter = useLegacyShortcutPresenter()

export function createShortcutRuntime(presenter: IShortcutPresenter = defaultShortcutPresenter) {
  function registerShortcuts() {
    presenter.registerShortcuts()
  }

  function destroy() {
    presenter.destroy()
  }

  return {
    registerShortcuts,
    destroy
  }
}

export type ShortcutRuntime = ReturnType<typeof createShortcutRuntime>
