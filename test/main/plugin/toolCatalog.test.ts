import { describe, expect, it } from 'vitest'

import { parsePluginToolCatalog } from '@/plugin/toolCatalog'

const createCatalog = () => ({
  version: '0.14.1',
  tools: [
    {
      name: 'inspect_screen',
      description: 'Inspect the current screen',
      input_schema: {
        type: 'object',
        properties: {
          display_id: {
            type: 'number',
            description: 'Display to inspect'
          }
        },
        required: ['display_id']
      },
      read_only: true,
      destructive: false,
      idempotent: true
    }
  ]
})

describe('plugin tool catalog', () => {
  it('maps upstream dump-docs fields into an immutable MCP tool snapshot', () => {
    const catalog = parsePluginToolCatalog(createCatalog(), 'fixture.json')

    expect(catalog).toEqual({
      version: '0.14.1',
      tools: [
        {
          name: 'inspect_screen',
          description: 'Inspect the current screen',
          inputSchema: {
            type: 'object',
            properties: {
              display_id: {
                type: 'number',
                description: 'Display to inspect'
              }
            },
            required: ['display_id']
          },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true
          }
        }
      ]
    })
    expect(Object.isFrozen(catalog)).toBe(true)
    expect(Object.isFrozen(catalog.tools)).toBe(true)
    expect(Object.isFrozen(catalog.tools[0].inputSchema)).toBe(true)
  })

  it.each([
    {
      name: 'empty tools',
      mutate: (catalog: ReturnType<typeof createCatalog>) => {
        catalog.tools = []
      },
      error: 'tools must be a non-empty array'
    },
    {
      name: 'duplicate names',
      mutate: (catalog: ReturnType<typeof createCatalog>) => {
        catalog.tools.push({ ...catalog.tools[0] })
      },
      error: 'duplicate tool name'
    },
    {
      name: 'unsafe name',
      mutate: (catalog: ReturnType<typeof createCatalog>) => {
        catalog.tools[0].name = 'inspect screen'
      },
      error: 'must match'
    },
    {
      name: 'non-object schema',
      mutate: (catalog: ReturnType<typeof createCatalog>) => {
        catalog.tools[0].input_schema.type = 'array'
      },
      error: 'must declare type "object"'
    },
    {
      name: 'missing safety annotation',
      mutate: (catalog: ReturnType<typeof createCatalog>) => {
        delete (catalog.tools[0] as Partial<(typeof catalog.tools)[number]>).destructive
      },
      error: 'destructive must be a boolean'
    }
  ])('rejects $name instead of silently degrading discovery', ({ mutate, error }) => {
    const catalog = createCatalog()
    mutate(catalog)

    expect(() => parsePluginToolCatalog(catalog, 'broken.json')).toThrow(error)
  })
})
