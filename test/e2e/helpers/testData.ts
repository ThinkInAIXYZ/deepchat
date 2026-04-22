export const E2E_TARGET_PROVIDER_ID = 'minimax'
export const E2E_TARGET_MODEL_ID = 'MiniMax-M2.7'

export const createSmokeToken = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export const createExactReplyPrompt = (token: string): string =>
  `Please reply with the exact text "${token}" and nothing else.`
