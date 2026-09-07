import type { LocaleMessageValue } from 'vue-i18n'
import { resolveSupportedLocale, type SupportedLocale } from '@shared/locales'

export { pluralRules } from './pluralRules'
export {
  FALLBACK_LOCALE,
  SUPPORTED_LOCALES,
  resolveSupportedLocale,
  type SupportedLocale
} from '@shared/locales'
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

const localeMessagePromises = new Map<SupportedLocale, Promise<RendererLocaleMessages>>()

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
