import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { captureCurrentAreaMock, stitchImagesWithWatermarkMock, copyImageMock } = vi.hoisted(() => ({
  captureCurrentAreaMock: vi.fn(),
  stitchImagesWithWatermarkMock: vi.fn(),
  copyImageMock: vi.fn()
}))

vi.mock('@api/TabClient', () => ({
  TabClient: vi.fn(() => ({
    captureCurrentArea: captureCurrentAreaMock,
    stitchImagesWithWatermark: stitchImagesWithWatermarkMock
  }))
}))

vi.mock('@api/DeviceClient', () => ({
  DeviceClient: vi.fn(() => ({
    copyImage: copyImageMock
  }))
}))

describe('usePageCapture', () => {
  beforeEach(() => {
    captureCurrentAreaMock.mockReset()
    stitchImagesWithWatermarkMock.mockReset()
    copyImageMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('captures the final clipped segment without reporting invalid capture height', async () => {
    const { usePageCapture } = await import('@/composables/usePageCapture')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let scrollTop = 0

    const container = document.createElement('div')
    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value
      }
    })
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      get: () => 700
    })
    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      get: () => 300
    })

    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      width: 400,
      height: 300,
      top: 100,
      right: 500,
      bottom: 400,
      left: 100,
      toJSON: () => ({})
    } as DOMRect)

    captureCurrentAreaMock
      .mockResolvedValueOnce('segment-1')
      .mockResolvedValueOnce('segment-2')
      .mockResolvedValueOnce('segment-3')
    stitchImagesWithWatermarkMock.mockResolvedValue('final-image')

    const { captureArea } = usePageCapture()
    const result = await captureArea({
      container,
      getTargetRect: () => ({
        x: 100,
        y: 144,
        width: 400,
        height: 700
      }),
      containerHeaderOffset: 44,
      captureDelay: 0
    })

    expect(result).toEqual({
      success: true,
      imageData: 'final-image'
    })
    expect(captureCurrentAreaMock).toHaveBeenCalledTimes(3)
    expect(captureCurrentAreaMock).toHaveBeenNthCalledWith(1, {
      x: 100,
      y: 144,
      width: 380,
      height: 256
    })
    expect(captureCurrentAreaMock).toHaveBeenNthCalledWith(2, {
      x: 100,
      y: 144,
      width: 380,
      height: 256
    })
    expect(captureCurrentAreaMock).toHaveBeenNthCalledWith(3, {
      x: 100,
      y: 256,
      width: 380,
      height: 144
    })
    expect(stitchImagesWithWatermarkMock).toHaveBeenCalledWith(
      ['segment-1', 'segment-2', 'segment-3'],
      {}
    )
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('可捕获高度无效'))
  })
})
