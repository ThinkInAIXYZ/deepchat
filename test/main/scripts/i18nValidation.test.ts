import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  validateLocaleMessageContracts,
  validateLocaleNamespaceRegistrations
} from '../../../scripts/lib/i18n-validation.mjs'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

const temporaryRoots: string[] = []

const createFixture = (locales: Record<string, Record<string, string>>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-i18n-validation-'))
  temporaryRoots.push(root)

  for (const [locale, files] of Object.entries(locales)) {
    const localeDirectory = path.join(root, locale)
    fs.mkdirSync(localeDirectory)
    for (const [fileName, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(localeDirectory, fileName), content)
    }
  }

  return root
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('i18n namespace validation', () => {
  it('accepts indexes that import and export every JSON namespace', () => {
    const root = createFixture({
      'en-US': {
        'common.json': '{}',
        'traceDialog.json': '{}',
        'index.ts': [
          "import common from './common.json'",
          "import traceDialog from './traceDialog.json'",
          '',
          'export default {',
          '  common,',
          '  traceDialog',
          '}'
        ].join('\n')
      }
    })

    expect(validateLocaleNamespaceRegistrations(root)).toMatchObject({
      issues: [],
      localeCount: 1,
      namespaceRegistrationCount: 2
    })
  })

  it('reports missing imports and exports independently', () => {
    const root = createFixture({
      'en-US': {
        'common.json': '{}',
        'traceDialog.json': '{}',
        'index.ts': [
          "import common from './common.json'",
          "import traceDialog from './traceDialog.json'",
          '',
          'export default {',
          '  common',
          '}'
        ].join('\n')
      }
    })
    fs.writeFileSync(path.join(root, 'en-US', 'orphan.json'), '{}')

    expect(validateLocaleNamespaceRegistrations(root).issues).toEqual([
      { kind: 'missing-import', locale: 'en-US', namespace: 'orphan' },
      { kind: 'missing-export', locale: 'en-US', namespace: 'traceDialog' }
    ])
  })

  it('passes against the repository locale indexes', () => {
    const i18nRoot = path.resolve('src/renderer/src/i18n')

    expect(validateLocaleNamespaceRegistrations(i18nRoot).issues).toEqual([])
  })
})

describe('i18n message contract validation', () => {
  it('reports named and list parameter mismatches', () => {
    const root = createFixture({
      'en-US': {
        'common.json': JSON.stringify({ message: 'Hello {name}, item {0}' })
      },
      'fr-FR': {
        'common.json': JSON.stringify({ message: 'Bonjour {nom}, élément {1}' })
      }
    })

    expect(validateLocaleMessageContracts(root).issues).toEqual([
      {
        kind: 'message-contract-mismatch',
        locale: 'fr-FR',
        key: 'common.message',
        expected: {
          namedParameters: ['name'],
          listParameters: ['0'],
          literalValues: []
        },
        actual: {
          namedParameters: ['nom'],
          listParameters: ['1'],
          literalValues: []
        }
      }
    ])
  })

  it('distinguishes literal braces from named parameters and rejects double quotes', () => {
    const root = createFixture({
      'en-US': {
        'common.json': JSON.stringify({ message: "Use {'{'}query{'}'}" })
      },
      'es-ES': {
        'common.json': JSON.stringify({ message: 'Usa {query}' })
      },
      'zh-HK': {
        'common.json': JSON.stringify({ message: '使用 {"{"}query{"}"}' })
      }
    })

    expect(validateLocaleMessageContracts(root).issues).toEqual([
      {
        kind: 'message-contract-mismatch',
        locale: 'es-ES',
        key: 'common.message',
        expected: {
          namedParameters: [],
          listParameters: [],
          literalValues: ['{', '}']
        },
        actual: {
          namedParameters: ['query'],
          listParameters: [],
          literalValues: []
        }
      },
      {
        kind: 'invalid-literal-interpolation',
        locale: 'zh-HK',
        key: 'common.message'
      }
    ])
  })

  it('passes against the repository locale messages', () => {
    const i18nRoot = path.resolve('src/renderer/src/i18n')

    expect(validateLocaleMessageContracts(i18nRoot).issues).toEqual([])
  })
})
