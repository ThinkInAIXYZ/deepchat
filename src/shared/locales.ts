export const FALLBACK_LOCALE = 'en-US' as const

export const SUPPORTED_LOCALES = [
  'zh-CN',
  'en-US',
  'zh-TW',
  'zh-HK',
  'ko-KR',
  'ru-RU',
  'ja-JP',
  'fr-FR',
  'fa-IR',
  'pt-BR',
  'da-DK',
  'he-IL',
  'es-ES',
  'de-DE',
  'tr-TR',
  'id-ID',
  'ms-MY',
  'it-IT',
  'pl-PL',
  'vi-VN'
] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const REQUESTED_LOCALES = ['system', ...SUPPORTED_LOCALES] as const

export type RequestedLocale = (typeof REQUESTED_LOCALES)[number]

export const LOCALE_DISPLAY_NAMES = {
  'zh-CN': '简体中文',
  'en-US': 'English (US)',
  'zh-HK': '繁體中文（香港）',
  'zh-TW': '繁體中文（台灣）',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'ru-RU': 'Русский',
  'fr-FR': 'Français',
  'fa-IR': 'فارسی (ایران)',
  'pt-BR': 'Português (Brasil)',
  'da-DK': 'Dansk',
  'he-IL': 'עברית (ישראל)',
  'es-ES': 'Español (España)',
  'de-DE': 'Deutsch (Deutschland)',
  'tr-TR': 'Türkçe',
  'id-ID': 'Bahasa Indonesia',
  'ms-MY': 'Bahasa Melayu',
  'it-IT': 'Italiano',
  'pl-PL': 'Polski',
  'vi-VN': 'Tiếng Việt'
} as const satisfies Record<SupportedLocale, string>

const localeLookup = new Map<string, SupportedLocale>(
  SUPPORTED_LOCALES.map((locale) => [locale.toLowerCase(), locale])
)

const languageFallbacks: Readonly<Record<string, SupportedLocale>> = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
  ru: 'ru-RU',
  fr: 'fr-FR',
  fa: 'fa-IR',
  pt: 'pt-BR',
  da: 'da-DK',
  he: 'he-IL',
  es: 'es-ES',
  de: 'de-DE',
  tr: 'tr-TR',
  id: 'id-ID',
  ms: 'ms-MY',
  it: 'it-IT',
  pl: 'pl-PL',
  vi: 'vi-VN'
}

const rtlLocales = new Set<SupportedLocale>(['fa-IR', 'he-IL'])

const resolveChineseLocale = (subtags: readonly string[]): SupportedLocale => {
  const subtagSet = new Set(subtags)

  if (subtagSet.has('hans')) return 'zh-CN'
  if (subtagSet.has('hant')) {
    return subtagSet.has('hk') || subtagSet.has('mo') ? 'zh-HK' : 'zh-TW'
  }
  if (subtagSet.has('hk') || subtagSet.has('mo')) return 'zh-HK'
  if (subtagSet.has('tw')) return 'zh-TW'
  return 'zh-CN'
}

export function resolveSupportedLocale(locale: string | null | undefined): SupportedLocale {
  if (!locale) return FALLBACK_LOCALE

  const normalizedLocale = locale.trim().replaceAll('_', '-').toLowerCase()
  const exactLocale = localeLookup.get(normalizedLocale)
  if (exactLocale) return exactLocale

  const [language, ...subtags] = normalizedLocale.split('-')
  if (language === 'zh') return resolveChineseLocale(subtags)
  return languageFallbacks[language] ?? FALLBACK_LOCALE
}

export function resolveRequestedLocale(locale: string | null | undefined): RequestedLocale {
  return locale?.trim().toLowerCase() === 'system' ? 'system' : resolveSupportedLocale(locale)
}

export function getLocaleDirection(locale: string | null | undefined): 'rtl' | 'auto' {
  return rtlLocales.has(resolveSupportedLocale(locale)) ? 'rtl' : 'auto'
}
