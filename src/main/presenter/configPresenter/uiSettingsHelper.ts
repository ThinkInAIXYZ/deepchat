import { eventBus, SendTarget } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'
import fontList from 'font-list'

const normalizeFontNameValue = (name: string): string => {
  const trimmed = name
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!trimmed) return ''

  const stripped = trimmed
    .replace(
      /\b(Regular|Italic|Oblique|Bold|Light|Medium|Semi\s*Bold|Black|Narrow|Condensed|Extended|Book|Roman)\b/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim()

  return stripped || trimmed
}

type SetSetting = <T>(key: string, value: T) => void
type GetSetting = <T>(key: string) => T | undefined

interface UiSettingsHelperOptions {
  getSetting: GetSetting
  setSetting: SetSetting
}

export class UiSettingsHelper {
  private readonly getSetting: GetSetting
  private readonly setSetting: SetSetting
  private systemFontsCache: string[] | null = null

  constructor(options: UiSettingsHelperOptions) {
    this.getSetting = options.getSetting
    this.setSetting = options.setSetting
  }

  getSearchPreviewEnabled(): Promise<boolean> {
    const value = this.getSetting<boolean>('searchPreviewEnabled')
    return Promise.resolve(Boolean(value))
  }

  setSearchPreviewEnabled(enabled: boolean): void {
    const boolValue = Boolean(enabled)
    this.setSetting('searchPreviewEnabled', boolValue)
    eventBus.send(CONFIG_EVENTS.SEARCH_PREVIEW_CHANGED, SendTarget.ALL_WINDOWS, boolValue)
  }

  getAutoScrollEnabled(): boolean {
    const value = this.getSetting<boolean>('autoScrollEnabled')
    if (value === undefined) return true
    return Boolean(value)
  }

  setAutoScrollEnabled(enabled: boolean): void {
    const boolValue = Boolean(enabled)
    this.setSetting('autoScrollEnabled', boolValue)
    eventBus.send(CONFIG_EVENTS.AUTO_SCROLL_CHANGED, SendTarget.ALL_WINDOWS, boolValue)
  }

  getContentProtectionEnabled(): boolean {
    const value = this.getSetting<boolean>('contentProtectionEnabled')
    return value === undefined || value === null ? false : value
  }

  setContentProtectionEnabled(enabled: boolean): void {
    this.setSetting('contentProtectionEnabled', enabled)
    eventBus.send(CONFIG_EVENTS.CONTENT_PROTECTION_CHANGED, SendTarget.ALL_WINDOWS, enabled)
  }

  getCopyWithCotEnabled(): boolean {
    const value = this.getSetting<boolean>('copyWithCotEnabled')
    return value === undefined || value === null ? false : value
  }

  setCopyWithCotEnabled(enabled: boolean): void {
    this.setSetting('copyWithCotEnabled', enabled)
    eventBus.send(CONFIG_EVENTS.COPY_WITH_COT_CHANGED, SendTarget.ALL_WINDOWS, enabled)
  }

  setTraceDebugEnabled(enabled: boolean): void {
    this.setSetting('traceDebugEnabled', enabled)
    eventBus.send(CONFIG_EVENTS.TRACE_DEBUG_CHANGED, SendTarget.ALL_WINDOWS, enabled)
  }

  getNotificationsEnabled(): boolean {
    const value = this.getSetting<boolean>('notificationsEnabled')
    if (value === undefined) {
      return true
    }
    return value
  }

  setNotificationsEnabled(enabled: boolean): void {
    this.setSetting('notificationsEnabled', enabled)
    eventBus.send(CONFIG_EVENTS.NOTIFICATIONS_CHANGED, SendTarget.ALL_WINDOWS, Boolean(enabled))
  }

  getFontFamily(): string {
    return this.normalizeStoredFont(this.getSetting<string>('fontFamily'))
  }

  setFontFamily(fontFamily?: string | null): void {
    const normalized = this.normalizeStoredFont(fontFamily)
    this.setSetting('fontFamily', normalized)
    eventBus.send(CONFIG_EVENTS.FONT_FAMILY_CHANGED, SendTarget.ALL_WINDOWS, normalized)
  }

  getCodeFontFamily(): string {
    return this.normalizeStoredFont(this.getSetting<string>('codeFontFamily'))
  }

  setCodeFontFamily(fontFamily?: string | null): void {
    const normalized = this.normalizeStoredFont(fontFamily)
    this.setSetting('codeFontFamily', normalized)
    eventBus.send(CONFIG_EVENTS.CODE_FONT_FAMILY_CHANGED, SendTarget.ALL_WINDOWS, normalized)
  }

  resetFontSettings(): void {
    this.setFontFamily('')
    this.setCodeFontFamily('')
  }

  async getSystemFonts(): Promise<string[]> {
    if (this.systemFontsCache) {
      return this.systemFontsCache
    }

    const fonts = await this.loadSystemFonts()
    this.systemFontsCache = fonts
    return fonts
  }

  private normalizeStoredFont(value?: string | null): string {
    if (typeof value !== 'string') return ''
    const cleaned = value
      .replace(/[\r\n\t]/g, ' ')
      .replace(/[;:{}()[\]<>]/g, '')
      .replace(/['"`\\]/g, '')
      .trim()
    if (!cleaned) return ''

    const collapsed = cleaned.replace(/\s+/g, ' ').slice(0, 100)

    // If we already have detected system fonts cached, prefer an exact match from that list
    if (this.systemFontsCache?.length) {
      const match = this.systemFontsCache.find(
        (font) => font.toLowerCase() === collapsed.toLowerCase()
      )
      if (match) return match
    }

    return collapsed
  }

  private async loadSystemFonts(): Promise<string[]> {
    try {
      const detected = await fontList.getFonts()
      const normalized = detected
        .map((font) => this.normalizeFontName(font))
        .filter((font): font is string => Boolean(font))
      return this.uniqueFonts(normalized)
    } catch (error) {
      console.warn('Failed to detect system fonts with font-list:', error)
      return []
    }
  }

  private uniqueFonts(fonts: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []
    fonts.forEach((font) => {
      const name = font.trim()
      if (!name) return
      const key = name.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      result.push(name)
    })
    return result
  }

  private normalizeFontName(name: string): string {
    return normalizeFontNameValue(name)
  }
}
