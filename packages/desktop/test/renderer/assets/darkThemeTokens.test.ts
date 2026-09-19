import { describe, expect, it, vi } from 'vitest'

const readText = async (path: string) => {
  const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
  return readFileSync(path, 'utf8')
}

describe('dark theme tokens', () => {
  it('uses the #121212 surface baseline and Dashboard hover accent for shadcn tokens', async () => {
    const { resolve } = await vi.importActual<typeof import('node:path')>('node:path')
    const styleCss = await readText(resolve('src/renderer/src/assets/style.css'))

    expect(styleCss).toContain('--card: hsl(0 0% 7.1%);')
    expect(styleCss).toContain('--popover: hsl(0 0% 7.1%);')
    expect(styleCss).toContain('--accent: hsl(0 0 100% / 0.1);')
    expect(styleCss).not.toContain('hsl(0 0 20% / 1)')
  })
})
