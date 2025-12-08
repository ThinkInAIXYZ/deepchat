import { eventBus, SendTarget } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'
import { exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import path from 'path'
import fs from 'fs'

const execAsync = promisify(exec)
const FONT_FILE_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.dfont'])
const DEFAULT_TEXT_FONTS = [
  'Geist',
  'Inter',
  'Noto Sans',
  'SF Pro Text',
  'SF Pro Display',
  'Helvetica Neue',
  'Helvetica',
  'Arial',
  'Segoe UI',
  'Roboto'
]
const DEFAULT_CODE_FONTS = [
  'JetBrains Mono',
  'Fira Code',
  'Menlo',
  'Monaco',
  'Consolas',
  'Courier New'
]

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

export const parseLinuxFontFamilies = (output: string): string[] => {
  const seen = new Set<string>()
  const fonts: string[] = []

  output
    .split(/\r?\n/)
    .map((line) => {
      const [familyPart] = line.split(':')
      return familyPart ?? ''
    })
    .forEach((familyPart) => {
      if (!familyPart.trim()) return
      familyPart
        .split(',')
        .map((part) => normalizeFontNameValue(part))
        .forEach((name) => {
          if (!name || name.includes('=')) return
          const key = name.toLowerCase()
          if (seen.has(key)) return
          seen.add(key)
          fonts.push(name)
        })
    })

  return fonts
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
    const candidates: string[] = []
    try {
      const detected = await this.queryPlatformFonts()
      candidates.push(...detected)
    } catch (error) {
      console.warn('Failed to detect system fonts, using fallbacks only:', error)
    }

    candidates.push(...DEFAULT_TEXT_FONTS, ...DEFAULT_CODE_FONTS)
    return this.uniqueFonts(candidates)
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

  private async queryPlatformFonts(): Promise<string[]> {
    const platform = process.platform
    if (platform === 'darwin') {
      return this.getMacFonts()
    }
    if (platform === 'win32') {
      return this.getWindowsFonts()
    }
    return this.getLinuxFonts()
  }

  private async getLinuxFonts(): Promise<string[]> {
    const output = await this.runCommand('fc-list : family', 5000)
    return parseLinuxFontFamilies(output)
  }

  private async getMacFonts(): Promise<string[]> {
    const profilerOutput = await this.runCommand(
      'system_profiler SPFontsDataType | grep "Family:"',
      7000
    )
    const parsedProfiler = this.parseFontOutput(profilerOutput)
    if (parsedProfiler.length > 0) {
      return parsedProfiler
    }

    return this.readFontsFromDirectories([
      '/System/Library/Fonts',
      '/Library/Fonts',
      path.join(os.homedir(), 'Library/Fonts')
    ])
  }

  private async getWindowsFonts(): Promise<string[]> {
    const command =
      "powershell -NoProfile -Command \"(Get-ItemProperty 'HKLM:\\\\SOFTWARE\\\\Microsoft\\\\Windows NT\\\\CurrentVersion\\\\Fonts').PSObject.Properties | Where-Object { $_.Name -and $_.Value -match '\\.(ttf|otf|ttc)$' } | Select-Object -ExpandProperty Name\""
    const output = await this.runCommand(command, 5000)
    const parsed = this.parseFontOutput(output)
    if (parsed.length > 0) {
      return parsed
    }

    const windowsFontDir = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts')
    return this.readFontsFromDirectories([windowsFontDir])
  }

  private parseFontOutput(output: string): string[] {
    return output
      .split(/\r?\n/)
      .flatMap((line) => line.split(','))
      .map((line) => line.replace(/^[^:]*:\s*/, '').replace(/^Family:\s*/i, ''))
      .map((font) => this.normalizeFontName(font))
      .filter(Boolean)
  }

  private normalizeFontName(name: string): string {
    return normalizeFontNameValue(name)
  }

  private readFontsFromDirectories(directories: string[]): string[] {
    const fonts: string[] = []
    directories.forEach((dir) => {
      if (!fs.existsSync(dir)) return
      try {
        const files = fs.readdirSync(dir)
        files.forEach((file) => {
          const ext = path.extname(file).toLowerCase()
          if (!FONT_FILE_EXTENSIONS.has(ext)) return
          const name = this.normalizeFontName(path.basename(file, ext))
          if (name) {
            fonts.push(name)
          }
        })
      } catch (error) {
        console.warn('Failed to read fonts from directory:', dir, error)
      }
    })
    return fonts
  }

  private async runCommand(command: string, timeout = 5000): Promise<string> {
    try {
      const { stdout } = await execAsync(command, {
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      })
      return stdout || ''
    } catch (error) {
      console.warn(`Failed to execute command for font detection: ${command}`, error)
      return ''
    }
  }
}
