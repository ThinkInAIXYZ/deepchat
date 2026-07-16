import { describe, expect, it, vi } from 'vitest'
import { SessionTranslation, resolveTranslationLanguage } from '@/session/sessionTranslation'

function createFixture() {
  const resolveBackend = vi.fn(() => ({ kind: 'deepchat' }))
  const resolveDeepChatAgentConfig = vi.fn(async () => ({}))
  const getDefaultModel = vi.fn(() => ({
    providerId: 'default-provider',
    modelId: 'default-model'
  }))
  const generateCompletion = vi.fn(async () => '  translated  ')
  const service = new SessionTranslation({
    agentManager: { resolveBackend } as never,
    agentSettings: { resolveDeepChatAgentConfig, getDefaultModel } as never,
    providerRuntime: { generateCompletion } as never
  })
  return {
    service,
    resolveBackend,
    resolveDeepChatAgentConfig,
    getDefaultModel,
    generateCompletion
  }
}

describe('SessionTranslation', () => {
  it('uses the agent assistant model and preserves prompt settings and trimming', async () => {
    const fixture = createFixture()
    fixture.resolveDeepChatAgentConfig.mockResolvedValue({
      assistantModel: { providerId: ' assistant-provider ', modelId: ' assistant-model ' }
    })

    await expect(fixture.service.translate('  hello  ', 'zh-Hans', 'agent-1')).resolves.toBe(
      'translated'
    )
    expect(fixture.generateCompletion).toHaveBeenCalledWith(
      'assistant-provider',
      [
        {
          role: 'system',
          content:
            'You are a translation assistant. Translate the user input into Simplified Chinese. Return only the translated text with no explanations.'
        },
        { role: 'user', content: 'hello' }
      ],
      'assistant-model',
      0.2,
      1024
    )
  })

  it('falls back to the default model for ACP agents or missing assistant selection', async () => {
    const fixture = createFixture()
    fixture.resolveBackend.mockReturnValue({ kind: 'acp' })

    await fixture.service.translate('hello', 'en-US', 'acp-agent')

    expect(fixture.resolveDeepChatAgentConfig).not.toHaveBeenCalled()
    expect(fixture.generateCompletion).toHaveBeenCalledWith(
      'default-provider',
      expect.any(Array),
      'default-model',
      0.2,
      1024
    )
  })

  it('falls back to the default model when the agent cannot be resolved', async () => {
    const fixture = createFixture()
    fixture.resolveBackend.mockImplementation(() => {
      throw new Error('Agent not found')
    })

    await fixture.service.translate('hello', 'en-US', 'unknown-agent')

    expect(fixture.resolveDeepChatAgentConfig).not.toHaveBeenCalled()
    expect(fixture.generateCompletion).toHaveBeenCalledWith(
      'default-provider',
      expect.any(Array),
      'default-model',
      0.2,
      1024
    )
  })

  it('returns empty input without model work and rejects a missing model', async () => {
    const fixture = createFixture()
    await expect(fixture.service.translate('   ')).resolves.toBe('')
    expect(fixture.resolveBackend).not.toHaveBeenCalled()

    fixture.getDefaultModel.mockReturnValue(null)
    await expect(fixture.service.translate('hello')).rejects.toThrow(
      'No provider or model configured. Please set a default model in settings.'
    )
  })

  it.each([
    ['zh-CN', 'Simplified Chinese'],
    ['zh-Hant', 'Traditional Chinese'],
    ['ja-JP', 'Japanese'],
    ['ko-KR', 'Korean'],
    ['fr-FR', 'French'],
    ['de-DE', 'German'],
    ['es-ES', 'Spanish'],
    ['pt-BR', 'Portuguese'],
    ['ru-RU', 'Russian'],
    ['it-IT', 'Italian'],
    ['tr-TR', 'Turkish'],
    ['pl-PL', 'Polish'],
    ['da-DK', 'Danish'],
    ['fa-IR', 'Persian'],
    ['he-IL', 'Hebrew'],
    ['en-US', 'English'],
    ['unknown', 'English'],
    [undefined, 'English']
  ])('maps locale %s to %s', (locale, language) => {
    expect(resolveTranslationLanguage(locale)).toBe(language)
  })
})
