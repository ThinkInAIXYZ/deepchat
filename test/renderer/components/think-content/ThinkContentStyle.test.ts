import { describe, expect, it, vi } from 'vitest'

describe('ThinkContent styles', () => {
  it('keeps markdown headings at the reasoning body font size', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const { resolve } = await vi.importActual<typeof import('node:path')>('node:path')
    const source = readFileSync(
      resolve('src/renderer/src/components/think-content/ThinkContent.vue'),
      'utf8'
    )

    expect(source).toContain('--ms-text-h1: var(--ms-text-body)')
    expect(source).toContain('--ms-text-h2: var(--ms-text-body)')
    expect(source).toContain('--ms-text-h3: var(--ms-text-body)')
    expect(source).toContain('--ms-leading-h1: var(--ms-leading-body)')
    expect(source).toContain(':deep(:where(h1, h2, h3, h4, h5, h6, .heading-node))')
    expect(source).toContain('font-size: inherit')
  })
})
