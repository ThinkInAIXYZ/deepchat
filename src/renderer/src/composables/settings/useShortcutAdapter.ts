import { usePresenter } from '@/composables/usePresenter'

export type ShortcutAdapter = {
  registerShortcuts: () => void
  destroyShortcuts: () => void
}

export function useShortcutAdapter(): ShortcutAdapter {
  const shortcutPresenter = usePresenter('shortcutPresenter')

  return {
    registerShortcuts: () => shortcutPresenter.registerShortcuts(),
    destroyShortcuts: () => shortcutPresenter.destroy()
  }
}
