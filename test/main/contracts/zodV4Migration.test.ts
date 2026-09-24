import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { toDeepChatJsonSchema } from '@shared/lib/zodJsonSchema'
import { JsonValueSchema } from '@shared/contracts/common'
import {
  McpServerConfigSchema,
  LlmProviderSchema,
  ProjectSchema,
  UsageStatsBackfillStatusSchema
} from '@shared/contracts/domainSchemas'
import { agentPlanItemSchema, normalizeAgentPlanEntry } from '@shared/types/agent-plan'
import { questionToolSchema } from '@/tool/agentTools/questionTool'

describe('Zod 4 migration contracts', () => {
  it('validates the OpenAI authentication mode', () => {
    const provider = {
      id: 'openai',
      name: 'OpenAI',
      apiType: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      enable: true
    }

    expect(LlmProviderSchema.safeParse({ ...provider, openaiAuthMode: 'chatgpt' }).success).toBe(
      true
    )
    expect(LlmProviderSchema.safeParse({ ...provider, openaiAuthMode: 'invalid' }).success).toBe(
      false
    )
  })

  it('converts tool schemas through native Zod JSON Schema conversion', () => {
    const jsonSchema = toDeepChatJsonSchema(questionToolSchema)

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.properties).toHaveProperty('question')
    expect(jsonSchema.properties).toHaveProperty('options')
    expect(jsonSchema.required).toEqual(expect.arrayContaining(['question', 'options']))
    expect(jsonSchema).not.toHaveProperty('$schema')
    expect(jsonSchema).not.toHaveProperty('$defs')
    expect(jsonSchema).not.toHaveProperty('$ref')
  })

  it('keeps top-level object unions compatible with tool parameter schemas', () => {
    const jsonSchema = toDeepChatJsonSchema(
      z.discriminatedUnion('action', [
        z.object({
          action: z.literal('create'),
          content: z.string()
        }),
        z.object({
          action: z.literal('delete'),
          draftId: z.string()
        })
      ])
    )

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.properties).toHaveProperty('action')
    expect(jsonSchema.properties).toHaveProperty('content')
    expect(jsonSchema.properties).toHaveProperty('draftId')
    expect(jsonSchema.required).toEqual(['action'])
    expect(jsonSchema).not.toHaveProperty('$schema')
    expect(jsonSchema).not.toHaveProperty('oneOf')
    expect(jsonSchema).not.toHaveProperty('anyOf')
    expect(jsonSchema).not.toHaveProperty('allOf')
    expect(jsonSchema.properties.action).toEqual({
      type: 'string',
      enum: ['create', 'delete']
    })
  })

  it('keeps nullable top-level object schemas usable as tool parameter schemas', () => {
    const jsonSchema = toDeepChatJsonSchema(
      z
        .object({
          value: z.string()
        })
        .nullable()
    )

    expect(jsonSchema).toEqual({
      type: 'object',
      properties: {
        value: {
          type: 'string'
        }
      },
      required: ['value']
    })
  })

  it('preserves conflicting union property schemas with nested anyOf', () => {
    const jsonSchema = toDeepChatJsonSchema(
      z.union([
        z.object({
          value: z.string()
        }),
        z.object({
          value: z.number()
        })
      ])
    )

    expect(jsonSchema.properties.value).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }]
    })
  })

  it('flattens compatible scalar intersections without dropping bounds', () => {
    const jsonSchema = toDeepChatJsonSchema(
      z.object({
        text: z.intersection(z.string().min(2), z.string().max(7)),
        count: z.intersection(z.number().gt(-3), z.number().max(11))
      })
    )

    expect(jsonSchema.properties).toEqual({
      text: { type: 'string', minLength: 2, maxLength: 7 },
      count: { type: 'number', exclusiveMinimum: -3, maximum: 11 }
    })
    expect(jsonSchema.required).toEqual(['text', 'count'])
  })

  it('flattens intersections introduced by merging object properties', () => {
    const jsonSchema = toDeepChatJsonSchema(
      z.intersection(z.object({ value: z.string().min(2) }), z.object({ value: z.string().max(7) }))
    )

    expect(jsonSchema).toEqual({
      type: 'object',
      properties: { value: { type: 'string', minLength: 2, maxLength: 7 } },
      required: ['value']
    })
  })

  it('flattens scalar intersections in nested schema positions', () => {
    const bounded = z.intersection(z.string().min(2), z.string().max(7))
    const jsonSchema = toDeepChatJsonSchema(
      z.object({
        list: z.array(bounded),
        tuple: z.tuple([bounded]),
        map: z.record(z.string(), bounded),
        nullable: bounded.nullable()
      })
    )
    const expected = { type: 'string', minLength: 2, maxLength: 7 }

    expect(jsonSchema.properties.list).toEqual({ type: 'array', items: expected })
    expect(jsonSchema.properties.tuple).toEqual({
      type: 'array',
      prefixItems: [expected],
      items: false,
      minItems: 1,
      maxItems: 1
    })
    expect(jsonSchema.properties.map).toEqual({
      type: 'object',
      propertyNames: { type: 'string' },
      additionalProperties: expected
    })
    expect(jsonSchema.properties.nullable).toEqual({ anyOf: [expected, { type: 'null' }] })
  })

  it('preserves literal allOf data in defaults and examples', () => {
    const data = { allOf: [{ type: 'string' }, { type: 'number' }] }
    const jsonSchema = toDeepChatJsonSchema(
      z.object({
        value: z
          .unknown()
          .default(data)
          .meta({ examples: [data] })
      })
    )

    expect(jsonSchema.properties.value).toEqual({ default: data, examples: [data] })
  })

  it.each([
    z.intersection(z.string(), z.number()),
    z.intersection(z.string().regex(/^a/), z.string().regex(/z$/)),
    z.intersection(z.string().min(2), z.string().min(5))
  ])('rejects intersections that need constraint-specific merging (%#)', (value) => {
    expect(() => toDeepChatJsonSchema(z.object({ value }))).toThrow(
      'DeepChat tool schema intersection has unsupported or conflicting constraints.'
    )
  })

  it('rejects conflicting intersection object schemas for tool schemas', () => {
    expect(() =>
      toDeepChatJsonSchema(
        z.intersection(
          z.object({
            value: z.string()
          }),
          z.object({
            value: z.number()
          })
        )
      )
    ).toThrow('DeepChat tool schema intersection has unsupported or conflicting constraints.')
  })

  it('preserves meaningful root additionalProperties values', () => {
    const strictSchema = toDeepChatJsonSchema(
      z.strictObject({
        value: z.string()
      })
    )
    const looseSchema = toDeepChatJsonSchema(
      z.looseObject({
        value: z.string()
      })
    )

    expect(strictSchema.additionalProperties).toBe(false)
    expect(looseSchema.additionalProperties).toEqual({})
  })

  it('keeps strict object schemas rejecting unknown keys', () => {
    const parsed = agentPlanItemSchema.safeParse({
      step: 'Inspect contracts',
      status: 'pending',
      extra: true
    })

    expect(parsed.success).toBe(false)
  })

  it('accepts an optional nullable priority field on agent plan items', () => {
    const withPriority = agentPlanItemSchema.safeParse({
      step: 'Analyze requirements',
      status: 'in_progress',
      priority: 'high'
    })
    expect(withPriority.success).toBe(true)

    const withNullPriority = agentPlanItemSchema.safeParse({
      step: 'Analyze requirements',
      status: 'in_progress',
      priority: null
    })
    expect(withNullPriority.success).toBe(true)

    const withoutPriority = agentPlanItemSchema.safeParse({
      step: 'Analyze requirements',
      status: 'in_progress'
    })
    expect(withoutPriority.success).toBe(true)
  })

  it('falls back to content when normalizing blank agent plan steps', () => {
    expect(
      normalizeAgentPlanEntry({
        step: '   ',
        content: 'Fallback text',
        status: 'in_progress'
      })
    ).toEqual({
      step: 'Fallback text',
      status: 'in_progress'
    })
  })

  it('prefers non-blank steps when normalizing agent plan entries', () => {
    expect(
      normalizeAgentPlanEntry({
        step: 'Primary text',
        content: 'Fallback text',
        status: 'completed'
      })
    ).toEqual({
      step: 'Primary text',
      status: 'completed'
    })
  })

  it('preserves usage stats backfill progress fields across contract parsing', () => {
    expect(
      UsageStatsBackfillStatusSchema.parse({
        status: 'completed',
        startedAt: 1,
        finishedAt: 2,
        error: null,
        updatedAt: 2,
        processedCount: 123,
        durationMs: 456
      })
    ).toMatchObject({
      processedCount: 123,
      durationMs: 456
    })
  })

  it('keeps loose object schemas preserving unknown keys', () => {
    const parsed = McpServerConfigSchema.parse({
      command: 'node',
      customField: 'kept'
    })

    expect(parsed).toMatchObject({
      command: 'node',
      customField: 'kept'
    })
  })

  it('keeps plain object schemas stripping unknown keys', () => {
    const parsed = ProjectSchema.parse({
      path: '/tmp/project',
      name: 'Project',
      icon: null,
      lastAccessedAt: 1,
      exists: true,
      customField: 'removed'
    })

    expect(parsed).not.toHaveProperty('customField')
  })

  it('keeps default optional tool argument behavior', () => {
    const parsed = questionToolSchema.parse({
      question: 'Pick one option.',
      options: [{ label: 'A' }]
    })

    expect(parsed.multiple).toBe(false)
    expect(parsed.custom).toBe(true)
  })

  it('keeps recursive JSON record parsing', () => {
    const parsed = JsonValueSchema.parse({
      nested: {
        enabled: true,
        values: ['a', 1, null]
      }
    })

    expect(parsed).toEqual({
      nested: {
        enabled: true,
        values: ['a', 1, null]
      }
    })
  })

  it('rejects non-object JSON Schema conversion results for tool schemas', () => {
    expect(() => toDeepChatJsonSchema(z.string())).toThrow(
      'DeepChat tool schemas must convert to JSON object schemas.'
    )
  })

  it('rejects top-level record schemas for tool schemas', () => {
    expect(() => toDeepChatJsonSchema(z.record(z.string(), z.string()))).toThrow(
      'DeepChat tool schemas must convert to JSON object schemas.'
    )
  })

  it('rejects top-level object unions with non-object variants', () => {
    expect(() =>
      toDeepChatJsonSchema(
        z.union([
          z.object({
            value: z.string()
          }),
          z.string()
        ])
      )
    ).toThrow('DeepChat tool schemas must convert to JSON object schemas.')
  })

  it('lets Zod reject unrepresentable tool schema members', () => {
    expect(() =>
      toDeepChatJsonSchema(
        z.object({
          value: z.date()
        })
      )
    ).toThrow('Date cannot be represented in JSON Schema')
  })
})
