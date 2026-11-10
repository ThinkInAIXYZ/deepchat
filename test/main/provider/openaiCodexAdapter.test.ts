import { expect, it } from 'vitest'

it('normalizes Codex base URLs away from the OpenAI API host', async () => {
  const { normalizeOpenAICodexBaseUrl } =
    await import('../../../src/main/provider/openaiCodexAdapter')

  expect(normalizeOpenAICodexBaseUrl('https://api.openai.com/v1')).toBe(
    'https://chatgpt.com/backend-api/codex'
  )
  expect(normalizeOpenAICodexBaseUrl('https://chatgpt.com/backend-api/codex/responses')).toBe(
    'https://chatgpt.com/backend-api/codex'
  )
})
