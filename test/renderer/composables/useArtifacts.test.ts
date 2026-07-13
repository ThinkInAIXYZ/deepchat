import { describe, expect, it } from 'vitest'
import { extractArtifactsFromContent, generatePart } from '@/composables/useArtifacts'

describe('useArtifacts generatePart', () => {
  it('parses closed thinking and artifact tags', () => {
    const parts = generatePart(
      'intro <antThinking>plan</antThinking> mid <antArtifact type="text/markdown" identifier="a1" title="Doc">body</antArtifact> end',
      'success'
    )

    expect(parts.map((part) => part.type)).toEqual(['text', 'thinking', 'text', 'artifact', 'text'])
    expect(parts[1]).toMatchObject({ type: 'thinking', content: 'plan' })
    expect(parts[3]).toMatchObject({
      type: 'artifact',
      content: 'body',
      loading: false,
      artifact: {
        identifier: 'a1',
        title: 'Doc',
        type: 'text/markdown'
      }
    })
  })

  it('parses unclosed streaming artifact as loading', () => {
    const parts = generatePart(
      '<antArtifact type="text/html" identifier="h1" title="Page"><div>partial',
      'loading'
    )

    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      type: 'artifact',
      loading: true,
      content: '<div>partial',
      artifact: {
        identifier: 'h1',
        title: 'Page',
        type: 'text/html'
      }
    })
  })

  it('parses tool_call sequences without confusing tool_call_end', () => {
    const parts = generatePart(
      '<tool_call name="search">query<tool_call_end name="search">',
      'success'
    )

    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      type: 'tool_call',
      content: 'query',
      loading: false,
      tool_call: { status: 'end', name: 'search' }
    })
  })

  it('skips tool tags while status is loading', () => {
    const parts = generatePart('<tool_call name="x">partial', 'loading')
    expect(parts).toEqual([{ type: 'text', content: '<tool_call name="x">partial' }])
  })

  it('returns the same array reference for identical content and status', () => {
    const content = 'plain text only'
    const first = generatePart(content, 'success')
    const second = generatePart(content, 'success')
    expect(second).toBe(first)
  })

  it('extractArtifactsFromContent only returns artifact parts', () => {
    const artifacts = extractArtifactsFromContent(
      'x <antArtifact type="text/markdown" identifier="a" title="T">c</antArtifact>',
      'success'
    )
    expect(artifacts).toEqual([
      {
        identifier: 'a',
        title: 'T',
        type: 'text/markdown',
        language: undefined,
        content: 'c',
        loading: false
      }
    ])
  })
})
