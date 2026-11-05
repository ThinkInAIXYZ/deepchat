/**
 * Global shortcut boundary.
 *
 * DeepChat registers one system-wide accelerator (show/hide the main window) and
 * application menu accelerators for everything else. Electron exposes both
 * through `globalShortcut` and `Menu`; mygo has `GlobalShortcut.Register` and
 * application menus, so the boundary stays at that level and does not expose
 * Electron menu types.
 */
export interface ShortcutHost {
  /** Registers a system-wide accelerator, replacing any previous registration. */
  register(accelerator: string, handler: () => void): boolean
  /** Removes every system-wide accelerator this app registered. */
  unregisterAll(): void
}

export { electronShortcutHost as shortcutHost } from './electron/shortcutHost'
