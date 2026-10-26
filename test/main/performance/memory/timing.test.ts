import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { assertTimingBudget } from './timing'

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it.each([undefined, '0', 'true'])(
  'enforces timing budgets unless report mode is explicit (%s)',
  (mode) => {
    vi.stubEnv('DEEPCHAT_MEMORY_PERF_REPORT_ONLY', mode)
    expect(() => assertTimingBudget('write-overhead', -1, 5)).not.toThrow()
    expect(() => assertTimingBudget('write-overhead', 6.94, 5)).toThrow()
  }
)

it('reports shared-runner overruns without failing the timing budget', () => {
  vi.stubEnv('DEEPCHAT_MEMORY_PERF_REPORT_ONLY', '1')
  expect(() => assertTimingBudget('write-overhead', 6.94, 5)).not.toThrow()
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('memory-perf-budget-exceeded'))
})

it('rejects invalid measurements and budgets in both modes', () => {
  for (const mode of [undefined, '1']) {
    vi.stubEnv('DEEPCHAT_MEMORY_PERF_REPORT_ONLY', mode)
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(() => assertTimingBudget('write-overhead', invalid, 5)).toThrow()
      expect(() => assertTimingBudget('write-overhead', 1, invalid)).toThrow()
    }
  }
})
