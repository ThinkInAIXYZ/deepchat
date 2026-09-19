import { getLanguageFromFilename } from '@shared/utils/codeLanguage'
import { normalizeLanguageIdentifier } from 'markstream-vue'

// The shared filename map also serves Monaco and contains IDs that Shiki does not provide.
const MARKSTREAM_LANGUAGE_REPLACEMENTS: Readonly<Record<string, string>> = {
  apacheconf: 'apache',
  configuration: 'ini',
  'desktop-local-file': 'plaintext',
  fortran: 'fortran-free-form',
  gitignore: 'plaintext'
}

const replaceUnsupportedLanguage = (language: string): string =>
  MARKSTREAM_LANGUAGE_REPLACEMENTS[language] ?? language

export const getMarkstreamLanguageFromFilename = (filename?: string): string =>
  replaceUnsupportedLanguage(normalizeLanguageIdentifier(getLanguageFromFilename(filename)))

export const normalizeMarkstreamCodeFenceLanguages = (content: string): string =>
  content.replace(/(^|\n)(`{3,}|~{3,})([^\r\n]*)/g, (fence, lineStart, delimiter, info) => {
    const [languageWithSuffix, ...meta] = info.trim().split(/\s+/)
    const [language] = languageWithSuffix.split(':')
    const suffix = languageWithSuffix.slice(language.length)
    const resolvedLanguage = normalizeLanguageIdentifier(language)
    const replacement = replaceUnsupportedLanguage(resolvedLanguage)
    if (replacement === language) return fence

    return `${lineStart}${delimiter}${replacement}${suffix}${meta.length ? ` ${meta.join(' ')}` : ''}`
  })
