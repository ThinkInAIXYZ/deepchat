/**
 * Simple SVG Content Sanitizer
 * Sanitizes SVG content to prevent XSS attacks using regex-based approach
 */

export interface SanitizeOptions {
  allowExternalResources?: boolean
  allowScripts?: boolean
  allowForeignObjects?: boolean
  maxSize?: number
}

const DEFAULT_OPTIONS: Required<SanitizeOptions> = {
  allowExternalResources: false,
  allowScripts: false,
  allowForeignObjects: false,
  maxSize: 1024 * 1024 // 1MB limit
}

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  colon: ':',
  commat: '@',
  gt: '>',
  lt: '<',
  newline: '\n',
  quot: '"',
  tab: '\t'
}

// No need for detailed whitelists in this simplified approach

export class SVGSanitizer {
  private options: Required<SanitizeOptions>

  constructor(options: SanitizeOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Sanitize SVG content using regex-based approach
   * @param svgContent Raw SVG content string
   * @returns Sanitized SVG content or null if invalid
   */
  sanitize(svgContent: string): string | null {
    try {
      // Basic validation
      if (!svgContent || typeof svgContent !== 'string') {
        return null
      }

      // Size check
      if (svgContent.length > this.options.maxSize) {
        console.warn('SVG content exceeds maximum size limit')
        return null
      }

      // Basic SVG structure validation
      if (!this.isValidSVGStructure(svgContent)) {
        console.warn('Invalid SVG structure')
        return null
      }

      // Remove dangerous content step by step
      let sanitized = svgContent

      // 1. Remove comments and CDATA sections
      sanitized = this.removeComments(sanitized)

      // 2. Remove script tags and their content
      sanitized = this.removeScriptTags(sanitized)

      // 3. Remove or sanitize foreignObject elements
      if (!this.options.allowForeignObjects) {
        sanitized = this.removeForeignObjects(sanitized)
      }

      // 4. Remove dangerous attributes
      sanitized = this.removeDangerousAttributes(sanitized)

      // 5. Remove dangerous event handlers
      sanitized = this.removeEventHandlers(sanitized)

      // 6. Sanitize URLs and protocols
      sanitized = this.sanitizeUrls(sanitized)

      // 7. Final validation
      if (!this.validateFinalOutput(sanitized)) {
        return null
      }

      return sanitized
    } catch (error) {
      console.error('SVG sanitization error:', error)
      return null
    }
  }

  /**
   * Validate basic SVG structure
   */
  private isValidSVGStructure(content: string): boolean {
    // Must contain opening and closing svg tags
    const hasSvgTags = /<svg[^>]*>[\s\S]*<\/svg>/i.test(content)
    if (!hasSvgTags) return false

    // Must start with svg tag (after whitespace)
    const startsWithSvg = /^\s*<svg/i.test(content.trim())
    if (!startsWithSvg) return false

    return true
  }

  /**
   * Remove dangerous comments and CDATA sections, keep safe ones
   */
  private removeComments(content: string): string {
    // Remove only dangerous comments that contain scripts or dangerous content
    content = content.replace(/<!--[\s\S]*?-->/g, (match) => {
      if (
        /<script/i.test(match) ||
        /javascript:/i.test(match) ||
        /vbscript:/i.test(match) ||
        /on\w+\s*=/i.test(match)
      ) {
        console.warn('Dangerous comment removed from SVG')
        return ''
      }
      return match // Keep safe comments
    })

    // Remove dangerous CDATA sections
    content = content.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (match) => {
      if (/<script/i.test(match) || /javascript:/i.test(match) || /vbscript:/i.test(match)) {
        console.warn('Dangerous CDATA section removed from SVG')
        return ''
      }
      return match // Keep safe CDATA
    })

    return content
  }

  /**
   * Remove script tags and their content
   */
  private removeScriptTags(content: string): string {
    return content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  }

  /**
   * Remove foreignObject elements and their content
   */
  private removeForeignObjects(content: string): string {
    return content.replace(/<foreignObject[^>]*>[\s\S]*?<\/foreignObject>/gi, '')
  }

  /**
   * Remove dangerous attributes from all elements
   */
  private removeDangerousAttributes(content: string): string {
    // Remove dangerous attributes using regex
    const dangerousAttrPatterns = [
      /\son[a-z]+\s*=\s*["'][^"']*["']/gi, // Event handlers
      /\sjavascript\s*:\s*[^"'\s>]*/gi, // javascript: protocol
      /\svbscript\s*:\s*[^"'\s>]*/gi, // vbscript: protocol
      /\sdata\s*:\s*text\/html[^"'\s>]*/gi, // data:text/html
      /\sstyle\s*=\s*["'][^"']*expression\s*\([^"']*["']/gi, // CSS expressions
      /\sstyle\s*=\s*["'][^"']*javascript\s*:[^"']*["']/gi // CSS javascript
    ]

    let result = content
    for (const pattern of dangerousAttrPatterns) {
      result = result.replace(pattern, '')
    }

    return result
  }

  /**
   * Remove event handlers
   */
  private removeEventHandlers(content: string): string {
    const eventHandlers = [
      'onclick',
      'onload',
      'onerror',
      'onmouseover',
      'onmouseout',
      'onfocus',
      'onblur',
      'onchange',
      'onsubmit',
      'onreset',
      'onselect',
      'onkeydown',
      'onkeypress',
      'onkeyup',
      'onabort',
      'oncanplay',
      'oncanplaythrough',
      'ondurationchange',
      'onemptied',
      'onended',
      'onloadeddata',
      'onloadedmetadata',
      'onloadstart',
      'onpause',
      'onplay',
      'onplaying',
      'onprogress',
      'onratechange',
      'onseeked',
      'onseeking',
      'onstalled',
      'onsuspend',
      'ontimeupdate',
      'onvolumechange',
      'onwaiting'
    ]

    let result = content
    for (const handler of eventHandlers) {
      const pattern = new RegExp(`\\s${handler}\\s*=\\s*["'][^"']*["']`, 'gi')
      result = result.replace(pattern, '')
    }

    return result
  }

  /**
   * Sanitize URLs and dangerous protocols
   */
  private sanitizeUrls(content: string): string {
    // Remove dangerous protocols from href, src, and xlink:href attributes
    let result = content

    result = result.replace(
      /(\s)(xlink:href|href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
      (
        match,
        prefix: string,
        _attrName: string,
        doubleValue?: string,
        singleValue?: string,
        unquotedValue?: string
      ) => {
        const value = doubleValue ?? singleValue ?? unquotedValue ?? ''
        return this.shouldRemoveUrlAttribute(value) ? prefix : match
      }
    )

    return result
  }

  /**
   * Decode HTML entities the browser would resolve before URL navigation.
   */
  private decodeHtmlEntities(value: string): string {
    let decoded = value

    for (let i = 0; i < 5; i++) {
      const next = decoded.replace(
        /&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]+));?/gi,
        (
          match,
          decimal: string | undefined,
          hex: string | undefined,
          named: string | undefined
        ) => {
          if (decimal) {
            return this.decodeCodePoint(Number.parseInt(decimal, 10), match)
          }

          if (hex) {
            return this.decodeCodePoint(Number.parseInt(hex, 16), match)
          }

          if (named) {
            return HTML_ENTITY_MAP[named.toLowerCase()] ?? match
          }

          return match
        }
      )

      if (next === decoded) {
        return decoded
      }

      decoded = next
    }

    return decoded
  }

  private decodeCodePoint(codePoint: number, fallback: string): string {
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return fallback
    }

    try {
      return String.fromCodePoint(codePoint)
    } catch {
      return fallback
    }
  }

  private normalizeUrlProtocol(value: string): string {
    return this.removeUrlControlChars(this.decodeHtmlEntities(value).trim()).toLowerCase()
  }

  private removeUrlControlChars(value: string): string {
    let result = ''

    for (const char of value) {
      const codePoint = char.codePointAt(0)

      if (
        codePoint === undefined ||
        codePoint <= 0x20 ||
        (codePoint >= 0x7f && codePoint <= 0x9f)
      ) {
        continue
      }

      result += char
    }

    return result
  }

  private shouldRemoveUrlAttribute(value: string): boolean {
    const normalized = this.normalizeUrlProtocol(value)

    if (
      normalized.startsWith('javascript:') ||
      normalized.startsWith('vbscript:') ||
      normalized.startsWith('data:text/html')
    ) {
      return true
    }

    return !this.options.allowExternalResources && /^https?:/.test(normalized)
  }

  /**
   * Check if content contains dangerous patterns
   */
  private containsDangerousContent(content: string): boolean {
    const decodedContent = this.decodeHtmlEntities(content)
    const dangerousPatterns = [
      /<script/i,
      /javascript:/i,
      /vbscript:/i,
      /on\w+\s*=/i, // Event handlers
      /expression\s*\(/i,
      /import\s*['"]/i,
      /@import/i,
      // Only dangerous CDATA that might contain scripts
      /<!\[CDATA\[[\s\S]*?<script/i,
      /<!\[CDATA\[[\s\S]*?javascript:/i,
      /<foreignObject/i,
      /<iframe/i,
      /<object/i,
      /<embed/i
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(content) || pattern.test(decodedContent)) {
        return true
      }
    }

    // Check for dangerous content in comments (scripts in comments)
    const commentPattern = /<!--[\s\S]*?-->/g
    let match
    while ((match = commentPattern.exec(content)) !== null) {
      const commentContent = this.decodeHtmlEntities(match[0])
      if (/<script/i.test(commentContent) || /javascript:/i.test(commentContent)) {
        return true
      }
    }

    return false
  }

  /**
   * Final validation of the output
   */
  private validateFinalOutput(output: string): boolean {
    // Ensure it starts with <svg and contains no dangerous content
    if (!output.trim().startsWith('<svg')) {
      return false
    }

    if (this.containsDangerousContent(output)) {
      return false
    }

    // Ensure it ends with </svg>
    if (!output.trim().endsWith('</svg>')) {
      return false
    }

    return true
  }
}

// Export singleton instance for easy use
export const svgSanitizer = new SVGSanitizer({
  maxSize: 1024 * 1024
})

// Export factory function for custom options
export const createSVGSanitizer = (options?: SanitizeOptions) => new SVGSanitizer(options)
