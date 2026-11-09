import { expect, it, vi } from 'vitest'
import { DimAuxiliaryModels, dimAuxiliaryRequest } from '@/agent/dim/auxiliaryModels'

it('preserves system text, image bytes and tool call identities in the native message contract', () => {
  expect(
    dimAuxiliaryRequest([
      { role: 'system', content: 'product instructions' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'question' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,cG5n' } }
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
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'cG5n' } }
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
