import { describe, expect, it } from 'vitest'
import { normalizeToolInputSchema } from '@/presenter/llmProviderPresenter/aiSdk/toolMapper'

describe('AI SDK tool schema normalization', () => {
  it('normalizes discriminated union schemas to a top-level object schema', () => {
    const schema = {
      anyOf: [
        {
          type: 'object',
          properties: {
            action: { type: 'string', const: 'create' },
            content: { type: 'string' }
          },
          required: ['action', 'content'],
          additionalProperties: false
        },
        {
          type: 'object',
          properties: {
            action: { type: 'string', const: 'edit' },
            draftId: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['action', 'draftId', 'content'],
          additionalProperties: false
        }
      ],
      $schema: 'http://json-schema.org/draft-07/schema#'
    }

    const normalized = normalizeToolInputSchema(schema)

    expect(normalized.type).toBe('object')
    expect(normalized.properties).toMatchObject({
      action: { type: 'string', enum: ['create', 'edit'] },
      content: { type: 'string' },
      draftId: { type: 'string' }
    })
    expect(normalized.required).toEqual(['action', 'content'])
    expect(normalized.additionalProperties).toBe(false)
    expect(normalized).not.toHaveProperty('anyOf')
    expect(normalized).not.toHaveProperty('oneOf')
    expect(normalized).not.toHaveProperty('allOf')
  })

  it('converts invalid root schemas into empty object schemas', () => {
    const normalized = normalizeToolInputSchema({
      type: 'None'
    })

    expect(normalized).toEqual({
      type: 'object',
      properties: {}
    })
  })
})
