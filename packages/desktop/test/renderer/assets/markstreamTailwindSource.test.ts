import { describe, expect, it, vi } from 'vitest'

const readText = async (path: string) => {
  const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
  return readFileSync(path, 'utf8')
}

describe('markstream Tailwind source', () => {
  it('points Tailwind at the generated markstream candidate file', async () => {
    const { existsSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const { resolve } = await vi.importActual<typeof import('node:path')>('node:path')
    const styleCss = await readText(resolve('src/renderer/src/assets/style.css'))
    const markstreamTailwindSource = resolve('node_modules/markstream-vue/dist/tailwind.js')

    expect(styleCss).toContain('markstream-vue/dist/tailwind.js')
    expect(existsSync(markstreamTailwindSource)).toBe(true)

    const candidates = await readText(markstreamTailwindSource)
    expect(candidates).toContain('code-block-header')
    expect(candidates).toContain('px-[var(--ms-inset-panel-x)]')
    expect(candidates).toContain('py-[var(--ms-inset-panel-y)]')
    expect(candidates).toContain('p-[var(--ms-action-btn-padding)]')
    expect(candidates).toContain('bg-[var(--code-header-bg)]')
    expect(candidates).toContain('text-[var(--code-action-fg)]')
  })
})
