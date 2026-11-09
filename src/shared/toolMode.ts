import { z } from 'zod'

export const ToolModeSchema = z.enum(['agent', 'code', 'minimal'])

export type ToolMode = z.infer<typeof ToolModeSchema>
export type ToolModeOverride = ToolMode | null
// Preserve the legacy value for import/read compatibility. Execution waits for dim's native mode.
export const AVAILABLE_TOOL_MODES: readonly ToolMode[] = ['agent', 'minimal']
export type ToolModeResolutionSource = 'session' | 'model-catalog' | 'fallback'

export interface ResolvedToolMode {
  mode: ToolMode
  source: ToolModeResolutionSource
}

export function normalizeToolModeOverride(value: unknown): ToolModeOverride {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = ToolModeSchema.safeParse(value)
  return parsed.success && parsed.data !== 'code' ? parsed.data : null
}

export function resolveToolMode(
  override: ToolModeOverride,
  catalogDefault: ToolMode | undefined
): ResolvedToolMode {
  if (override !== null && override !== 'code') {
    return { mode: override, source: 'session' }
  }
  if (catalogDefault && catalogDefault !== 'code') {
    return { mode: catalogDefault, source: 'model-catalog' }
  }
  return { mode: 'agent', source: 'fallback' }
}
