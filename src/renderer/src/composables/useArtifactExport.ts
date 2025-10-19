// === Types ===
import type { ArtifactState } from '@/stores/artifact'

// === External Dependencies ===
import mermaid from 'mermaid'

interface WatermarkConfig {
  isDark: boolean
  version: string
  texts: {
    brand: string
    tip: string
  }
}

interface CaptureOptions {
  container: string
  getTargetRect: () => { x: number; y: number; width: number; height: number } | null
  isHTMLIframe: boolean
  watermark: WatermarkConfig
}

/**
 * Get file extension based on artifact type
 */
const getFileExtension = (type: string): string => {
  switch (type) {
    case 'application/vnd.ant.code':
      return 'txt'
    case 'text/markdown':
      return 'md'
    case 'text/html':
      return 'html'
    case 'image/svg+xml':
      return 'svg'
    case 'application/vnd.ant.mermaid':
      return 'mmd'
    case 'application/vnd.ant.react':
      return 'jsx'
    default:
      return 'txt'
  }
}

/**
 * Download blob as file
 */
const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Composable for managing artifact export and copy operations
 *
 * Features:
 * - SVG export with Mermaid rendering support
 * - Code export with proper file extensions
 * - Text copy to clipboard
 * - Image copy with screenshot capture
 */
export function useArtifactExport(captureAndCopy: (options: CaptureOptions) => Promise<boolean>) {
  /**
   * Export SVG content (including Mermaid diagrams)
   */
  const exportSVG = async (artifact: ArtifactState | null): Promise<void> => {
    if (!artifact?.content) return

    try {
      let svgContent = artifact.content

      // Render Mermaid diagrams to SVG
      if (artifact.type === 'application/vnd.ant.mermaid') {
        const { svg } = await mermaid.render('export-diagram', artifact.content)
        svgContent = svg
      }

      // Validate SVG content
      if (!svgContent.trim().startsWith('<svg')) {
        throw new Error('Invalid SVG content')
      }

      const blob = new Blob([svgContent], { type: 'image/svg+xml' })
      downloadBlob(blob, `${artifact.title || 'artifact'}.svg`)
    } catch (error) {
      console.error('Failed to export SVG:', error)
      throw error
    }
  }

  /**
   * Export code content with appropriate file extension
   */
  const exportCode = (artifact: ArtifactState | null): void => {
    if (!artifact?.content) return

    const extension = getFileExtension(artifact.type)
    const blob = new Blob([artifact.content], { type: 'text/plain' })
    downloadBlob(blob, `${artifact.title || 'artifact'}.${extension}`)
  }

  /**
   * Copy content as text to clipboard
   */
  const copyContent = async (artifact: ArtifactState | null): Promise<void> => {
    if (!artifact?.content) return

    try {
      await navigator.clipboard.writeText(artifact.content)
    } catch (error) {
      console.error('Failed to copy content:', error)
      throw error
    }
  }

  /**
   * Copy artifact as image with screenshot capture
   */
  const copyAsImage = async (
    artifact: ArtifactState | null,
    watermark: WatermarkConfig
  ): Promise<boolean> => {
    if (!artifact) return false

    // Check if artifact is iframe-based (HTML or React)
    const isIframeArtifact =
      artifact.type === 'text/html' || artifact.type === 'application/vnd.ant.react'

    let containerSelector: string
    let targetSelector: string

    if (isIframeArtifact) {
      // For iframe types, use iframe wrapper as both container and target
      containerSelector = '.html-iframe-wrapper'
      targetSelector = '.html-iframe-wrapper'
    } else {
      // For non-iframe types, use default selectors
      containerSelector = '.artifact-scroll-container'
      targetSelector = '.artifact-dialog-content'
    }

    try {
      const success = await captureAndCopy({
        container: containerSelector,
        getTargetRect: () => {
          const element = document.querySelector(targetSelector)
          if (!element) return null
          const rect = element.getBoundingClientRect()
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        },
        isHTMLIframe: isIframeArtifact,
        watermark
      })

      return success
    } catch (error) {
      console.error('Failed to copy as image:', error)
      return false
    }
  }

  // === Return API ===
  return {
    exportSVG,
    exportCode,
    copyContent,
    copyAsImage
  }
}
