export type ResolvedTheme = 'dark' | 'light'
export type DocumentDirection = 'auto' | 'ltr' | 'rtl'

type ApplyDocumentAppearanceOptions = {
  theme?: ResolvedTheme
  fontSizeClass?: string
  language?: string
  direction?: DocumentDirection
  disableThemeTransition?: boolean
  themeDataset?: boolean
}

const FONT_SIZE_CLASSES = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl']
const RTL_LANGUAGES = new Set(['fa-IR', 'he-IL'])

export const resolveDocumentDirection = (language: string): DocumentDirection =>
  RTL_LANGUAGES.has(language) ? 'rtl' : 'auto'

const getDocumentTargets = (): [HTMLElement, HTMLElement] | null => {
  if (typeof document === 'undefined' || !document.body) {
    return null
  }

  return [document.documentElement, document.body]
}

/**
 * Projects already-resolved renderer appearance state onto the current document.
 * Apps retain ownership of settings, stores, and IPC listeners; this module only
 * applies values to DOM state and deliberately has no Vue or renderer dependencies.
 */
export const applyDocumentAppearance = ({
  theme,
  fontSizeClass,
  language,
  direction,
  disableThemeTransition = false,
  themeDataset = false
}: ApplyDocumentAppearanceOptions): void => {
  const targets = getDocumentTargets()
  if (!targets) {
    return
  }

  const [root] = targets
  const currentTheme = root.classList.contains('dark')
    ? 'dark'
    : root.classList.contains('light')
      ? 'light'
      : null
  const shouldDisableThemeTransition =
    disableThemeTransition && Boolean(theme) && currentTheme !== theme

  if (shouldDisableThemeTransition) {
    root.classList.add('dc-theme-switching')
  }

  if (theme) {
    for (const target of targets) {
      target.classList.remove('light', 'dark', 'system')
      target.classList.add(theme)
    }

    if (themeDataset) {
      root.dataset.theme = theme
    }
  }

  if (fontSizeClass) {
    for (const target of targets) {
      target.classList.remove(...FONT_SIZE_CLASSES)
      target.classList.add(fontSizeClass)
    }
  }

  if (language) {
    root.lang = language
  }

  if (direction) {
    root.dir = direction
  }

  if (shouldDisableThemeTransition) {
    if (typeof requestAnimationFrame === 'undefined') {
      root.classList.remove('dc-theme-switching')
      return
    }

    void root.offsetWidth
    requestAnimationFrame(() => {
      root.classList.remove('dc-theme-switching')
    })
  }
}
