import { describe, expect, it, vi } from 'vitest'
import { adaptAiSdkStream } from '@/presenter/llmProviderPresenter/aiSdk/streamAdapter'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'

async function collectEvents(parts: any[], options: Parameters<typeof adaptAiSdkStream>[1]) {
  async function* stream() {
    for (const part of parts) {
      yield part
    }
  }

  const events: LLMCoreStreamEvent[] = []
  for await (const event of adaptAiSdkStream(stream(), options)) {
    events.push(event)
  }
  return events
}

describe('AI SDK stream adapter', () => {
  it('maps native tool streaming events to DeepChat core events', async () => {
    const events = await collectEvents(
      [
        {
          type: 'text-delta',
          id: 'text-1',
          text: 'hello ',
          providerMetadata: { vertex: { thoughtSignature: 'text-signature' } }
        },
        {
          type: 'reasoning-delta',
          id: 'reason-1',
          text: 'thinking',
          providerMetadata: { vertex: { thoughtSignature: 'reason-signature' } }
        },
        {
          type: 'tool-input-start',
          id: 'call-1',
          toolName: 'getWeather',
          providerMetadata: { vertex: { thoughtSignature: 'tool-signature' } }
        },
        {
          type: 'tool-input-delta',
          id: 'call-1',
          delta: '{"city":"',
          providerMetadata: { vertex: { thoughtSignature: 'tool-signature' } }
        },
        { type: 'tool-input-delta', id: 'call-1', delta: 'Beijing"}' },
        { type: 'tool-input-end', id: 'call-1' },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          rawFinishReason: 'tool_calls',
          totalUsage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            inputTokenDetails: {
              cacheReadTokens: 3
            }
          }
        }
      ],
      { supportsNativeTools: true }
    )

    expect(events).toEqual([
      {
        type: 'text',
        content: 'hello ',
        provider_options: { vertex: { thoughtSignature: 'text-signature' } }
      },
      {
        type: 'reasoning',
        reasoning_content: 'thinking',
        provider_options: { vertex: { thoughtSignature: 'reason-signature' } }
      },
      {
        type: 'tool_call_start',
        tool_call_id: 'call-1',
        tool_call_name: 'getWeather',
        provider_options: { vertex: { thoughtSignature: 'tool-signature' } }
      },
      {
        type: 'tool_call_chunk',
        tool_call_id: 'call-1',
        tool_call_arguments_chunk: '{"city":"',
        provider_options: { vertex: { thoughtSignature: 'tool-signature' } }
      },
      { type: 'tool_call_chunk', tool_call_id: 'call-1', tool_call_arguments_chunk: 'Beijing"}' },
      {
        type: 'tool_call_end',
        tool_call_id: 'call-1',
        tool_call_arguments_complete: '{"city":"Beijing"}'
      },
      {
        type: 'usage',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          cached_tokens: 3
        }
      },
      { type: 'stop', stop_reason: 'tool_use' }
    ])
  })

  it('parses legacy function_call blocks from text deltas', async () => {
    const events = await collectEvents(
      [
        {
          type: 'text-delta',
          id: 'text-1',
          text: 'before <function_call>{"function_call":{"name":"search","arguments":{"q":"deepchat"}}}</function_call> after'
        },
        {
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: {
            inputTokens: 2,
            outputTokens: 4,
            totalTokens: 6
          }
        }
      ],
      { supportsNativeTools: false }
    )

    expect(events[0]).toEqual({ type: 'text', content: 'before ' })
    expect(events[1].type).toBe('tool_call_start')
    expect(events[2].type).toBe('tool_call_chunk')
    expect(events[3].type).toBe('tool_call_end')
    expect(events[4]).toEqual({ type: 'text', content: ' after' })
    expect(events[5]).toEqual({
      type: 'usage',
      usage: {
        prompt_tokens: 2,
        completion_tokens: 4,
        total_tokens: 6
      }
    })
    expect(events[6]).toEqual({ type: 'stop', stop_reason: 'stop_sequence' })
  })

  it('maps image file parts and caches the emitted data url', async () => {
    const cacheImage = vi.fn().mockResolvedValue('cached://image')
    const events = await collectEvents(
      [
        {
          type: 'file',
          file: {
            mediaType: 'image/png',
            base64: 'ZmFrZQ=='
          }
        },
        {
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2
          }
        }
      ],
      { supportsNativeTools: true, cacheImage }
    )

    expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,ZmFrZQ==')
    expect(events[0]).toEqual({
      type: 'image_data',
      image_data: {
        data: 'cached://image',
        mimeType: 'image/png'
      }
    })
    expect(events[2]).toEqual({ type: 'stop', stop_reason: 'stop_sequence' })
  })
})
