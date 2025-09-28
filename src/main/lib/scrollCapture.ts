import { NativeImage, WebContentsView, nativeImage } from 'electron'
import sharp from 'sharp'

export interface ScrollCaptureOptions {
  hideElements?: string[] // CSS selector array for hiding specific elements
  maxSegmentHeight?: number // Maximum segment height ratio, default 0.8
  segmentDelay?: number // Delay between segment captures, default 300ms
  isDark?: boolean
  version?: string
  texts?: {
    brand?: string
    time?: string
    tip?: string
  }
}

export interface ScrollCaptureRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SegmentInfo {
  x: number
  y: number
  width: number
  height: number
  scrollY: number
  segmentIndex: number
}

export class ScrollCaptureManager {
  private view: WebContentsView
  private originalScrollPosition = { top: 0, left: 0 }
  private hiddenElements: string[] = []

  constructor(view: WebContentsView) {
    this.view = view
  }

  /**
   * Perform scrollable screenshot capture
   */
  async captureScrollableArea(
    rect: ScrollCaptureRect,
    options: ScrollCaptureOptions = {}
  ): Promise<Buffer[]> {
    if (this.view.webContents.isDestroyed()) {
      throw new Error('WebContents is destroyed')
    }

    try {
      console.log(`Starting scrollable capture for area:`, rect)

      // Get page information
      const pageInfo = await this.getPageInfo()

      // Save original scroll position
      this.originalScrollPosition = {
        top: pageInfo.scrollTop,
        left: pageInfo.scrollLeft
      }

      // Hide specified elements
      if (options.hideElements && options.hideElements.length > 0) {
        await this.hideElements(options.hideElements)
      }

      // Calculate segmentation strategy
      const maxSegmentHeight = Math.floor(
        pageInfo.viewportHeight * (options.maxSegmentHeight || 0.8)
      )
      const segments = this.calculateSegments(rect, maxSegmentHeight)

      console.log(`Splitting into ${segments.length} segments`)

      // If only one segment, capture directly
      if (segments.length === 1) {
        return await this.captureSingleSegment(segments[0], options.segmentDelay || 200)
      }

      // Capture segments sequentially
      const segmentImages: Buffer[] = []
      for (const segment of segments) {
        console.log(
          `Capturing segment ${segment.segmentIndex + 1}/${segments.length} at scroll position ${segment.scrollY}`
        )

        const images = await this.captureSingleSegment(segment, options.segmentDelay || 300)
        segmentImages.push(...images)
      }

      return segmentImages
    } finally {
      // Cleanup: restore hidden elements and scroll position
      await this.cleanup()
    }
  }

  /**
   * Get page information
   */
  private async getPageInfo(): Promise<{
    viewportWidth: number
    viewportHeight: number
    scrollTop: number
    scrollLeft: number
    devicePixelRatio: number
  }> {
    return await this.view.webContents.executeJavaScript(`
      (function() {
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollTop: document.documentElement.scrollTop || document.body.scrollTop,
          scrollLeft: document.documentElement.scrollLeft || document.body.scrollLeft,
          devicePixelRatio: window.devicePixelRatio || 1
        }
      })()
    `)
  }

  /**
   * Hide specified elements
   */
  private async hideElements(selectors: string[]): Promise<void> {
    console.log(`Hiding elements:`, selectors)

    for (const selector of selectors) {
      const elementInfo = await this.view.webContents.executeJavaScript(`
        (function() {
          const elements = document.querySelectorAll('${selector}')
          const hiddenElements = []
          elements.forEach((el, index) => {
            if (el && el.style.display !== 'none' && el.style.visibility !== 'hidden') {
              const id = 'scroll-capture-hidden-' + Date.now() + '-' + index
              el.setAttribute('data-scroll-capture-id', id)
              el.setAttribute('data-scroll-capture-original-display', el.style.display || '')
              el.style.display = 'none'
              hiddenElements.push(id)
            }
          })
          return hiddenElements
        })()
      `)
      this.hiddenElements.push(...elementInfo)
    }
  }

  /**
   * Calculate segment information
   */
  private calculateSegments(rect: ScrollCaptureRect, maxSegmentHeight: number): SegmentInfo[] {
    const segments: SegmentInfo[] = []
    let currentY = rect.y
    let segmentIndex = 0

    console.log(
      `Calculating segments for rect: y=${rect.y}, height=${rect.height}, maxSegmentHeight=${maxSegmentHeight}`
    )

    while (currentY < rect.y + rect.height) {
      const remainingHeight = rect.y + rect.height - currentY
      const segmentHeight = Math.min(maxSegmentHeight, remainingHeight)

      // Ensure segments don't exceed original area
      const actualSegmentHeight = Math.min(segmentHeight, rect.y + rect.height - currentY)

      segments.push({
        x: rect.x,
        y: 0, // Always relative to viewport top when capturing
        width: rect.width,
        height: actualSegmentHeight,
        scrollY: currentY, // Absolute position to scroll to
        segmentIndex: segmentIndex++
      })

      console.log(`Segment ${segmentIndex}: scrollY=${currentY}, height=${actualSegmentHeight}`)

      currentY += actualSegmentHeight
    }

    console.log(`Total segments calculated: ${segments.length}`)
    return segments
  }

  /**
   * Capture single segment
   */
  private async captureSingleSegment(segment: SegmentInfo, delay: number): Promise<Buffer[]> {
    // Scroll to target position, maintain original horizontal scroll position
    await this.view.webContents.executeJavaScript(`
      window.scrollTo({
        top: ${segment.scrollY},
        left: ${this.originalScrollPosition.left},
        behavior: 'instant'
      })
    `)

    // Wait for scrolling and rendering to complete
    await new Promise((resolve) => setTimeout(resolve, delay))

    // Calculate capture area: recalculate position relative to viewport after scrolling
    const captureRect = await this.view.webContents.executeJavaScript(`
      (function() {
        const currentScrollTop = document.documentElement.scrollTop || document.body.scrollTop;
        const targetY = ${segment.scrollY};
        const originalRectY = ${segment.scrollY}; // This is absolute position

        // Capture area position relative to current viewport
        const relativeY = Math.max(0, originalRectY - currentScrollTop);

        return {
          x: ${segment.x},
          y: relativeY,
          width: ${segment.width},
          height: ${segment.height}
        };
      })()
    `)

    console.log(`Segment ${segment.segmentIndex + 1} capture rect:`, captureRect)

    // Capture current segment
    const segmentImage = await this.view.webContents.capturePage(captureRect)

    if (!segmentImage.isEmpty()) {
      return [segmentImage.toPNG()]
    } else {
      console.warn(`Segment ${segment.segmentIndex + 1} capture failed`)
      return []
    }
  }

  /**
   * Restore hidden elements
   */
  private async restoreHiddenElements(): Promise<void> {
    if (this.hiddenElements.length === 0) return

    await this.view.webContents.executeJavaScript(`
      (function() {
        const ids = ${JSON.stringify(this.hiddenElements)}
        ids.forEach(id => {
          const element = document.querySelector('[data-scroll-capture-id="' + id + '"]')
          if (element) {
            const originalDisplay = element.getAttribute('data-scroll-capture-original-display') || ''
            element.style.display = originalDisplay
            element.removeAttribute('data-scroll-capture-id')
            element.removeAttribute('data-scroll-capture-original-display')
          }
        })
      })()
    `)

    this.hiddenElements = []
  }

  /**
   * Restore original scroll position
   */
  private async restoreScrollPosition(): Promise<void> {
    await this.view.webContents.executeJavaScript(`
      window.scrollTo({
        top: ${this.originalScrollPosition.top},
        left: ${this.originalScrollPosition.left},
        behavior: 'instant'
      })
    `)
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    await this.restoreHiddenElements()
    await this.restoreScrollPosition()
  }
}

/**
 * Vertically stitch multiple image buffers
 */
export async function stitchImagesVertically(imageBuffers: Buffer[]): Promise<NativeImage> {
  if (imageBuffers.length === 0) {
    throw new Error('No images to stitch')
  }

  if (imageBuffers.length === 1) {
    return nativeImage.createFromBuffer(imageBuffers[0])
  }

  console.log(`Starting to stitch ${imageBuffers.length} images using Sharp`)

  // Get metadata for all images
  const imageInfos = await Promise.all(
    imageBuffers.map(async (buffer, index) => {
      try {
        const metadata = await sharp(buffer).metadata()
        console.log(`Image ${index + 1} dimensions: ${metadata.width}x${metadata.height}`)
        return {
          buffer,
          width: metadata.width || 0,
          height: metadata.height || 0,
          index
        }
      } catch (error) {
        console.error(`Failed to get metadata for image ${index + 1}:`, error)
        throw error
      }
    })
  )

  // Calculate stitched image dimensions
  const maxWidth = Math.max(...imageInfos.map((info) => info.width))
  const totalHeight = imageInfos.reduce((sum, info) => sum + info.height, 0)

  console.log(`Stitched image dimensions: ${maxWidth}x${totalHeight}`)

  // Create blank canvas
  const canvas = sharp({
    create: {
      width: maxWidth,
      height: totalHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })

  // Prepare composite operation
  const composite: Array<{
    input: Buffer
    top: number
    left: number
  }> = []
  let currentTop = 0

  for (const imageInfo of imageInfos) {
    // Calculate center position
    const left = Math.floor((maxWidth - imageInfo.width) / 2)

    composite.push({
      input: imageInfo.buffer,
      top: currentTop,
      left: left
    })

    console.log(`Image ${imageInfo.index + 1} will be placed at position (${left}, ${currentTop})`)
    currentTop += imageInfo.height
  }

  // Execute composition
  const stitchedBuffer = await canvas.composite(composite).png().toBuffer()

  // Create NativeImage
  const stitchedImage = nativeImage.createFromBuffer(stitchedBuffer)

  console.log(`Successfully stitched ${imageBuffers.length} images using Sharp`)
  return stitchedImage
}
