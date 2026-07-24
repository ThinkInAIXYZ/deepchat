import { describe, expect, it, vi } from 'vitest'
import { adaptAiSdkStream } from '@/provider/aiSdk/streamAdapter'
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

  it('marks streaming and atomic provider-executed calls as provider-owned', async () => {
    const events = await collectEvents(
      [
        {
          type: 'tool-input-start',
          id: 'streamed-provider-call',
          toolName: 'web_search',
          providerExecuted: true
        },
        {
          type: 'tool-input-delta',
          id: 'streamed-provider-call',
          delta: '{"query":"deepchat"}'
        },
        { type: 'tool-input-end', id: 'streamed-provider-call' },
        {
          type: 'tool-call',
          toolCallId: 'atomic-provider-call',
          toolName: 'code_execution',
          input: { code: '1 + 1' },
          providerExecuted: true
        }
      ],
      { supportsNativeTools: true }
    )

    expect(events.filter((event) => event.type === 'tool_call_start')).toEqual([
      {
        type: 'tool_call_start',
        tool_call_id: 'streamed-provider-call',
        tool_call_name: 'web_search',
        tool_call_execution_owner: 'provider'
      },
      {
        type: 'tool_call_start',
        tool_call_id: 'atomic-provider-call',
        tool_call_name: 'code_execution',
        tool_call_execution_owner: 'provider'
      }
    ])
  })

  it('preserves explicit zero cache usage reported by the provider', async () => {
    const events = await collectEvents(
      [
        {
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: {
            inputTokens: 10,
            outputTokens: 2,
            totalTokens: 12,
            inputTokenDetails: {
              cacheReadTokens: 0,
              cacheWriteTokens: 0
            }
          }
        }
      ],
      { supportsNativeTools: true }
    )

    expect(events).toEqual([
      {
        type: 'usage',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
          cached_tokens: 0,
          cache_write_tokens: 0
        }
      },
      { type: 'stop', stop_reason: 'complete' }
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
    expect(events[6]).toEqual({ type: 'stop', stop_reason: 'tool_use' })
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
    expect(events[2]).toEqual({ type: 'stop', stop_reason: 'complete' })
  })

  it('falls back to the original image data url when image caching fails', async () => {
    const cacheImage = vi.fn().mockRejectedValue(new Error('cache failed'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const events = await collectEvents(
      [
        {
          type: 'file',
          file: {
            mediaType: 'image/jpeg',
            base64: 'YWJjZA=='
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

    expect(cacheImage).toHaveBeenCalledWith('data:image/jpeg;base64,YWJjZA==')
    expect(warnSpy).toHaveBeenCalled()
    expect(events[0]).toEqual({
      type: 'image_data',
      image_data: {
        data: 'data:image/jpeg;base64,YWJjZA==',
        mimeType: 'image/jpeg'
      }
    })

    warnSpy.mockRestore()
  })

  it('skips file parts with missing or non-image media types', async () => {
    const cacheImage = vi.fn()
    const events = await collectEvents(
      [
        {
          type: 'file',
          file: {
            mediaType: undefined,
            base64: 'ZmFrZQ=='
          }
        },
        {
          type: 'file',
          file: {
            mediaType: 'application/pdf',
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

    expect(cacheImage).not.toHaveBeenCalled()
    expect(events).toEqual([
      {
        type: 'usage',
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2
        }
      },
      { type: 'stop', stop_reason: 'complete' }
    ])
  })

  it('maps the length finish reason to max_tokens', async () => {
    const events = await collectEvents(
      [
        {
          type: 'finish',
          finishReason: 'length',
          rawFinishReason: 'length',
          totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
        }
      ],
      { supportsNativeTools: true }
    )

    expect(events.at(-1)).toEqual({ type: 'stop', stop_reason: 'max_tokens' })
  })

  it('preserves max_tokens after parsing a legacy tool call', async () => {
    const events = await collectEvents(
      [
        {
          type: 'text-delta',
          id: 'text-1',
          text: '<function_call>{"function_call":{"name":"search","arguments":{"q":"deepchat"}}}</function_call>'
        },
        {
          type: 'finish',
          finishReason: 'length',
          rawFinishReason: 'length',
          totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
        }
      ],
      { supportsNativeTools: false }
    )

    expect(events.at(-1)).toEqual({ type: 'stop', stop_reason: 'max_tokens' })
  })

  it.each([
    ['content-filter', 'Provider stopped the response because of content filtering.'],
    ['error', 'Provider stopped the response because of an error.'],
    ['other', 'Provider stopped the response for an unspecified reason: provider-specific']
  ] as const)('surfaces the %s finish reason as an error', async (finishReason, message) => {
    const events = await collectEvents(
      [
        {
          type: 'finish',
          finishReason,
          rawFinishReason: finishReason === 'other' ? 'provider-specific' : finishReason,
          totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
        }
      ],
      { supportsNativeTools: true }
    )

    expect(events.slice(-2)).toEqual([
      { type: 'error', error_message: message },
      { type: 'stop', stop_reason: 'error' }
    ])
  })

  it('surfaces an SDK abort part as a provider error', async () => {
    const events = await collectEvents([{ type: 'abort', reason: 'upstream aborted' }], {
      supportsNativeTools: true
    })

    expect(events).toEqual([
      { type: 'error', error_message: 'upstream aborted' },
      { type: 'stop', stop_reason: 'error' }
    ])
  })
})
