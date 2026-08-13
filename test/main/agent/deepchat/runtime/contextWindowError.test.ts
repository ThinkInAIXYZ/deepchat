import { describe, expect, it } from 'vitest'
import {
  inspectContextOverflow,
  isContextWindowErrorLike
} from '@/agent/deepchat/runtime/contextWindowError'

describe('isContextWindowErrorLike', () => {
  it('matches common provider context overflow messages', () => {
    for (const message of [
      'Your input exceeds the context window of this model.',
      'context length exceeded',
      'maximum context tokens reached',
      'token limit exceeded for this request',
      'prompt too long',
      'too many tokens in request',
      'please reduce the length of the messages',
      'input exceeds maximum context',
      'input exceeds maximum tokens for this request'
    ]) {
      expect(isContextWindowErrorLike(message)).toBe(true)
    }
  })

  it('matches wrapped provider errors without matching unrelated failures', () => {
    expect(
      isContextWindowErrorLike({
        error: {
          message: 'Input exceeds the maximum context window.'
        }
      })
    ).toBe(true)
    expect(isContextWindowErrorLike(new Error('network connection reset'))).toBe(false)
  })

  it('matches SDK Error custom fields with nested provider context overflow details', () => {
    const error = new Error('400 Bad Request') as Error & {
      response?: { data?: { error?: { message?: string } } }
    }
    error.response = {
      data: {
        error: {
          message: 'Your input exceeds the context window of this model.'
        }
      }
    }

    expect(isContextWindowErrorLike(error)).toBe(true)
  })

  it('matches array-shaped provider context overflow details', () => {
    expect(
      isContextWindowErrorLike({
        response: {
          data: {
            errors: [{ message: 'input exceeds the context window' }]
          }
        }
      })
    ).toBe(true)
    expect(
      isContextWindowErrorLike({
        issues: [{ detail: 'prompt too long for this request context' }]
      })
    ).toBe(true)
  })

  it('matches SDK Error custom fields with array-shaped provider context overflow details', () => {
    const error = new Error('400 Bad Request') as Error & {
      response?: { data?: { errors?: Array<{ message?: string }> } }
    }
    error.response = {
      data: {
        errors: [{ message: 'context length exceeded for this model' }]
      }
    }

    expect(isContextWindowErrorLike(error)).toBe(true)
  })

  it('does not match SDK Error custom fields with quota or rate-limit details', () => {
    const quotaError = new Error('400 Bad Request') as Error & {
      response?: { data?: { error?: { message?: string } } }
    }
    quotaError.response = {
      data: {
        error: {
          message: 'rate limit exceeded: too many tokens per minute (TPM)'
        }
      }
    }

    expect(isContextWindowErrorLike(quotaError)).toBe(false)
  })

  it('does not match array-shaped provider quota or rate-limit details', () => {
    expect(
      isContextWindowErrorLike({
        response: {
          data: {
            errors: [{ message: 'rate limit exceeded: too many tokens per minute' }]
          }
        }
      })
    ).toBe(false)
  })

  it('bounds array-shaped provider error scanning', () => {
    const unrelatedErrors = Array.from({ length: 16 }, (_, index) => ({
      message: `unrelated provider error ${index}`
    }))

    expect(isContextWindowErrorLike({ errors: [...unrelatedErrors] })).toBe(false)
    expect(
      isContextWindowErrorLike({
        errors: [...unrelatedErrors, { message: 'input exceeds the context window' }]
      })
    ).toBe(false)
    expect(
      isContextWindowErrorLike({
        errors: [...unrelatedErrors.slice(0, 15), { message: 'input exceeds the context window' }]
      })
    ).toBe(true)
  })

  it('handles self-referential SDK Error custom fields', () => {
    const error = new Error('400 Bad Request') as Error & {
      body?: unknown
      response?: unknown
    }
    error.body = {
      error: {
        message: 'input exceeds maximum context'
      }
    }
    error.response = error

    expect(isContextWindowErrorLike(error)).toBe(true)
  })

  it('does not match quota, billing, or rate-limit token failures', () => {
    for (const message of [
      'monthly token limit exceeded',
      'insufficient quota for this billing account',
      'rate limit exceeded: too many tokens per minute',
      'TPM limit reached for organization',
      'RPM limit reached for model',
      '429 too many requests',
      'token limit exceeded for your daily quota'
    ]) {
      expect(isContextWindowErrorLike(message)).toBe(false)
    }
  })

  it('does not match generic input-exceeds failures without context pressure hints', () => {
    for (const message of ['input exceeds maximum file size', 'input exceeds upload limit']) {
      expect(isContextWindowErrorLike(message)).toBe(false)
    }
  })

  it('handles large wrapped errors without recursive false positives', () => {
    const wrappedError: any = {
      error: {
        message: `billing quota exceeded ${'x'.repeat(20_000)}`,
        data: {
          detail: 'too many tokens'
        }
      }
    }
    wrappedError.error.data.cause = wrappedError

    expect(isContextWindowErrorLike(wrappedError)).toBe(false)
  })

  it('matches context overflow fields after a large unrelated message', () => {
    expect(
      isContextWindowErrorLike({
        message: `unrelated provider envelope ${'x'.repeat(20_000)}`,
        error_message: 'The request exceeded the model context window.'
      })
    ).toBe(true)
  })

  it('keeps quota fields negative after a large unrelated message', () => {
    expect(
      isContextWindowErrorLike({
        message: `unrelated provider envelope ${'x'.repeat(20_000)}`,
        error_message: 'rate limit exceeded: too many tokens per minute'
      })
    ).toBe(false)
  })

  it.each([
    {
      message: 'Prompt has 142,321 tokens, maximum is 131,072 tokens.',
      actualTokens: 142321,
      limitTokens: 131072,
      limitScope: 'prompt',
      scope: 'prompt'
    },
    {
      message:
        "This model's maximum context length is 8,192 tokens. However, your messages resulted in 9,001 tokens.",
      actualTokens: 9001,
      limitTokens: 8192,
      limitScope: 'context',
      scope: 'messages'
    },
    {
      message: 'prompt is too long: 209859 tokens > 200000 maximum',
      actualTokens: 209859,
      limitTokens: 200000,
      limitScope: 'prompt',
      scope: 'prompt'
    },
    {
      message: 'input length and max_tokens exceed context limit: 7000 + 4000 > 8192',
      actualTokens: 11000,
      limitTokens: 8192,
      limitScope: 'context',
      scope: 'request'
    },
    {
      message: 'input token count (9000) exceeds the maximum number of tokens allowed (8192)',
      actualTokens: 9000,
      limitTokens: 8192,
      limitScope: 'prompt',
      scope: 'input'
    }
  ])('extracts explicit provider context numbers from $message', (fixture) => {
    expect(inspectContextOverflow(fixture.message)).toEqual({
      matched: true,
      actualTokens: fixture.actualTokens,
      limitTokens: fixture.limitTokens,
      limitScope: fixture.limitScope,
      scope: fixture.scope,
      confidence: 'explicit'
    })
  })

  it('keeps a generic context rejection qualitative', () => {
    expect(inspectContextOverflow('Your input exceeds the context window of this model.')).toEqual({
      matched: true,
      scope: 'input',
      confidence: 'qualitative'
    })
  })

  it('does not promote quota numbers into context facts', () => {
    expect(
      inspectContextOverflow('rate limit exceeded: 142321 tokens per minute, maximum is 131072')
    ).toEqual({ matched: false, confidence: 'none' })
  })

  it('continues past a qualitative wrapper to an explicit nested provider limit', () => {
    expect(
      inspectContextOverflow({
        message: 'context length exceeded',
        response: {
          data: {
            error: { message: 'Prompt has 142321 tokens, maximum is 131072 tokens.' }
          }
        }
      })
    ).toMatchObject({
      matched: true,
      actualTokens: 142321,
      limitTokens: 131072,
      confidence: 'explicit'
    })
  })

  it('prefers a complete nested observation over a limit-only wrapper', () => {
    expect(
      inspectContextOverflow({
        message: 'maximum context length is 131072 tokens',
        response: {
          data: {
            error: { message: 'Prompt has 142321 tokens, maximum is 131072 tokens.' }
          }
        }
      })
    ).toEqual({
      matched: true,
      actualTokens: 142321,
      limitTokens: 131072,
      limitScope: 'prompt',
      scope: 'prompt',
      confidence: 'explicit'
    })
  })

  it('does not pair unrelated token comparisons with a generic context rejection', () => {
    expect(
      inspectContextOverflow(
        'context window exceeded. Cache accounting observed 9001 tokens > 8192 maximum.'
      )
    ).toEqual({
      matched: true,
      scope: 'unknown',
      confidence: 'qualitative'
    })
  })

  it.each([
    {
      message: 'Input has 9,001 tokens, maximum is 8,192 tokens.',
      scope: 'input'
    },
    {
      message: 'Message has 9,001 tokens, maximum is 8,192 tokens.',
      scope: 'messages'
    },
    {
      message: 'Request has 9,001 tokens, maximum is 8,192 tokens.',
      scope: 'request'
    },
    {
      message: 'Schema has too many tokens; maximum is 8,192 tokens.',
      scope: 'unknown'
    }
  ])('does not promote a field-scoped limit from $message', ({ message, scope }) => {
    const facts = inspectContextOverflow(message)

    expect(facts).toMatchObject({ matched: true, scope })
    expect(facts).not.toHaveProperty('limitTokens')
    expect(facts).not.toHaveProperty('limitScope')
  })

  it('does not treat character-size validation as a context overflow', () => {
    expect(
      inspectContextOverflow('inputs[0] content size exceeds maximum 8192 characters')
    ).toEqual({ matched: false, confidence: 'none' })
  })

  it('does not promote a non-overflow token comparison into a context ceiling', () => {
    expect(inspectContextOverflow('Prompt has 4,096 tokens, maximum is 8,192 tokens.')).toEqual({
      matched: false,
      confidence: 'none'
    })
  })

  it('does not treat unrelated arithmetic as a total-context observation', () => {
    expect(
      inspectContextOverflow('context limit warning: cache shards 7000 + 4000 > 8192')
    ).toEqual({
      matched: false,
      confidence: 'none'
    })
  })

  it.each([
    'context window exceeded; configured context length: 8192 tokens',
    'context window exceeded; requested context length: 8192 tokens',
    'maximum context length is 8. tokens',
    'maximum context length is 8.5 tokens',
    'maximum context length is 8__192 tokens',
    'maximum context length is 1,234.567 tokens'
  ])('does not promote non-authoritative or malformed limits from %s', (message) => {
    const facts = inspectContextOverflow(message)
    expect(facts).toMatchObject({
      matched: true,
      confidence: 'qualitative'
    })
    expect(facts).not.toHaveProperty('limitTokens')
  })
})
