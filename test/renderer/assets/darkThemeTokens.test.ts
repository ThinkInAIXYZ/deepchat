import { describe, expect, it, vi } from 'vitest'

const readText = async (path: string) => {
  const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
  return readFileSync(path, 'utf8')
}

describe('dark theme tokens', () => {
  it('uses neutral charcoal surfaces and readable secondary text in both dark paths', async () => {
    const { resolve } = await vi.importActual<typeof import('node:path')>('node:path')
    const styleCss = await readText(resolve('src/renderer/src/assets/style.css'))

    const darkStart = styleCss.indexOf('  .dark,')
    const systemDarkStart = styleCss.indexOf('  @media')
    const themeStart = styleCss.indexOf('  @theme')
    expect(darkStart, 'explicit dark theme block').toBeGreaterThanOrEqual(0)
    expect(systemDarkStart, 'system dark theme block').toBeGreaterThan(darkStart)
    expect(themeStart, 'theme block after dark themes').toBeGreaterThan(systemDarkStart)

    for (const block of [
      styleCss.slice(darkStart, systemDarkStart),
      styleCss.slice(systemDarkStart, themeStart)
    ]) {
      expect(block).toContain('--background: #191b1d;')
      expect(block).toContain('--card: #24272a;')
      expect(block).toContain('--popover: #24272a;')
      expect(block).toContain('--muted-foreground: #a0a7b1;')
      expect(block).toContain('--bg-window-background: var(--sidebar);')
    }
  })
})
