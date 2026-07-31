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

  it.each([
    "agent('x', { key: 'x' })['catch'](() => null)",
    "agent('x', { key: 'x' }).finally(() => null)",
    'Promise.race([])',
    'Promise.any([])',
    "import('./module.js')",
    "Function('return 1')()",
    "new Function('return 1')()",
    'delete globalThis.agent',
    'Promise.all = null'
  ])('rejects unsupported construct %s', (source) => {
    expect(() => validateWorkflowSource(source)).toThrow(WorkflowSourceValidationError)
  })
})
