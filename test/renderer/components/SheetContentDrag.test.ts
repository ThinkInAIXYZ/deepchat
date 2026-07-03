import { readFile } from 'fs/promises'
import { describe, expect, it } from 'vitest'

describe('SheetContent drag region', () => {
  it('keeps the close button outside the Electron drag region', async () => {
    const source = await readFile('src/shadcn/components/ui/sheet/SheetContent.vue', 'utf-8')
    const closeButton = source.match(/<DialogClose[\s\S]*?>/)?.[0] ?? ''

    expect(closeButton).toContain('window-no-drag-region')
    expect(closeButton).toContain('-webkit-app-region: no-drag')
  })
})
