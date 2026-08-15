import { describe, expect, it } from 'vitest'
import {
  tapeInspectorDetailPlacement,
  tapeInspectorLayoutMode
} from '@/components/tape-inspector/layout'

describe('Tape Inspector responsive layout', () => {
  it.each([
    [360, 'compact', 'overlay'],
    [520, 'compact', 'overlay'],
    [760, 'medium', 'overlay'],
    [960, 'wide', 'side']
  ] as const)('uses container width %i for %s ledger and %s detail', (width, ledger, detail) => {
    expect(tapeInspectorLayoutMode(width)).toBe(ledger)
    expect(tapeInspectorDetailPlacement(width)).toBe(detail)
  })

  it('reflows the ledger independently when a side detail pane consumes width', () => {
    expect(tapeInspectorDetailPlacement(960)).toBe('side')
    expect(tapeInspectorLayoutMode(580)).toBe('medium')
  })
})
