import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { describe, expect, it, vi } from 'vitest'

describe('OpenAI Responses reasoning effort', () => {
  it('serializes GPT-5.6 max effort without enabling pro mode', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'resp_test',
            created_at: 1,
            model: 'gpt-5.6-sol',
            output: [
              {
                type: 'message',
                role: 'assistant',
                id: 'msg_test',
                content: [
                  {
                    type: 'output_text',
                    text: 'ok',
                    annotations: []
                  }
                ]
              }
            ],
            usage: {
              input_tokens: 1,
              output_tokens: 1
            }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
    )
    const openai = createOpenAI({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      fetch: fetchMock as unknown as typeof fetch
    })

    await generateText({
      model: openai.responses('gpt-5.6-sol'),
      prompt: 'Solve the problem.',
      providerOptions: {
        openai: {
          reasoningEffort: 'max'
        }
      }
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/responses')

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const payload = JSON.parse(String(request.body)) as {
      reasoning?: Record<string, unknown>
    }

    expect(payload.reasoning).toMatchObject({ effort: 'max' })
    expect(payload.reasoning).not.toHaveProperty('mode')
  })
})
