import { beforeEach, describe, expect, it, vi } from 'vitest'

const presenterMocks = vi.hoisted(() => ({
  start: vi.fn()
}))

vi.mock('@/presenter', () => ({
  presenter: {
    cronJobs: {
      start: presenterMocks.start
    }
  }
}))

const { cronJobsStartHook } =
  await import('@/presenter/lifecyclePresenter/hooks/after-start/cronJobsStartHook')

describe('cronJobsStartHook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts cron jobs without priming the route runtime', async () => {
    await cronJobsStartHook.execute({} as never)

    expect(presenterMocks.start).toHaveBeenCalledOnce()
  })
})
