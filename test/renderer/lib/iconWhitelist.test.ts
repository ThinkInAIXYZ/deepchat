import { describe, expect, it } from 'vitest'
import { GENERATED_ICON_WHITELIST } from '../../../src/renderer/src/lib/icons/icon-whitelist.generated'

describe('generated icon whitelist', () => {
  it('includes shared settings navigation icons', () => {
    expect(GENERATED_ICON_WHITELIST.lucide).toEqual(expect.arrayContaining(['bolt', 'folders']))
  })
})
