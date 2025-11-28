import zhCN from './zh-CN'
import enUS from './en-US'
import jaJP from './ja-JP'
import koKR from './ko-KR'
import zhHK from './zh-HK'
import zhTW from './zh-TW'
import ruRU from './ru-RU'
import frFR from './fr-FR'
import faIR from './fa-IR'
import ptBR from './pt-BR'
import daDK from './da-DK'

const locales = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'zh-HK': zhHK,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'ru-RU': ruRU,
  'fr-FR': frFR,
  'fa-IR': faIR,
  'pt-BR': ptBR,
  'da-DK': daDK,
  zh: zhCN,
  en: enUS,
  fr: frFR,
  pt: ptBR,
  da: daDK
}
console.log('locales', locales)
export default locales
