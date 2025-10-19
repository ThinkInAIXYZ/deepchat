import { describe, it, expect } from 'vitest'
import { useViewportSize } from '@/composables/useViewportSize'

describe('useViewportSize', () => {
  it('manages size and returns fixed dimensions for tablet/mobile', () => {
    const api = useViewportSize()
    expect(api.viewportSize.value).toBe('desktop')
    expect(api.getDimensions()).toBeNull()

    api.setViewportSize('tablet')
    expect(api.viewportSize.value).toBe('tablet')
    expect(api.getDimensions()).toEqual({ width: api.TABLET_WIDTH, height: api.TABLET_HEIGHT })

    api.setViewportSize('mobile')
    expect(api.getDimensions()).toEqual({ width: api.MOBILE_WIDTH, height: api.MOBILE_HEIGHT })
  })
})
