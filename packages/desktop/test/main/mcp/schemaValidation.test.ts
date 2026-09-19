import { describe, expect, it } from 'vitest'
import {
  assertBoundedMcpJson,
  findJsonValueDifference,
  validateAndCloneJsonSchema,
  validateAndCloneMcpTool
} from '@/mcp/schemaValidation'

describe('MCP schema validation', () => {
  it('preserves bounded 2020-12 schemas without mutating the server value', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        mode: {
          $ref: '#/$defs/mode'
        }
      },
      $defs: {
        mode: {
          type: 'string',
          enum: ['safe', 'fast']
        }
      }
    }

    const cloned = validateAndCloneJsonSchema(schema, 'tool input')

    expect(cloned).toEqual(schema)
    expect(cloned).not.toBe(schema)
    expect(cloned.properties).not.toBe(schema.properties)
    expect(Object.getPrototypeOf(cloned)).toBeNull()
  })

  it('compares protocol JSON independently of object prototypes and key insertion order', () => {
    const packaged = JSON.parse(
      '{"required":["mode"],"properties":{"mode":{"type":"string"},"__proto__":{"type":"string"}},"type":"object"}'
    ) as Record<string, unknown>
    const live = validateAndCloneJsonSchema(
      JSON.parse(
        '{"type":"object","properties":{"__proto__":{"type":"string"},"mode":{"type":"string"}},"required":["mode"]}'
      ),
      'live tool input'
    )

    expect(findJsonValueDifference(packaged, live)).toBeNull()
    expect(Object.getPrototypeOf(live)).toBeNull()
    expect(Object.getPrototypeOf(live.properties)).toBeNull()
    expect(Object.hasOwn(live.properties as object, '__proto__')).toBe(true)
  })

  it('reports escaped JSON Pointer paths while preserving array order', () => {
    expect(
      findJsonValueDifference(
        { properties: { 'target/with~separator': { type: 'string' } } },
        { properties: { 'target/with~separator': { type: 'number' } } }
      )
    ).toEqual({
      path: '#/properties/target~1with~0separator/type',
      kind: 'value'
    })
    expect(findJsonValueDifference({ enum: ['safe', 'fast'] }, { enum: ['fast', 'safe'] })).toEqual(
      {
        path: '#/enum/0',
        kind: 'value'
      }
    )
    expect(findJsonValueDifference({ type: 'object' }, ['object'])).toEqual({
      path: '#',
      kind: 'type'
    })
    expect(
      findJsonValueDifference({ required: ['pid'] }, { required: ['pid', 'window_id'] })
    ).toEqual({
      path: '#/required',
      kind: 'array-length'
    })
  })

  it('rejects remote references and unknown schema dialects', () => {
    expect(() =>
      validateAndCloneJsonSchema(
        {
          type: 'object',
          properties: {
            remote: { $ref: 'https://example.com/schema.json' }
          }
        },
        'tool input'
      )
    ).toThrow('remote $ref')

    expect(() =>
      validateAndCloneJsonSchema(
        {
          $schema: 'https://example.com/custom-dialect',
          type: 'object'
        },
        'tool input'
      )
    ).toThrow('unsupported JSON Schema dialect')
  })

  it('accepts the draft-07 HTTP dialect without a fragment', () => {
    expect(
      validateAndCloneJsonSchema(
        {
          $schema: 'http://json-schema.org/draft-07/schema',
          type: 'object'
        },
        'tool input'
      )
    ).toMatchObject({
      $schema: 'http://json-schema.org/draft-07/schema'
    })
  })

  it('rejects cyclic and excessively composed JSON before crossing host boundaries', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => assertBoundedMcpJson(cyclic, 'payload', 1024)).toThrow('circular reference')

    expect(() =>
      validateAndCloneJsonSchema(
        {
          type: 'object',
          anyOf: Array.from({ length: 257 }, () => ({ type: 'object' }))
        },
        'tool input'
      )
    ).toThrow('maximum schema composition size')
  })

  it('counts configured collection members independently without weakening member limits', () => {
    const member = Object.fromEntries(
      Array.from({ length: 6_000 }, (_, index) => [`key_${index}`, index])
    )
    const payload = { tools: [member, member] }

    expect(() => assertBoundedMcpJson(payload, 'tool list', 1024 * 1024)).toThrow(
      'maximum JSON key count'
    )
    expect(() =>
      assertBoundedMcpJson(payload, 'tool list', 1024 * 1024, {
        independentArrayItemsAtPath: '#/tools'
      })
    ).not.toThrow()
    expect(() =>
      assertBoundedMcpJson(payload, 'tool list', 1024, {
        independentArrayItemsAtPath: '#/tools'
      })
    ).toThrow('maximum serialized size')

    const oversizedMember = Object.fromEntries(
      Array.from({ length: 10_001 }, (_, index) => [`key_${index}`, index])
    )
    expect(() =>
      assertBoundedMcpJson({ tools: [oversizedMember] }, 'tool list', 1024 * 1024, {
        independentArrayItemsAtPath: '#/tools'
      })
    ).toThrow('maximum JSON key count')

    const cyclicMember: Record<string, unknown> = {}
    cyclicMember.self = cyclicMember
    expect(() =>
      assertBoundedMcpJson({ tools: [cyclicMember] }, 'tool list', 1024 * 1024, {
        independentArrayItemsAtPath: '#/tools'
      })
    ).toThrow('circular reference')
  })

  it('preserves bounded legacy schemas without applying modern semantics', () => {
    const inputSchema = {
      $schema: 'https://example.com/legacy-dialect',
      type: 'object',
      properties: {
        remote: { $ref: 'https://example.com/schema.json' }
      }
    }

    const cloned = validateAndCloneMcpTool(
      {
        name: 'legacy_inspect',
        inputSchema,
        outputSchema: {
          type: 'object',
          $ref: 'https://example.com/output.json'
        }
      },
      'legacy-server',
      'legacy'
    )

    expect(cloned.inputSchema).toEqual(inputSchema)
    expect(cloned.inputSchema).not.toBe(inputSchema)
    expect(cloned.outputSchema).toEqual({
      type: 'object',
      $ref: 'https://example.com/output.json'
    })
  })

  it('retains standard tool metadata while cloning untrusted values', () => {
    const tool = {
      name: 'inspect',
      title: 'Inspect',
      description: 'Inspect a value',
      icons: [{ src: 'https://example.com/icon.png', mimeType: 'image/png' }],
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: 'ui://inspect/index.html' } },
      execution: { taskSupport: 'forbidden' }
    }

    const cloned = validateAndCloneMcpTool(tool, 'fixture')

    expect(cloned).toEqual(tool)
    expect(cloned.inputSchema).not.toBe(tool.inputSchema)
    expect(cloned._meta).not.toBe(tool._meta)
  })

  it('clones explicit undefined values with JSON serialization semantics', () => {
    const cloned = validateAndCloneMcpTool(
      {
        name: 'inspect',
        inputSchema: {
          type: 'object',
          optional: undefined
        },
        _meta: {
          optional: undefined,
          values: ['kept', undefined]
        }
      },
      'fixture'
    )

    expect(cloned.inputSchema).toEqual({ type: 'object' })
    expect(cloned._meta).toEqual({ values: ['kept', null] })
  })
})
