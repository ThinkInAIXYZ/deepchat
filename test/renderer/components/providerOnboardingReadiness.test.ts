import { describe, expect, it } from 'vitest'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { isProviderReadyForOnboarding } from '../../../src/renderer/settings/components/providerOnboardingReadiness'

const provider = (overrides: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'test',
  name: 'Test',
  apiType: 'openai',
  apiKey: '',
  baseUrl: '',
  enable: true,
  ...overrides
})

describe('provider onboarding readiness', () => {
  it('accepts keyless Ollama and OAuth credentials without weakening credentialed providers', () => {
    expect(
      isProviderReadyForOnboarding(
        provider({ apiType: 'ollama', baseUrl: 'http://127.0.0.1:11434' })
      )
    ).toBe(true)
    expect(isProviderReadyForOnboarding(provider({ oauthToken: 'oauth-token' }))).toBe(true)
    expect(isProviderReadyForOnboarding(provider({}))).toBe(false)
    expect(
      isProviderReadyForOnboarding(provider({ id: 'openai', openaiAuthMode: 'chatgpt' }))
    ).toBe(false)
    expect(
      isProviderReadyForOnboarding(
        provider({ id: 'openai', openaiAuthMode: 'chatgpt', apiKey: 'unused-api-key' })
      )
    ).toBe(false)
    expect(
      isProviderReadyForOnboarding(
        provider({ id: 'openai', openaiAuthMode: 'chatgpt', oauthToken: 'oauth-token' })
      )
    ).toBe(true)
  })

  it('recognizes Bedrock profiles and complete Vertex service-account credentials', () => {
    expect(
      isProviderReadyForOnboarding(
        provider({
          apiType: 'aws-bedrock',
          credential: {
            authMode: 'profile',
            profile: 'default',
            region: 'us-east-1',
            accessKeyId: '',
            secretAccessKey: ''
          }
        } as Partial<LLM_PROVIDER>)
      )
    ).toBe(true)
    expect(
      isProviderReadyForOnboarding(
        provider({
          apiType: 'vertex',
          projectId: 'project',
          location: 'us-central1',
          accountClientEmail: 'service@example.com',
          accountPrivateKey: 'private-key'
        } as Partial<LLM_PROVIDER>)
      )
    ).toBe(true)
  })
})
