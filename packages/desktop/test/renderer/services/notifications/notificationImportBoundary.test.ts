import { relative, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const RENDERER_ROOT = 'src/renderer'
const ALLOWED_VUE_SONNER_IMPORTERS = [
  'src/renderer/services/notifications/NotificationHost.vue',
  'src/renderer/services/notifications/sonnerNotificationPresenter.ts'
]
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.vue'
])
const VUE_SONNER_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]vue-sonner['"]/

const listRendererSources = async (): Promise<string[]> => {
  const { readdirSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
  const files: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(resolve(directory), { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
      } else if (SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
        files.push(relative(process.cwd(), path).replace(/\\/g, '/'))
      }
    }
  }

  visit(RENDERER_ROOT)
  return files.sort()
}

describe('notification import boundary', () => {
  it('keeps vue-sonner behind the notification presentation adapter', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const importers: string[] = []

    for (const path of await listRendererSources()) {
      const source = readFileSync(resolve(path), 'utf8')
      if (VUE_SONNER_IMPORT.test(source)) {
        importers.push(path)
      }
    }

    expect(importers).toEqual(ALLOWED_VUE_SONNER_IMPORTERS)
  })

  it('does not retain the legacy toast compatibility entry point', async () => {
    const compatibilityEntrypoints = (await listRendererSources()).filter((path) =>
      /(?:^|\/)use-toast\.(?:[cm]?[jt]sx?|vue)$/.test(path)
    )

    expect(compatibilityEntrypoints).toEqual([])
  })
})
