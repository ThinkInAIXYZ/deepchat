import { describe, expect, it } from 'vitest'
import { SVGSanitizer } from '@/lib/svgSanitizer'

describe('SVGSanitizer', () => {
  it.each([
    ['numeric entity in href', 'href="j&#x61;vascript:alert(1)"'],
    ['named colon entity in href', 'href="javascript&colon;alert(1)"'],
    ['named tab entity in href', 'href="java&Tab;script:alert(1)"'],
    ['numeric entity in xlink:href', 'xlink:href="j&#97;vascript:alert(1)"']
  ])('removes browser-decoded javascript URLs from %s', (_label, attribute) => {
    const sanitizer = new SVGSanitizer()
    const result = sanitizer.sanitize(
      `<svg xmlns="http://www.w3.org/2000/svg"><a ${attribute}><rect width="10" height="10"/></a></svg>`
    )

    expect(result).not.toBeNull()
    expect(result).not.toMatch(/href\s*=/i)
    expect(result).not.toMatch(/javascript/i)
  })

  it('rejects entity-obfuscated javascript outside URL attributes during final validation', () => {
    const sanitizer = new SVGSanitizer()
    const result = sanitizer.sanitize(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(j&#x61;vascript:alert(1))"/></svg>'
    )

    expect(result).toBeNull()
  })

  it('keeps safe local SVG references', () => {
    const sanitizer = new SVGSanitizer()
    const result = sanitizer.sanitize(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="shape" d="M0 0h10v10z"/></defs><use href="#shape"/></svg>'
    )

    expect(result).toContain('href="#shape"')
  })
})
