export type TapeInspectorLayoutMode = 'wide' | 'medium' | 'compact'
export type TapeInspectorDetailPlacement = 'side' | 'overlay'

export function tapeInspectorLayoutMode(width: number): TapeInspectorLayoutMode {
  if (width < 560) return 'compact'
  if (width < 840) return 'medium'
  return 'wide'
}

export function tapeInspectorDetailPlacement(width: number): TapeInspectorDetailPlacement {
  return width < 840 ? 'overlay' : 'side'
}
