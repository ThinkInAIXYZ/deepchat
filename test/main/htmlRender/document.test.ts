import { describe, expect, it } from 'vitest'
import {
  buildHtmlRenderDocument,
  isDocumentMarkup,
  loadsExternalResource,
  usesViewportHeightUnit
} from '@/htmlRender/document'

describe('html_render document', () => {
  it('rejects viewport-relative heights but ignores base64 payloads and identifiers', () => {
    expect(usesViewportHeightUnit('<div style="height:100vh"></div>')).toBe(true)
    expect(usesViewportHeightUnit('.a{min-height:50dvh}')).toBe(true)
    expect(usesViewportHeightUnit('.a{height:.5svh}')).toBe(true)
    expect(usesViewportHeightUnit('<p>height: 320px; id="sec-2vh"</p>')).toBe(false)
    expect(usesViewportHeightUnit(`<img src="data:image/png;base64,${'+1vh'.repeat(80)}">`)).toBe(
      false
    )
  })

  it('injects the bootstrap at the start of head, keeping the doctype first', () => {
    const withHead = buildHtmlRenderDocument('<!doctype html><html><head><title>x</title></head>')
    expect(
      withHead.startsWith('<!doctype html><html><head><style data-dc-host-vars></style>')
    ).toBe(true)

    const fragment = buildHtmlRenderDocument('<!DOCTYPE html><div>chart</div>')
    expect(fragment.startsWith('<!doctype html><style data-dc-host-vars></style>')).toBe(true)
    expect(fragment.endsWith('<div>chart</div>')).toBe(true)
  })
})

describe('html_render resource checks', () => {
  it('flags remote scripts and stylesheets but not local libraries or links', () => {
    expect(loadsExternalResource('<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>')).toBe(
      true
    )
    expect(loadsExternalResource('<link rel=stylesheet href=//fonts.googleapis.com/css>')).toBe(
      true
    )
    expect(
      loadsExternalResource('<script src="/lib/echarts.js"></script><a href="https://x.dev">x</a>')
    ).toBe(false)
  })

  it('tells fragments from documents', () => {
    expect(isDocumentMarkup('<section class="card"><svg></svg></section>')).toBe(false)
    expect(isDocumentMarkup('<!DOCTYPE html><div></div>')).toBe(true)
    expect(isDocumentMarkup('<body><div></div></body>')).toBe(true)
  })
})
