import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { validateLocaleNamespaceRegistrations } from '../../../scripts/lib/i18n-validation.mjs'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

const temporaryRoots: string[] = []

const createFixture = (files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-i18n-validation-'))
  const localeDirectory = path.join(root, 'en-US')
  fs.mkdirSync(localeDirectory)
  temporaryRoots.push(root)

  for (const [fileName, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(localeDirectory, fileName), content)
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
    })

    expect(validateLocaleNamespaceRegistrations(root)).toMatchObject({
      issues: [],
      localeCount: 1,
      namespaceRegistrationCount: 2
    })
  })

  it('reports missing imports and exports independently', () => {
    const root = createFixture({
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
