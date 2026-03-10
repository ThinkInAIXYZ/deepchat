export const DEFAULT_MODEL_CONTEXT_LENGTH = 16000
export const DEFAULT_MODEL_MAX_TOKENS = 4096
export const DEFAULT_MODEL_VISION = false
export const DEFAULT_MODEL_FUNCTION_CALL = true
export const DEFAULT_MODEL_REASONING = false

export const DEFAULT_MODEL_CAPABILITY_FALLBACKS = Object.freeze({
  contextLength: DEFAULT_MODEL_CONTEXT_LENGTH,
  maxTokens: DEFAULT_MODEL_MAX_TOKENS,
  vision: DEFAULT_MODEL_VISION,
  functionCall: DEFAULT_MODEL_FUNCTION_CALL,
  reasoning: DEFAULT_MODEL_REASONING
})

export const resolveModelContextLength = (value: number | undefined | null): number =>
  value ?? DEFAULT_MODEL_CONTEXT_LENGTH

export const resolveModelMaxTokens = (value: number | undefined | null): number =>
  value ?? DEFAULT_MODEL_MAX_TOKENS

export const resolveModelVision = (value: boolean | undefined | null): boolean =>
  value ?? DEFAULT_MODEL_VISION

export const resolveModelFunctionCall = (value: boolean | undefined | null): boolean =>
  value ?? DEFAULT_MODEL_FUNCTION_CALL
