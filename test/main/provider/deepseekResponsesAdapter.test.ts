import {
  DEEPSEEK_RESPONSES_BASE_URL,
  isOfficialDeepSeekEndpoint,
  resolveDeepSeekResponsesRoute
} from '@/provider/deepseekResponsesAdapter'
import { describe, expect, it } from 'vitest'

describe('DeepSeek Responses catalog route', () => {
  it.each([
    'https://api.deepseek.com',
    'https://api.deepseek.com/',
    'https://api.deepseek.com/v1',
    'https://api.deepseek.com/v1/'
  ])('accepts official endpoint %s', (baseUrl) => {
    expect(isOfficialDeepSeekEndpoint(baseUrl)).toBe(true)
    expect(
      resolveDeepSeekResponsesRoute({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        baseUrl
      })
    ).toEqual({
      providerKind: 'deepseek-open-responses',
      baseUrl: DEEPSEEK_RESPONSES_BASE_URL
    })
  })

  it.each([
    'http://api.deepseek.com',
    'https://user:secret@api.deepseek.com',
    'https://api.deepseek.com:443',
    'https://api.deepseek.com/v1/responses',
    'https://api.deepseek.com/v2',
    'https://api.deepseek.com/v1?relay=1',
    'https://api.deepseek.com/v1#fragment',
    'https://relay.example.com/v1'
  ])('rejects non-canonical endpoint %s', (baseUrl) => {
    expect(isOfficialDeepSeekEndpoint(baseUrl)).toBe(false)
  })

  it.each([
    ['deepseek-proxy', 'deepseek-v4-flash'],
    ['deepseek', 'deepseek/deepseek-v4-flash'],
    ['deepseek', 'deepseek-v4-pro']
  ])('rejects provider/model pair %s + %s', (providerId, modelId) => {
    expect(
      resolveDeepSeekResponsesRoute({
        providerId,
        modelId,
        baseUrl: 'https://api.deepseek.com/v1'
      })
    ).toBeNull()
  })
})
