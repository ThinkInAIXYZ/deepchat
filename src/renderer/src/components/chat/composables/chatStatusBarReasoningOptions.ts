import type { SessionGenerationSettings } from '@shared/types/agent-interface'
import {
  ANTHROPIC_REASONING_VISIBILITY_VALUES,
  DEFAULT_REASONING_EFFORT_OPTIONS as FALLBACK_REASONING_EFFORT_OPTIONS,
  hasAnthropicReasoningToggle,
  isReasoningEffort,
  isVerbosity,
  normalizeAnthropicReasoningVisibilityValue,
  type AnthropicReasoningVisibility,
  type ReasoningPortrait
} from '@shared/types/model-db'

export type ReasoningEffortValue = NonNullable<SessionGenerationSettings['reasoningEffort']>
export type VerbosityValue = NonNullable<SessionGenerationSettings['verbosity']>

const DEFAULT_VERBOSITY_OPTIONS: SessionGenerationSettings['verbosity'][] = [
  'low',
  'medium',
  'high'
]

export const getReasoningEffortOptions = (
  portrait: ReasoningPortrait | null | undefined
): ReasoningEffortValue[] => {
  if (
    !portrait ||
    portrait.mode === 'budget' ||
    portrait.mode === 'level' ||
    portrait.mode === 'fixed'
  ) {
    return []
  }

  const options = portrait?.effortOptions?.filter(isReasoningEffort)
  if (options && options.length > 0) {
    return options
  }
  if (portrait.mode === 'mixed' || !isReasoningEffort(portrait?.effort)) {
    return []
  }

  return FALLBACK_REASONING_EFFORT_OPTIONS.includes(portrait.effort)
    ? [...FALLBACK_REASONING_EFFORT_OPTIONS]
    : [portrait.effort]
}

export const getVerbosityOptions = (
  portrait: ReasoningPortrait | null | undefined
): VerbosityValue[] => {
  const options = portrait?.verbosityOptions?.filter(isVerbosity)
  if (options && options.length > 0) {
    return options
  }
  return isVerbosity(portrait?.verbosity) ? DEFAULT_VERBOSITY_OPTIONS.filter(isVerbosity) : []
}

export const getReasoningVisibilityOptions = (
  providerId: string,
  portrait: ReasoningPortrait | null | undefined
): AnthropicReasoningVisibility[] =>
  hasAnthropicReasoningToggle(providerId, portrait)
    ? [...ANTHROPIC_REASONING_VISIBILITY_VALUES]
    : []

export const supportsReasoningEffort = (portrait: ReasoningPortrait | null | undefined): boolean =>
  portrait?.supported !== false && getReasoningEffortOptions(portrait).length > 0

export const supportsVerbosity = (portrait: ReasoningPortrait | null | undefined): boolean =>
  portrait?.supported !== false && getVerbosityOptions(portrait).length > 0

export const hasThinkingBudgetSupport = (portrait: ReasoningPortrait | null | undefined): boolean =>
  Boolean(
    portrait &&
    portrait.mode !== 'effort' &&
    portrait.mode !== 'level' &&
    portrait.mode !== 'fixed' &&
    portrait.budget &&
    (portrait.budget.default !== undefined ||
      portrait.budget.min !== undefined ||
      portrait.budget.max !== undefined ||
      portrait.budget.auto !== undefined ||
      portrait.budget.off !== undefined)
  )

export const normalizeReasoningEffort = (
  portrait: ReasoningPortrait | null | undefined,
  value: unknown
): SessionGenerationSettings['reasoningEffort'] | undefined => {
  if (!isReasoningEffort(value)) {
    return undefined
  }

  const options = getReasoningEffortOptions(portrait)
  if (options.length === 0) {
    return value
  }

  if (options.includes(value)) {
    return value
  }

  return isReasoningEffort(portrait?.effort) && options.includes(portrait.effort)
    ? portrait.effort
    : undefined
}

export const normalizeVerbosity = (
  portrait: ReasoningPortrait | null | undefined,
  value: unknown
): SessionGenerationSettings['verbosity'] | undefined => {
  if (!isVerbosity(value)) {
    return undefined
  }

  const options = getVerbosityOptions(portrait)
  if (options.length === 0) {
    return value
  }

  if (options.includes(value)) {
    return value
  }

  return isVerbosity(portrait?.verbosity) && options.includes(portrait.verbosity)
    ? portrait.verbosity
    : undefined
}

export const normalizeReasoningVisibility = (
  providerId: string,
  portrait: ReasoningPortrait | null | undefined,
  value: unknown
): SessionGenerationSettings['reasoningVisibility'] | undefined => {
  if (!hasAnthropicReasoningToggle(providerId, portrait)) {
    return undefined
  }

  return normalizeAnthropicReasoningVisibilityValue(value) ?? 'omitted'
}
