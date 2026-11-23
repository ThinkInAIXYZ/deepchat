import { expect, it, vi } from 'vitest'
import { DimAuxiliaryModels, dimAuxiliaryRequest } from '@/agent/dim/auxiliaryModels'
import { DimModelCatalog } from '@/agent/dim/modelCatalog'

it('preserves system text, image bytes and tool call identities in the native message contract', () => {
  expect(
    dimAuxiliaryRequest([
      { role: 'system', content: 'product instructions' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'question' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,cG5n' } },
          { type: 'input_audio', input_audio: { data: 'AQID', media_type: 'Audio/WAV' } }
        ]
      },
      {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call',
            type: 'function',
            function: { name: 'lookup', arguments: '{"key":"value"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'call', content: 'answer' }
    ])
  ).toEqual({
    system: 'product instructions',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'question' },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'cG5n' } },
          { type: 'image', source: { type: 'base64', mediaType: 'audio/wav', data: 'AQID' } }
        ]
      },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call', name: 'lookup', input: { key: 'value' } }]
      },
      {
        role: 'tool_result',
        content: [
          { type: 'tool_result', tool_use_id: 'call', content: [{ type: 'text', text: 'answer' }] }
        ]
      }
    ]
  })
})

it('denies invalid historical tool input before native model admission', async () => {
  const admit = vi.fn()
  const complete = vi.fn()
  const auxiliary = new DimAuxiliaryModels({ models: { admit }, bridge: { complete } })
  await expect(
    auxiliary.complete({
      providerId: 'provider',
      modelId: 'model',
      messages: [
        {
          role: 'assistant',
          tool_calls: [
            { id: 'call', type: 'function', function: { name: 'lookup', arguments: '[]' } }
          ]
        }
      ]
    })
  ).rejects.toThrow('object arguments')
  expect(admit).not.toHaveBeenCalled()
  expect(complete).not.toHaveBeenCalled()
})

it('keeps admission cancellation from reaching Rust inference and preserves configured defaults', async () => {
  const abort = new AbortController()
  const complete = vi.fn(async () => ({ text: 'native', stopReason: 'end_turn' as const }))
  const model = { providerId: 'native-provider', modelId: 'model' }
  const admit = vi.fn(async () => {
    abort.abort(new Error('cancel admission'))
    return model
  })
  const auxiliary = new DimAuxiliaryModels({
    models: { admit },
    bridge: { complete },
    parameters: () => ({ temperature: 0.2, maxTokens: 100 })
  })
  const input = {
    providerId: 'provider',
    modelId: 'model',
    messages: [{ role: 'user' as const, content: 'prompt' }],
    parameters: { temperature: undefined, maxTokens: 80 }
  }
  await expect(auxiliary.complete({ ...input, signal: abort.signal })).rejects.toThrow(
    'cancel admission'
  )
  expect(complete).not.toHaveBeenCalled()
  admit.mockResolvedValue(model)
  await auxiliary.complete(input)
  expect(complete).toHaveBeenCalledWith(model, expect.any(Object), undefined, {
    temperature: 0.2,
    maxTokens: 80
  })
})

it('drops explicit sampling and output limits for the ChatGPT plan after the merge', async () => {
  const complete = vi.fn(async () => ({ text: 'native', stopReason: 'end_turn' as const }))
  const catalog = new DimModelCatalog({
    settings: {
      getProviderById: (id: string) =>
        id === 'chatgpt' ? { id, apiType: 'chatgpt' } : { id, apiType: 'openai-completions' }
    }
  } as never)
  const auxiliary = new DimAuxiliaryModels({
    models: {
      admit: async (providerId, modelId) => ({ providerId, modelId }),
      restrictParameters: (providerId, parameters) =>
        catalog.restrictParameters(providerId, parameters)
    },
    bridge: { complete },
    parameters: () => ({ reasoning: { effort: 'low' } })
  })
  const input = {
    modelId: 'model',
    messages: [{ role: 'user' as const, content: 'prompt' }],
    parameters: { temperature: 0.1, topP: 0.9, maxTokens: 10 }
  }
  await auxiliary.complete({ ...input, providerId: 'chatgpt' })
  await auxiliary.complete({ ...input, providerId: 'other' })
  expect(complete.mock.calls.map((call) => call.at(-1))).toEqual([
    { reasoning: { effort: 'low' } },
    { reasoning: { effort: 'low' }, temperature: 0.1, topP: 0.9, maxTokens: 10 }
  ])
})

it('blocks a truncated audio preparation before the Agent receives incomplete evidence', async () => {
  const complete = vi
    .fn()
    .mockResolvedValue({ text: 'partial transcript', stopReason: 'max_tokens' })
  const auxiliary = new DimAuxiliaryModels({
    models: { admit: async () => ({ providerId: 'native', modelId: 'audio' }) },
    bridge: { complete }
  })
  await expect(
    auxiliary.audioEvidence(
      'provider',
      'audio',
      { type: 'input_audio', input_audio: { data: 'AQID', media_type: 'audio/wav' } },
      'What was said?'
    )
  ).rejects.toThrow('exceeded the model output allowance')
})
