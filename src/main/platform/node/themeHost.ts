import type { ThemeHost, ThemeSource } from '../themeHost'

/**
 * Theme host for a Node sidecar.
 *
 * A plain Node process cannot read the desktop appearance; the shell owns that
 * and pushes the resolved value. Until then `system` is treated as light so the
 * sidecar has a deterministic answer, and `DEEPCHAT_SYSTEM_THEME_DARK=1` lets the
 * shell inject the real one at startup.
 */
export const nodeThemeHost: ThemeHost = {
  isDark(): boolean {
    if (currentSource === 'dark') return true
    if (currentSource === 'light') return false
    return process.env.DEEPCHAT_SYSTEM_THEME_DARK === '1'
  },

  source(): ThemeSource {
    return currentSource
  },

  setSource(source: ThemeSource): void {
    currentSource = source
    for (const listener of listeners) listener()
  },

  onUpdated(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
}

let currentSource: ThemeSource = 'system'
const listeners = new Set<() => void>()

/** Canonical name so the build can swap this module in for the electron one. */
export const themeHost = nodeThemeHost
