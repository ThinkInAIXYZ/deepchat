import { beforeEach, describe, expect, it, vi } from 'vitest'

const presenterMocks = vi.hoisted(() => ({
  start: vi.fn(),
  getRuntime: vi.fn()
}))

vi.mock('@/presenter', () => ({
  presenter: {
    cronJobs: {
      start: presenterMocks.start
    }
  },
  getMainKernelRouteRuntime: presenterMocks.getRuntime
}))

const { cronJobsStartHook } =
  await import('@/presenter/lifecyclePresenter/hooks/after-start/cronJobsStartHook')

describe('cronJobsStartHook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('primes route runtime before starting cron jobs', async () => {
    const calls: string[] = []
    presenterMocks.getRuntime.mockImplementation(() => {
      calls.push('runtime')
    })
    presenterMocks.start.mockImplementation(() => {
      calls.push('start')
    })

    await cronJobsStartHook.execute({} as never)

    expect(calls).toEqual(['runtime', 'start'])
  })
})
