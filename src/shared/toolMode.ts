import { z } from 'zod'

export const ToolModeSchema = z.enum(['agent', 'code', 'minimal'])

export type ToolMode = z.infer<typeof ToolModeSchema>
export type ToolModeOverride = ToolMode | null
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
  return parsed.success ? parsed.data : null
}

export function resolveToolMode(
  override: ToolModeOverride,
  catalogDefault: ToolMode | undefined
): ResolvedToolMode {
  if (override !== null) {
    return { mode: override, source: 'session' }
  }
  if (catalogDefault) {
    return { mode: catalogDefault, source: 'model-catalog' }
  }
  return { mode: 'agent', source: 'fallback' }
}
