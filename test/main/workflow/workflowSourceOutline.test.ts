import { describe, expect, it } from 'vitest'
import { WORKFLOW_SOURCE_OUTLINE_MAX_NODES } from '@shared/workflow/outline'
import { deriveWorkflowSourceOutline } from '@/workflow/runtime/workflowSourceOutline'

describe('deriveWorkflowSourceOutline', () => {
  it('projects statically visible phases and agents without source payloads', () => {
    const outline = deriveWorkflowSourceOutline(`
phase('inspect', { label: 'Inspect' })
const result = await agent('Review a private prompt', {
  key: 'review',
  label: 'Review'
})
return result
`)

    expect(outline).toEqual({
      schemaVersion: 1,
      confidence: 'exact',
      truncated: false,
      nodes: [
        {
          id: 'outline-1',
          ordinal: 1,
          kind: 'phase',
          key: 'inspect',
          label: 'Inspect',
          itemCount: null,
          stageCount: null,
          concurrency: null,
          dynamic: false
        },
        {
          id: 'outline-2',
          ordinal: 2,
          kind: 'agent',
          key: 'review',
          label: 'Review',
          itemCount: null,
          stageCount: null,
          concurrency: null,
          dynamic: false
        }
      ]
    })
    expect(JSON.stringify(outline)).not.toContain('private prompt')
  })

  it('projects bounded group dimensions and marks scoped callback calls as partial', () => {
    const outline = deriveWorkflowSourceOutline(`
await parallel('checks', [
  { key: 'lint', run: (api) => api.agent('lint', { key: 'worker' }) },
  { key: 'test', run: (api) => api.agent('test', { key: 'worker' }) }
])
await pipeline(
  'release',
  [{ key: 'app', value: 'app' }],
  [
    { key: 'build', run: (value, api) => api.agent(value, { key: 'worker' }) },
    { key: 'verify', run: (value, api) => api.agent(value, { key: 'worker' }) }
  ]
)
return await mapLimit(
  'files',
  [{ key: 'a', value: 'A' }, { key: 'b', value: 'B' }],
  2,
  (value, api) => api.agent(value, { key: 'worker' })
)
`)

    expect(outline.confidence).toBe('partial')
    expect(outline.nodes).toEqual([
      expect.objectContaining({
        kind: 'parallel',
        key: 'checks',
        itemCount: 2,
        dynamic: false
      }),
      expect.objectContaining({
        kind: 'pipeline',
        key: 'release',
        itemCount: 1,
        stageCount: 2,
        dynamic: false
      }),
      expect.objectContaining({
        kind: 'map_limit',
        key: 'files',
        itemCount: 2,
        concurrency: 2,
        dynamic: false
      })
    ])
  })

  it('does not claim exact coverage for aliases, shadowed globals, or dynamic keys', () => {
    const aliased = deriveWorkflowSourceOutline(`
const invoke = agent
return await invoke('review', { key: input.key })
`)
    const shadowed = deriveWorkflowSourceOutline(`
const agent = (value) => value
return agent('local')
`)
    const dynamic = deriveWorkflowSourceOutline(`
return await globalThis[input.helper]('review', { key: 'review' })
`)

    expect(aliased).toMatchObject({ confidence: 'partial', nodes: [] })
    expect(shadowed).toMatchObject({ confidence: 'partial', nodes: [] })
    expect(dynamic).toMatchObject({ confidence: 'partial', nodes: [] })
  })

  it('does not treat dynamic object or array structure as exact metadata', () => {
    const outline = deriveWorkflowSourceOutline(`
phase('review', { ...input.phase })
await parallel('checks', [
  { key: 'lint', run: (api) => api.agent('lint', { key: 'worker' }) },
  ...input.tasks
])
return await agent('review', {
  key: 'review',
  [input.labelProperty]: input.label
})
`)

    expect(outline).toMatchObject({
      confidence: 'partial',
      nodes: [
        { kind: 'phase', label: null, dynamic: true },
        { kind: 'parallel', itemCount: null, dynamic: true },
        { kind: 'agent', key: null, label: null, dynamic: true }
      ]
    })
  })

  it('recognizes direct global helper calls without hiding indirect access', () => {
    const direct = deriveWorkflowSourceOutline(`
return await globalThis.agent('review', { key: 'review' })
`)
    const indirect = deriveWorkflowSourceOutline(`
const invoke = globalThis.agent
return await invoke('review', { key: 'review' })
`)

    expect(direct).toMatchObject({
      confidence: 'exact',
      nodes: [{ kind: 'agent', key: 'review', dynamic: false }]
    })
    expect(indirect).toMatchObject({ confidence: 'partial', nodes: [] })
  })

  it('bounds adversarially large outlines and reports truncation', () => {
    const source = Array.from(
      { length: WORKFLOW_SOURCE_OUTLINE_MAX_NODES + 1 },
      (_, index) => `phase('phase-${index}')`
    ).join('\n')

    const outline = deriveWorkflowSourceOutline(`${source}\nreturn null`)

    expect(outline.nodes).toHaveLength(WORKFLOW_SOURCE_OUTLINE_MAX_NODES)
    expect(outline.truncated).toBe(true)
    expect(outline.confidence).toBe('partial')
    expect(outline.nodes.at(-1)?.key).toBe('phase-255')
  })
})
