import { resolve, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

async function readSource(path: string): Promise<string> {
  const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
  return readFileSync(resolve(path), 'utf8')
}

type ScrollWriteKind = 'scroll' | 'scrollBy' | 'scrollIntoView' | 'scrollTo' | 'scrollTop'

const RENDERER_ROOT = 'src/renderer/src'
const CONTROLLER_PATH = 'src/renderer/src/composables/chat/useChatScrollController.ts'
const scrollWritePatterns: ReadonlyArray<[ScrollWriteKind, RegExp]> = [
  ['scrollTop', /\.scrollTop\s*[+\-*/]?=/g],
  ['scrollTo', /\.scrollTo\s*\(/g],
  ['scrollBy', /\.scrollBy\s*\(/g],
  ['scroll', /\.scroll\s*\(/g],
  ['scrollIntoView', /\.scrollIntoView\s*\(/g]
]

// These target independent surfaces such as the sidebar, editor, popovers, page capture,
// or document anchors. Any new direct renderer scroll API must be reviewed explicitly.
const allowedDirectScrollWrites: Record<string, ScrollWriteKind[]> = {
  'src/renderer/src/components/chat/ChatInputBox.vue': ['scrollIntoView', 'scrollIntoView'],
  'src/renderer/src/components/chat/mentions/SuggestionList.vue': ['scrollIntoView'],
  'src/renderer/src/components/markdown/useMarkdownLinkNavigation.ts': [
    'scrollIntoView',
    'scrollIntoView'
  ],
  'src/renderer/src/components/spotlight/SpotlightOverlay.vue': ['scrollIntoView'],
  'src/renderer/src/composables/sidebar/useSessionListAutoFill.ts': ['scrollTop'],
  'src/renderer/src/composables/usePageCapture.ts': ['scrollTop', 'scrollTo'],
  'src/renderer/src/lib/chatSearch.ts': ['scrollIntoView', 'scrollIntoView']
}

async function listRendererSources(): Promise<string[]> {
  const { readdirSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
  const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue'])
  const files: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(resolve(directory), { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
      } else if (extensions.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
        files.push(relative(process.cwd(), path).replace(/\\/g, '/'))
      }
    }
  }

  visit(RENDERER_ROOT)
  return files.sort()
}

describe('chat scroll architecture', () => {
  it('inventories every direct renderer scroll API outside the chat controller', async () => {
    const directWrites: Record<string, ScrollWriteKind[]> = {}

    for (const path of await listRendererSources()) {
      if (path === CONTROLLER_PATH) continue
      const source = await readSource(path)
      const writes = scrollWritePatterns.flatMap(([kind, pattern]) =>
        Array.from(source.matchAll(pattern), () => kind)
      )
      if (writes.length > 0) {
        directWrites[path] = writes.sort()
      }
    }

    const expectedWrites = Object.fromEntries(
      Object.entries(allowedDirectScrollWrites).map(([path, writes]) => [path, writes.sort()])
    )
    expect(directWrites).toEqual(expectedWrites)
  })

  it('has one low-level scrollbar assignment in the controller', async () => {
    const controllerSource = await readSource(CONTROLLER_PATH)
    const assignments = controllerSource.match(/viewport\.scrollTop\s*=/g) ?? []

    expect(assignments).toHaveLength(1)
  })
})
