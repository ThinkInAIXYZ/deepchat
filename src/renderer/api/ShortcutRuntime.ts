import type { IShortcutPresenter } from '@shared/presenter'
import { useLegacyShortcutPresenter } from './legacy/presenters'

const defaultShortcutPresenter = useLegacyShortcutPresenter()

export class ShortcutRuntime {
  constructor(private readonly presenter: IShortcutPresenter = defaultShortcutPresenter) {}

  registerShortcuts() {
    this.presenter.registerShortcuts()
  }

  destroy() {
    this.presenter.destroy()
  }
}
