import fontList from 'font-list'
import type { SettingsStore } from '@/config/settingsStore'
import type { DeepchatEventPublisher } from '@shared/contracts/events'

const normalizeFontNameValue = (name: string): string => {
  const trimmed = name
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!trimmed) return ''

  return (
    trimmed
      .replace(
        /\b(Regular|Italic|Oblique|Bold|Light|Medium|Semi\s*Bold|Black|Narrow|Condensed|Extended|Book|Roman)\b/gi,
        ''
      )
      .replace(/\s+/g, ' ')
      .trim() || trimmed
  )
}

export class FontSettings {
  private systemFontsCache: string[] | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly publishEvent: DeepchatEventPublisher
  ) {}

  getFontFamily(): string {
    return this.normalizeStoredFont(this.settings.get<string>('fontFamily'))
  }

  setFontFamily(fontFamily?: string | null): void {
    this.setFont('fontFamily', fontFamily)
  }

  getCodeFontFamily(): string {
    return this.normalizeStoredFont(this.settings.get<string>('codeFontFamily'))
  }

  setCodeFontFamily(fontFamily?: string | null): void {
    this.setFont('codeFontFamily', fontFamily)
  }

  async getSystemFonts(): Promise<string[]> {
    if (this.systemFontsCache) return this.systemFontsCache

    try {
      const detected = await fontList.getFonts()
      const seen = new Set<string>()
      this.systemFontsCache = detected.flatMap((font) => {
        const name = normalizeFontNameValue(font)
        const key = name.toLowerCase()
        if (!name || seen.has(key)) return []
        seen.add(key)
        return [name]
      })
    } catch (error) {
      console.warn('Failed to detect system fonts with font-list:', error)
      this.systemFontsCache = []
    }
    return this.systemFontsCache
  }

  private setFont(key: 'fontFamily' | 'codeFontFamily', value?: string | null): void {
    const normalized = this.normalizeStoredFont(value)
    this.settings.set(key, normalized)
    this.publishEvent('settings.changed', {
      changedKeys: [key],
      version: Date.now(),
      values: { [key]: normalized }
    })
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
    return (
      this.systemFontsCache?.find((font) => font.toLowerCase() === collapsed.toLowerCase()) ??
      collapsed
    )
  }
}
