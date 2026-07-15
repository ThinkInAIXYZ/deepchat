import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

async function readSource(path: string): Promise<string> {
  const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
  return readFileSync(resolve(path), 'utf8')
}

describe('chat scroll architecture', () => {
  it('keeps every ChatPage viewport write inside the scroll controller', async () => {
    const chatPageSource = await readSource('src/renderer/src/pages/ChatPage.vue')
    const forbiddenWrites = [
      /\.scrollTop\s*[+\-*/]?=/,
      /\.scrollTo\s*\(/,
      /\.scrollBy\s*\(/,
      /\.scrollIntoView\s*\(/
    ]

    forbiddenWrites.forEach((pattern) => expect(chatPageSource).not.toMatch(pattern))
  })

  it('has one low-level scrollbar assignment in the controller', async () => {
    const controllerSource = await readSource(
      'src/renderer/src/composables/chat/useChatScrollController.ts'
    )
    const assignments = controllerSource.match(/viewport\.scrollTop\s*=/g) ?? []

    expect(assignments).toHaveLength(1)
  })
})
