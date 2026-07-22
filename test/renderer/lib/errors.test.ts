import { describe, expect, it } from 'vitest'
import { isAbortError } from '@/lib/errors'

describe('isAbortError', () => {
  it('recognizes native and Electron-serialized abort errors', () => {
    const nativeAbort = new Error('Aborted')
    nativeAbort.name = 'AbortError'

    expect(isAbortError(nativeAbort)).toBe(true)
    expect(
      isAbortError(
        new Error("Error invoking remote method 'deepchat:route:invoke': Error: Aborted")
      )
    ).toBe(true)
    expect(isAbortError(new Error('This operation was aborted'))).toBe(true)
  })

  it('does not classify unrelated failures as cancellation', () => {
    expect(isAbortError(new Error('OCR runtime unavailable'))).toBe(false)
  })
})
