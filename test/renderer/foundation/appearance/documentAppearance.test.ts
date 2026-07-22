import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyDocumentAppearance,
  resolveDocumentDirection
} from '@/foundation/appearance/documentAppearance'

describe('applyDocumentAppearance', () => {
  afterEach(() => {
    document.documentElement.className = ''
    document.body.className = ''
    document.documentElement.lang = ''
    document.documentElement.dir = ''
    delete document.documentElement.dataset.theme
    vi.restoreAllMocks()
  })

  it('resolves direction from the persisted locale', () => {
    expect(resolveDocumentDirection('he-IL')).toBe('rtl')
    expect(resolveDocumentDirection('zh-CN')).toBe('auto')
  })

  it('projects resolved theme, font size, and locale state to the document', () => {
    document.documentElement.classList.add('light', 'text-sm')
    document.body.classList.add('light', 'text-sm')

    applyDocumentAppearance({
      theme: 'dark',
      fontSizeClass: 'text-lg',
      language: 'he-IL',
      direction: 'rtl'
    })

    for (const target of [document.documentElement, document.body]) {
      expect(target.classList.contains('dark')).toBe(true)
      expect(target.classList.contains('light')).toBe(false)
      expect(target.classList.contains('text-lg')).toBe(true)
      expect(target.classList.contains('text-sm')).toBe(false)
    }
    expect(document.documentElement.lang).toBe('he-IL')
    expect(document.documentElement.dir).toBe('rtl')
  })

  it('sets the optional theme dataset for renderers that need selector compatibility', () => {
    applyDocumentAppearance({ theme: 'dark', themeDataset: true })

    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('does not suppress transitions when the resolved theme is unchanged', () => {
    document.documentElement.classList.add('dark')
    const offsetWidth = vi.spyOn(document.documentElement, 'offsetWidth', 'get')

    applyDocumentAppearance({
      theme: 'dark',
      fontSizeClass: 'text-lg',
      disableThemeTransition: true
    })

    expect(document.documentElement.classList.contains('dc-theme-switching')).toBe(false)
    expect(offsetWidth).not.toHaveBeenCalled()
  })

  it('removes transition suppression on the next animation frame', () => {
    let runFrame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      runFrame = callback
      return 1
    })

    applyDocumentAppearance({ theme: 'dark', disableThemeTransition: true })

    expect(document.documentElement.classList.contains('dc-theme-switching')).toBe(true)
    expect(runFrame).not.toBeNull()
    runFrame?.(0)
    expect(document.documentElement.classList.contains('dc-theme-switching')).toBe(false)
  })
})
