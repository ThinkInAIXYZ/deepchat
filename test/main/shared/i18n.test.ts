import { describe, expect, it } from 'vitest'

import { contextMenuTranslations, getContextMenuLabels } from '@shared/i18n'
import {
  FALLBACK_LOCALE,
  SUPPORTED_LOCALES,
  getLocaleDirection,
  resolveRequestedLocale,
  resolveSupportedLocale
} from '@shared/locales'

describe('shared locale manifest', () => {
  it('resolves exact locales before explicit language fallbacks', () => {
    expect(resolveSupportedLocale('zh-TW')).toBe('zh-TW')
    expect(resolveSupportedLocale('zh_HK')).toBe('zh-HK')
    expect(resolveSupportedLocale('zh-Hant')).toBe('zh-TW')
    expect(resolveSupportedLocale('zh-Hant-HK')).toBe('zh-HK')
    expect(resolveSupportedLocale('zh-Hans-HK')).toBe('zh-CN')
    expect(resolveSupportedLocale('fr-CA')).toBe('fr-FR')
    expect(resolveSupportedLocale('de-AT')).toBe('de-DE')
    expect(resolveSupportedLocale('unknown')).toBe(FALLBACK_LOCALE)
  })

  it('normalizes requested locales and direction metadata', () => {
    expect(resolveRequestedLocale('SYSTEM')).toBe('system')
    expect(resolveRequestedLocale('PT')).toBe('pt-BR')
    expect(getLocaleDirection('fa-IR')).toBe('rtl')
    expect(getLocaleDirection('he')).toBe('rtl')
    expect(getLocaleDirection('en-US')).toBe('auto')
  })

  it('only exposes native translation maps for supported locales', () => {
    expect(
      Object.keys(contextMenuTranslations).every((locale) => {
        return SUPPORTED_LOCALES.includes(locale as (typeof SUPPORTED_LOCALES)[number])
      })
    ).toBe(true)
  })
})

describe('native menu translations', () => {
  it('uses the exact Traditional Chinese map', () => {
    expect(getContextMenuLabels('zh-TW')).toMatchObject({
      copy: '複製',
      file: '檔案'
    })
  })

  it('uses the Taiwan map as the explicit Hong Kong fallback', () => {
    expect(getContextMenuLabels('zh-HK')).toMatchObject({
      copy: '複製',
      file: '檔案'
    })
  })

  it('keeps available base-language translations and fills missing labels from English', () => {
    expect(getContextMenuLabels('ja-JP')).toMatchObject({
      copy: 'コピー',
      file: 'File'
    })
    expect(getContextMenuLabels('ko-KR')).toMatchObject({
      copy: '복사',
      file: 'File'
    })
    expect(getContextMenuLabels('fr-CA')).toMatchObject({
      copy: 'Copier',
      file: 'File'
    })
  })

  it('resolves unsupported regions through the locale manifest', () => {
    expect(getContextMenuLabels('de-AT')).toMatchObject({
      copy: 'Kopieren',
      file: 'Datei'
    })
    expect(getContextMenuLabels('unknown')).toMatchObject({
      copy: 'Copy',
      file: 'File'
    })
  })
})
