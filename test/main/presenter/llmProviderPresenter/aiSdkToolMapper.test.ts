import { describe, expect, it } from 'vitest'
import {
  mcpToolsToAISDKTools,
  normalizeToolInputSchema
} from '@/presenter/llmProviderPresenter/aiSdk/toolMapper'

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

  it('drops non-object root fields when falling back to an object schema', () => {
    const normalized = normalizeToolInputSchema({
      type: 'array',
      items: {
        type: 'string'
      },
      properties: {
        query: {
          type: 'string'
        }
      },
      required: ['query'],
      additionalProperties: false
    })

    expect(normalized).toEqual({
      type: 'object',
      properties: {
        query: {
          type: 'string'
        }
      },
      required: ['query'],
      additionalProperties: false
    })
    expect(normalized).not.toHaveProperty('items')
  })

  it('uses the union of required keys for allOf branches', () => {
    const normalized = normalizeToolInputSchema({
      allOf: [
        {
          type: 'object',
          properties: {
            query: { type: 'string' }
          },
          required: ['query']
        },
        {
          type: 'object',
          properties: {
            limit: { type: 'number' }
          },
          required: ['limit']
        }
      ]
    })

    expect(normalized).toMatchObject({
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['query', 'limit']
    })
  })

  it('uses a safe dictionary and skips unsafe tool names', () => {
    const tools = mcpToolsToAISDKTools([
      {
        type: 'function',
        function: {
          name: '__proto__',
          description: 'unsafe',
          parameters: {
            type: 'object',
            properties: {}
          }
        },
        server: {
          name: 'unsafe-server',
          icons: '',
          description: 'unsafe'
        }
      },
      {
        type: 'function',
        function: {
          name: 'safe_tool',
          description: 'safe',
          parameters: {
            type: 'object',
            properties: {}
          }
        },
        server: {
          name: 'safe-server',
          icons: '',
          description: 'safe'
        }
      }
    ])

    expect(Object.getPrototypeOf(tools)).toBeNull()
    expect(tools).not.toHaveProperty('__proto__')
    expect(tools).toHaveProperty('safe_tool')
  })
})
