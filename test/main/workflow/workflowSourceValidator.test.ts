import { describe, expect, it } from 'vitest'
import {
  validateWorkflowSource,
  WorkflowSourceValidationError
} from '@/workflow/runtime/workflowSourceValidator'

describe('validateWorkflowSource', () => {
  it('accepts the supported async orchestration surface', () => {
    expect(() =>
      validateWorkflowSource(`
const rows = await Promise.all([
  agent('inspect', { key: 'inspect' }),
  agent('verify', { key: 'verify' })
])
return rows
`)
    ).not.toThrow()
  })

  it('accepts the documented keyed collection helpers and scoped callback API', () => {
    expect(() =>
      validateWorkflowSource(`
phase('review', { label: 'Review' })
const rows = await parallel('review', [
  { key: 'architecture', run: (api) => api.agent('Inspect architecture', { key: 'worker' }) },
  { key: 'tests', run: (api) => api.agent('Inspect tests', { key: 'worker' }) }
])
return await pipeline(
  'summarize',
  rows.map((value, index) => ({ key: String(index), value })),
  [{ key: 'summary', run: (value) => value }]
)
`)
    ).not.toThrow()
  })

  it.each([
    {
      source: "parallel([() => agent({ prompt: 'inspect' })])",
      helper: 'parallel',
      expected: 'parallel(key, [{ key, run(api) }, ...])'
    },
    {
      source: "agent('inspect', {})",
      helper: 'agent',
      expected: 'options must contain key'
    },
    {
      source: "parallel('review', [{ key: 'inspect' }])",
      helper: 'parallel',
      expected: 'tasks entries must contain run'
    },
    {
      source: "pipeline('review', [])",
      helper: 'pipeline',
      expected: 'pipeline(key, [{ key, value }, ...]'
    },
    {
      source: "phase('review', 'Review')",
      helper: 'phase',
      expected: 'options must be an object'
    },
    {
      source: "mapLimit('review', [], 0, () => null)",
      helper: 'mapLimit',
      expected: 'limit must be a positive integer'
    }
  ])('rejects incompatible $helper helper syntax with an actionable contract', (testCase) => {
    let error: unknown
    try {
      validateWorkflowSource(testCase.source)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(WorkflowSourceValidationError)
    expect(error).toMatchObject({
      code: 'INVALID_HELPER_CALL',
      helper: testCase.helper,
      line: 1,
      column: 0
    })
    expect((error as Error).message).toContain(testCase.expected)
  })

  it('does not apply injected helper contracts to locally shadowed functions', () => {
    expect(() =>
      validateWorkflowSource(`
const invoke = (agent) => agent({ prompt: 'local contract' })
return invoke((value) => value.prompt)
`)
    ).not.toThrow()
  })

  it('accepts quoted static helper property names', () => {
    expect(() =>
      validateWorkflowSource(`
return await agent('inspect', { 'key': 'inspect' })
`)
    ).not.toThrow()
  })

  it.each([
    "agent('x', { key: 'x' })['catch'](() => null)",
    "agent('x', { key: 'x' }).finally(() => null)",
    'Promise.race([])',
    'Promise.any([])',
    "import('./module.js')",
    "Function('return 1')()",
    "new Function('return 1')()",
    'with ({}) {}',
    'delete agent',
    '({ agent } = {})',
    'for (agent of []) {}',
    'delete globalThis.agent',
    'Promise.all = null'
  ])('rejects unsupported construct %s', (source) => {
    expect(() => validateWorkflowSource(source)).toThrow(WorkflowSourceValidationError)
  })

  it('reports strict-mode parse failures against user source lines', () => {
    expect(() => validateWorkflowSource('with ({}) {}')).toThrow('(1:0)')
  })
})
