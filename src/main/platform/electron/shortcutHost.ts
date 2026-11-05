import { globalShortcut } from 'electron'
import type { ShortcutHost } from '../shortcutHost'

export const electronShortcutHost: ShortcutHost = {
  register(accelerator: string, handler: () => void): boolean {
    return globalShortcut.register(accelerator, handler)
  },

  unregisterAll(): void {
    globalShortcut.unregisterAll()
  }
}
