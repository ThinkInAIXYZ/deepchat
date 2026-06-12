import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readText = (path: string) => readFileSync(path, 'utf8')

describe('markstream Tailwind source', () => {
  it('points Tailwind at the generated markstream candidate file', () => {
    const styleCss = readText(resolve('src/renderer/src/assets/style.css'))
    const markstreamTailwindSource = resolve('node_modules/markstream-vue/dist/tailwind.js')

    expect(styleCss).toContain('markstream-vue/dist/tailwind.js')
    expect(existsSync(markstreamTailwindSource)).toBe(true)

    const candidates = readText(markstreamTailwindSource)
    expect(candidates).toContain('code-block-header')
    expect(candidates).toContain('px-[var(--ms-inset-panel-x)]')
    expect(candidates).toContain('py-[var(--ms-inset-panel-y)]')
    expect(candidates).toContain('p-[var(--ms-action-btn-padding)]')
    expect(candidates).toContain('bg-[var(--code-header-bg)]')
    expect(candidates).toContain('text-[var(--code-action-fg)]')
  })
})
