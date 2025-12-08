import { describe, expect, it } from 'vitest'

import { parseLinuxFontFamilies } from '@/presenter/configPresenter/uiSettingsHelper'

describe('parseLinuxFontFamilies', () => {
  it('extracts family names before the style portion', () => {
    const output = [
      'DejaVu Sans:style=Book',
      'Noto Sans Mono:style=Regular',
      'Ubuntu:style=Bold'
    ].join('\n')

    expect(parseLinuxFontFamilies(output)).toEqual(['DejaVu Sans', 'Noto Sans Mono', 'Ubuntu'])
  })

  it('deduplicates and normalizes comma-separated families', () => {
    const output = [
      'Noto Sans Mono, Noto Sans Mono Light:style=Regular,Italic',
      'Noto Sans Mono:style=Bold'
    ].join('\n')

    expect(parseLinuxFontFamilies(output)).toEqual(['Noto Sans Mono'])
  })

  it('ignores entries without a valid family name', () => {
    const output = ['', ':style=Book', 'style=Bold', ' , :style=Regular'].join('\n')

    expect(parseLinuxFontFamilies(output)).toEqual([])
  })
})
