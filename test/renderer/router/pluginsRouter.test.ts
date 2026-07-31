import { describe, expect, it, vi } from 'vitest'

describe('plugins router', () => {
  it('resolves built-in OCR before the dynamic plugin detail route', async () => {
    vi.resetModules()
    vi.doMock('vue-router', async () => vi.importActual<typeof import('vue-router')>('vue-router'))
    const router = (await import('../../../src/renderer/src/router')).default

    expect(router.resolve({ name: 'plugins-builtin-ocr' }).path).toBe('/plugins/builtin/ocr')
    expect(router.resolve('/plugins/builtin/ocr').name).toBe('plugins-builtin-ocr')
  })
})
