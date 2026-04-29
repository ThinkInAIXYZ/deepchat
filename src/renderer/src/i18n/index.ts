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
import heIL from './he-IL'

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
  'he-IL': heIL,
  zh: zhCN,
  en: enUS,
  fr: frFR,
  pt: ptBR,
  da: daDK,
  he: heIL
}

export const pluralRules = {
  'ru-RU': (choice: number, choicesLength: number) => {
    if (choicesLength !== 4) {
      return Math.min(Math.abs(choice), choicesLength - 1)
    }

    const absoluteChoice = Math.abs(choice)
    if (absoluteChoice === 0) {
      return 0
    }

    const mod10 = absoluteChoice % 10
    const mod100 = absoluteChoice % 100
    if (mod10 === 1 && mod100 !== 11) {
      return 1
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return 2
    }
    return 3
  }
}

console.log('locales', locales)
export default locales
