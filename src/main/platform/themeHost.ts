/**
 * Native theme boundary.
 *
 * DeepChat follows the desktop's light/dark preference and, when the user picks
 * a theme explicitly, tells the system so native chrome matches. Electron
 * exposes that through `nativeTheme`; mygo has `ui.Theme`/`App` theme APIs and
 * the page's `prefers-color-scheme`, so the boundary stays at "source plus
 * current appearance" and does not leak Electron types.
 */
export type ThemeSource = 'system' | 'light' | 'dark'

export interface ThemeHost {
  /** Current appearance, following the desktop when the source is "system". */
  isDark(): boolean
  /** Which source the app asked for. */
  source(): ThemeSource
  /** Sets the source the app asks for. */
  setSource(source: ThemeSource): void
  /** Subscribes to appearance changes; returns an unsubscribe function. */
  onUpdated(listener: () => void): () => void
}

export { electronThemeHost as themeHost } from './electron/themeHost'
