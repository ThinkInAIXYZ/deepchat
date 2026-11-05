import { nativeTheme } from 'electron'
import type { ThemeHost, ThemeSource } from '../themeHost'

export const electronThemeHost: ThemeHost = {
  isDark(): boolean {
    return nativeTheme.shouldUseDarkColors
  },

  source(): ThemeSource {
    return nativeTheme.themeSource
  },

  setSource(source: ThemeSource): void {
    nativeTheme.themeSource = source
  },

  onUpdated(listener: () => void): () => void {
    nativeTheme.on('updated', listener)
    return () => {
      nativeTheme.removeListener('updated', listener)
    }
  }
}
