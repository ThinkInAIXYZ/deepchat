import { describe, expect, it, vi } from 'vitest'

import { OcrSettings } from '@/ocr/ocrSettings'

describe('OcrSettings', () => {
  it('defaults automatic extraction on and normalizes unknown backends to auto', () => {
    const values = new Map<string, unknown>([['ocr.backend', 'gpu']])
    const settings = {
      get: vi.fn((key: string) => values.get(key)),
      set: vi.fn((key: string, value: unknown) => values.set(key, value))
    }
    const publish = vi.fn()
    const ocrSettings = new OcrSettings(settings as never, publish)

    expect(ocrSettings.getAutomaticExtractionEnabled()).toBe(true)
    expect(ocrSettings.getBackend()).toBe('auto')
  })

  it('writes raw settings and publishes typed renderer settings changes', () => {
    const values = new Map<string, unknown>()
    const settings = {
      get: vi.fn((key: string) => values.get(key)),
      set: vi.fn((key: string, value: unknown) => values.set(key, value))
    }
    const publish = vi.fn()
    const ocrSettings = new OcrSettings(settings as never, publish)

    ocrSettings.setAutomaticExtractionEnabled(false)
    ocrSettings.setBackend('cpu')

    expect(values.get('ocr.autoExtractForNonVisionModels')).toBe(false)
    expect(values.get('ocr.backend')).toBe('cpu')
    expect(publish).toHaveBeenNthCalledWith(
      1,
      'settings.changed',
      expect.objectContaining({
        changedKeys: ['ocrAutoExtractForNonVisionModels'],
        values: { ocrAutoExtractForNonVisionModels: false }
      })
    )
    expect(publish).toHaveBeenNthCalledWith(
      2,
      'settings.changed',
      expect.objectContaining({ changedKeys: ['ocrBackend'], values: { ocrBackend: 'cpu' } })
    )
  })
})
