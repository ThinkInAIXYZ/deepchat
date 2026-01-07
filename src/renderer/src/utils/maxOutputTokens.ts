const GLOBAL_OUTPUT_TOKEN_MAX = 32000

interface CalculateSafeDefaultOptions {
  modelMaxTokens: number
  thinkingBudget?: number
  reasoningSupported: boolean
}

/**
 * Calculate a safe default maxTokens value.
 * - Apply a global safety cap (32k)
 * - Reserve space for thinking budget when reasoning is supported
 * - Never exceed the model's reported limit
 */
export function calculateSafeDefaultMaxTokens({
  modelMaxTokens,
  thinkingBudget,
  reasoningSupported
}: CalculateSafeDefaultOptions): number {
  const modelCap = Math.min(modelMaxTokens, GLOBAL_OUTPUT_TOKEN_MAX)

  if (reasoningSupported && thinkingBudget !== undefined && thinkingBudget > 0) {
    const safeThinkingBudget = Math.max(0, thinkingBudget)
    const textTokens = Math.max(0, modelCap - safeThinkingBudget)
    return textTokens
  }

  return modelCap
}

export { GLOBAL_OUTPUT_TOKEN_MAX }
