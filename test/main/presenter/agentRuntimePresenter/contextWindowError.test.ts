import { describe, expect, it } from 'vitest'
import { isContextWindowErrorLike } from '@/presenter/agentRuntimePresenter/contextWindowError'

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
})
