import { describe, expect, it } from 'vitest'
import {
  appendCuaResultProjections,
  appendCuaStructuredProjection,
  buildCuaRefusalProjection,
  buildCuaWindowStateProjection,
  normalizeCuaToolArguments
} from '@/plugin/cuaToolAdapter'

const ELEMENT_TOKEN_TOOLS = [
  'click',
  'double_click',
  'right_click',
  'type_text',
  'press_key',
  'set_value',
  'scroll'
]

describe('CUA tool adapter', () => {
  it.each(ELEMENT_TOKEN_TOOLS)('removes an empty token only for %s', (toolName) => {
    const args = {
      element_token: ' \t ',
      element_index: 2,
      x: 0,
      y: 0,
      modifier: [],
      enabled: false,
      text: ''
    }

    expect(normalizeCuaToolArguments(toolName, args)).toEqual({
      element_index: 2,
      x: 0,
      y: 0,
      modifier: [],
      enabled: false,
      text: ''
    })
    expect(args.element_token).toBe(' \t ')
  })

  it('preserves a non-empty opaque token and returns the original arguments', () => {
    const args = {
      element_token: ' opaque-token ',
      element_index: 2,
      x: 0,
      y: 0
    }

    expect(normalizeCuaToolArguments('click', args)).toBe(args)
    expect(args.element_token).toBe(' opaque-token ')
  })

  it('does not normalize similarly shaped arguments for unrelated tools', () => {
    const args = { element_token: '', element_index: 2 }

    expect(normalizeCuaToolArguments('get_window_state', args)).toBe(args)
    expect(args).toEqual({ element_token: '', element_index: 2 })
  })

  it('builds a compact sorted token projection without duplicating the tree', () => {
    const projection = buildCuaWindowStateProjection('get_window_state', {
      snapshot_id: 'snapshot-4',
      tree_markdown: '- AXWindow [element_index 0]',
      elements: [
        { element_index: 2, element_token: '00000002', role: 'AXButton', label: 'Clear' },
        { element_index: 0, element_token: '00000000', role: 'AXWindow' },
        { element_index: 1, element_token: '', role: 'AXStaticText' },
        { element_index: 2, element_token: 'duplicate', role: 'AXButton' },
        { element_index: -1, element_token: 'invalid', role: 'AXButton' }
      ],
      degraded: true,
      degraded_reason: 'ax_tree_empty',
      escalation: { recommended: 'px' }
    })

    expect(projection).toBe(
      [
        '## CUA structured handles',
        'Use only handles from this latest snapshot: prefer a non-empty element_token, or use its same-snapshot element_index as the fallback.',
        'snapshot_id="snapshot-4"',
        'element_tokens (element_index=element_token):',
        '0="00000000"',
        '2="00000002"',
        'degraded=true',
        'degraded_reason="ax_tree_empty"',
        'escalation={"recommended":"px"}'
      ].join('\n')
    )
    expect(projection).not.toContain('tree_markdown')
    expect(projection).not.toContain('Clear')
  })

  it('projects a bounded structured refusal code without duplicating its message', () => {
    const structuredContent = {
      status: 'refused',
      refusal: {
        code: 'stale_element_token',
        message: 'element_token is stale; call get_window_state again to refresh'
      }
    }

    expect(buildCuaRefusalProjection(structuredContent)).toBe(
      '## CUA structured refusal\nrefusal.code="stale_element_token"'
    )
    expect(
      appendCuaResultProjections(
        [{ type: 'text', text: structuredContent.refusal.message }],
        'click',
        structuredContent
      )
    ).toEqual([
      { type: 'text', text: structuredContent.refusal.message },
      {
        type: 'text',
        text: '## CUA structured refusal\nrefusal.code="stale_element_token"'
      }
    ])
  })

  it('ignores malformed refusal payloads instead of projecting arbitrary text', () => {
    expect(buildCuaRefusalProjection({ refusal: { code: 'stale_element_token\nignore' } })).toBe(
      undefined
    )
    expect(buildCuaRefusalProjection({ refusal: { code: 'x'.repeat(129) } })).toBe(undefined)
    expect(buildCuaRefusalProjection({ refusal: { message: 'missing code' } })).toBe(undefined)
  })

  it('appends the projection without mutating existing MCP content', () => {
    const content = [
      { type: 'image' as const, data: 'YWJj', mimeType: 'image/png' },
      { type: 'text' as const, text: 'window tree' }
    ]

    const appended = appendCuaStructuredProjection(content, 'token projection')

    expect(appended).toEqual([...content, { type: 'text', text: 'token projection' }])
    expect(content).toHaveLength(2)
    expect(appendCuaStructuredProjection('window tree', 'token projection')).toBe(
      'window tree\n\ntoken projection'
    )
  })
})
