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

  it('accepts an XML declaration, DOCTYPE and comments before the svg element', () => {
    const sanitizer = new SVGSanitizer()
    const result = sanitizer.sanitize(
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
        '<!-- Created with Inkscape -->\n' +
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
    )

    expect(result).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
    )
  })

  it('still rejects a DOCTYPE with an internal subset and non-svg roots', () => {
    const sanitizer = new SVGSanitizer()

    expect(
      sanitizer.sanitize(
        '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"></svg>'
      )
    ).toBeNull()
    expect(sanitizer.sanitize('<?xml version="1.0"?><html><svg></svg></html>')).toBeNull()
  })

  it('accepts a DOCTYPE whose quoted identifier holds a bracket', () => {
    const sanitizer = new SVGSanitizer()

    expect(sanitizer.sanitize('<!DOCTYPE svg SYSTEM "http://[::1]/svg.dtd"><svg></svg>')).toBe(
      '<svg></svg>'
    )
    expect(
      sanitizer.sanitize("<!DOCTYPE svg PUBLIC '-//[x]//EN' 'http://[::1]/a.dtd'><svg></svg>")
    ).toBe('<svg></svg>')
    expect(
      sanitizer.sanitize('<!DOCTYPE svg SYSTEM "a.dtd" [<!ENTITY x "y">]><svg></svg>')
    ).toBeNull()
  })
})
