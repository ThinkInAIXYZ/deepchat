import { describe, expect, it } from 'vitest'
import { prepareWorkflowResultSchema } from '@/workflow/structuredOutput/resultSchema'

const resultSchema = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      minLength: 1
    },
    score: {
      type: ['number', 'null']
    },
    tags: {
      type: 'array',
      items: {
        type: 'string',
        maxLength: 32
      },
      maxItems: 4
    }
  },
  required: ['summary'],
  additionalProperties: false
} as const

describe('prepareWorkflowResultSchema', () => {
  it('normalizes bounded collection and string defaults before compiling', () => {
    const prepared = prepareWorkflowResultSchema(resultSchema, 4_096)

    expect(prepared.schema).toMatchObject({
      type: 'object',
      maxProperties: 128,
      additionalProperties: false,
      properties: {
        summary: {
          type: 'string',
          minLength: 1,
          maxLength: 4_096
        },
        tags: {
          type: 'array',
          minItems: 0,
          maxItems: 4
        }
      }
    })
    expect(
      prepared.validate({
        summary: 'Done',
        score: null,
        tags: ['workflow']
      })
    ).toEqual({
      score: null,
      summary: 'Done',
      tags: ['workflow']
    })
  })

  it('rejects schema features that are remote, unsafe, unbounded, or not tool-representable', () => {
    expect(() =>
      prepareWorkflowResultSchema(
        {
          type: 'object',
          properties: {
            result: {
              $ref: 'https://example.com/result.json'
            }
          }
        },
        4_096
      )
    ).toThrow('Unsupported JSON Schema keyword "$ref"')

    const unsafe = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}')
    expect(() => prepareWorkflowResultSchema(unsafe, 4_096)).toThrow('unsafe key')

    expect(() =>
      prepareWorkflowResultSchema(
        {
          type: 'object',
          properties: {
            ['line\nbreak']: {
              type: 'string'
            }
          },
          additionalProperties: false
        },
        4_096
      )
    ).toThrow('Unsafe schema property')

    expect(() =>
      prepareWorkflowResultSchema(
        {
          type: 'object',
          properties: {},
          additionalProperties: true
        },
        4_096
      )
    ).toThrow('"additionalProperties" at $ must be false')

    expect(() =>
      prepareWorkflowResultSchema(
        {
          type: 'object',
          properties: {}
        },
        4_096
      )
    ).toThrow('"additionalProperties" at $ must be false')

    expect(() =>
      prepareWorkflowResultSchema(
        {
          type: 'object',
          properties: {
            value: {
              type: ['string', 'number']
            }
          },
          additionalProperties: false
        },
        4_096
      )
    ).toThrow('may only add null')

    expect(() =>
      prepareWorkflowResultSchema(
        {
          type: 'string'
        },
        4_096
      )
    ).toThrow('root schema must have type "object"')
  })

  it('rejects invalid and oversized results without coercion', () => {
    const prepared = prepareWorkflowResultSchema(resultSchema, 128)

    expect(() => prepared.validate({ summary: 42 })).toThrow(
      'Structured result is invalid: /summary must be string'
    )
    expect(() => prepared.validate({ summary: 'ok', extra: true })).toThrow(
      'must NOT have additional properties'
    )
    expect(() => prepared.validate({ summary: 'x'.repeat(129) })).toThrow('128-byte limit')
  })

  it('parses only one exact JSON value for tool-less provider compatibility', () => {
    const prepared = prepareWorkflowResultSchema(resultSchema, 4_096)

    expect(prepared.parseExactJson(' {"summary":"Done","tags":[]} ')).toEqual({
      summary: 'Done',
      tags: []
    })
    expect(() => prepared.parseExactJson('```json\n{"summary":"Done"}\n```')).toThrow(
      'one exact JSON value'
    )
    expect(() => prepared.parseExactJson('Result: {"summary":"Done"}')).toThrow(
      'one exact JSON value'
    )
  })
})
