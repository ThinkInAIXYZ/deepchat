import type { LocaleMessageValue } from 'vue-i18n'

export { pluralRules } from './pluralRules'

export const FALLBACK_LOCALE = 'en-US' as const

export const SUPPORTED_LOCALES = [
  'zh-CN',
  'en-US',
  'zh-HK',
  'zh-TW',
  'ja-JP',
  'ko-KR',
  'ru-RU',
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
export type RendererLocaleMessages = Record<string, LocaleMessageValue>

type LocaleModule = { default: RendererLocaleMessages }
type LocaleLoader = () => Promise<LocaleModule>

const localeLoaders: Record<SupportedLocale, LocaleLoader> = {
  'zh-CN': () => import('./zh-CN'),
  'en-US': () => import('./en-US'),
  'zh-HK': () => import('./zh-HK'),
  'zh-TW': () => import('./zh-TW'),
  'ja-JP': () => import('./ja-JP'),
  'ko-KR': () => import('./ko-KR'),
  'ru-RU': () => import('./ru-RU'),
  'fr-FR': () => import('./fr-FR'),
  'fa-IR': () => import('./fa-IR'),
  'pt-BR': () => import('./pt-BR'),
  'da-DK': () => import('./da-DK'),
  'he-IL': () => import('./he-IL'),
  'es-ES': () => import('./es-ES'),
  'de-DE': () => import('./de-DE'),
  'tr-TR': () => import('./tr-TR'),
  'id-ID': () => import('./id-ID'),
  'ms-MY': () => import('./ms-MY'),
  'it-IT': () => import('./it-IT'),
  'pl-PL': () => import('./pl-PL'),
  'vi-VN': () => import('./vi-VN')
}

const localeAliases: Record<string, SupportedLocale> = {
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

const supportedLocaleLookup = new Map(
  SUPPORTED_LOCALES.map((locale) => [locale.toLowerCase(), locale])
)
const localeMessagePromises = new Map<SupportedLocale, Promise<RendererLocaleMessages>>()

export function resolveSupportedLocale(locale: string | null | undefined): SupportedLocale {
  if (!locale) return FALLBACK_LOCALE

  const normalizedLocale = locale.replace('_', '-').toLowerCase()
  return (
    supportedLocaleLookup.get(normalizedLocale) ??
    localeAliases[normalizedLocale] ??
    FALLBACK_LOCALE
  )
}

export function loadLocaleMessages(locale: string): Promise<RendererLocaleMessages> {
  const resolvedLocale = resolveSupportedLocale(locale)
  const cachedPromise = localeMessagePromises.get(resolvedLocale)
  if (cachedPromise) return cachedPromise

  const messagesPromise = localeLoaders[resolvedLocale]().then((module) => module.default)
  localeMessagePromises.set(resolvedLocale, messagesPromise)
  void messagesPromise.catch(() => {
    if (localeMessagePromises.get(resolvedLocale) === messagesPromise) {
      localeMessagePromises.delete(resolvedLocale)
    }
  })
  return messagesPromise
}
