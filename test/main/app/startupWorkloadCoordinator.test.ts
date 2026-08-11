import { afterEach, describe, expect, it, vi } from 'vitest'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('StartupWorkloadCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('distinguishes expected cancellation from workload failure', async () => {
    const { isStartupWorkloadCancellation } = await import('@/app/startupWorkloadCoordinator')
    const cancellation = new Error('cancelled')
    cancellation.name = 'AbortError'

    expect(isStartupWorkloadCancellation(cancellation)).toBe(true)
    expect(isStartupWorkloadCancellation(new Error('migration failed'))).toBe(false)
    expect(isStartupWorkloadCancellation({ name: 'AbortError' })).toBe(true)
  })

  it('prefers higher-priority pending work when a resource lane frees up', async () => {
    const { StartupWorkloadCoordinator } = await import('@/app/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('main')

    const blocker = createDeferred<void>()
    const interactiveDone = createDeferred<void>()
    const backgroundDone = createDeferred<void>()
    const startOrder: string[] = []

    const blockerTask = coordinator.scheduleTask({
      id: 'blocker',
      target: 'main',
      phase: 'deferred',
      resource: 'cpu',
      labelKey: 'startup.blocker',
      run: async () => {
        startOrder.push('blocker')
        await blocker.promise
      }
    })

    await new Promise((resolve) => setImmediate(resolve))

    const backgroundTask = coordinator.scheduleTask({
      id: 'background',
      target: 'main',
      phase: 'background',
      resource: 'cpu',
      labelKey: 'startup.background',
      visibleId: 'main.provider.warmup',
      run: async () => {
        startOrder.push('background')
        backgroundDone.resolve()
      }
    })

    const interactiveTask = coordinator.scheduleTask({
      id: 'interactive',
      target: 'main',
      phase: 'interactive',
      resource: 'cpu',
      labelKey: 'startup.interactive',
      visibleId: 'main.session.firstPage',
      run: async () => {
        startOrder.push('interactive')
        interactiveDone.resolve()
      }
    })

    blocker.resolve()

    await Promise.all([blockerTask, interactiveDone.promise, backgroundDone.promise])
    await Promise.all([interactiveTask, backgroundTask])

    expect(startOrder).toEqual(['blocker', 'interactive', 'background'])
  })

  it('enforces cpu=1 and io=2 concurrency limits', async () => {
    const { StartupWorkloadCoordinator } = await import('@/app/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('main')

    let runningCpu = 0
    let maxRunningCpu = 0
    let runningIo = 0
    let maxRunningIo = 0
    let secondCpuStarted = false
    let thirdIoStarted = false

    const cpuGate = createDeferred<void>()
    const ioGate = createDeferred<void>()
    const firstCpuStarted = createDeferred<void>()
    const firstTwoIoStarted = createDeferred<void>()
    let ioStartedCount = 0

    const createCpuTask = (id: string, onStart?: () => void) =>
      coordinator.scheduleTask({
        id,
        target: 'main',
        phase: 'deferred',
        resource: 'cpu',
        labelKey: id,
        run: async () => {
          runningCpu += 1
          maxRunningCpu = Math.max(maxRunningCpu, runningCpu)
          onStart?.()
          if (id === 'cpu-1') {
            firstCpuStarted.resolve()
          }
          await cpuGate.promise
          runningCpu -= 1
        }
      })

    const createIoTask = (id: string, onStart?: () => void) =>
      coordinator.scheduleTask({
        id,
        target: 'main',
        phase: 'deferred',
        resource: 'io',
        labelKey: id,
        run: async () => {
          runningIo += 1
          maxRunningIo = Math.max(maxRunningIo, runningIo)
          onStart?.()
          ioStartedCount += 1
          if (ioStartedCount === 2) {
            firstTwoIoStarted.resolve()
          }
          await ioGate.promise
          runningIo -= 1
        }
      })

    const cpuTask1 = createCpuTask('cpu-1')
    const cpuTask2 = createCpuTask('cpu-2', () => {
      secondCpuStarted = true
    })
    const ioTask1 = createIoTask('io-1')
    const ioTask2 = createIoTask('io-2')
    const ioTask3 = createIoTask('io-3', () => {
      thirdIoStarted = true
    })

    await Promise.all([firstCpuStarted.promise, firstTwoIoStarted.promise])

    expect(maxRunningCpu).toBe(1)
    expect(maxRunningIo).toBe(2)
    expect(secondCpuStarted).toBe(false)
    expect(thirdIoStarted).toBe(false)

    cpuGate.resolve()
    ioGate.resolve()

    await Promise.all([cpuTask1, cpuTask2, ioTask1, ioTask2, ioTask3])

    expect(maxRunningCpu).toBe(1)
    expect(maxRunningIo).toBe(2)
  })

  it('keeps distinct results for tasks that share a visible slot', async () => {
    const { StartupWorkloadCoordinator } = await import('@/app/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('settings')

    const first = coordinator.scheduleTask({
      id: 'settings.mcp.runtime:enabled',
      target: 'settings',
      phase: 'deferred',
      resource: 'io',
      labelKey: 'startup.settings.mcp.runtime',
      visibleId: 'settings.mcp.runtime',
      run: async () => ({ enabled: false })
    })
    const second = coordinator.scheduleTask({
      id: 'settings.mcp.runtime:registry',
      target: 'settings',
      phase: 'deferred',
      resource: 'io',
      labelKey: 'startup.settings.mcp.runtime',
      visibleId: 'settings.mcp.runtime',
      run: async () => ({ status: 'ready' })
    })

    await expect(first).resolves.toEqual({ enabled: false })
    await expect(second).resolves.toEqual({ status: 'ready' })
  })

  it('cancels visible settings tasks and publishes the cancelled state', async () => {
    const { StartupWorkloadCoordinator } = await import('@/app/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    const published = vi.fn()
    coordinator.subscribe(published)
    coordinator.createRun('settings')

    const started = createDeferred<void>()

    const taskPromise = coordinator.scheduleTask({
      id: 'settings.providers.summary',
      target: 'settings',
      phase: 'interactive',
      resource: 'io',
      labelKey: 'startup.settings.providers.summary',
      visibleId: 'settings.providers.summary',
      run: async ({ signal }) => {
        started.resolve()
        await new Promise<void>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            },
            { once: true }
          )
        })
      }
    })

    await started.promise
    coordinator.cancelTarget('settings')

    await expect(taskPromise).rejects.toMatchObject({ name: 'AbortError' })

    const lastPayload = published.mock.calls.at(-1)?.[0]
    expect(lastPayload).toEqual(
      expect.objectContaining({
        target: 'settings',
        tasks: [
          expect.objectContaining({
            id: 'settings.providers.summary',
            state: 'cancelled'
          })
        ]
      })
    )
  })

  it('suppresses expected cancellation for an observed startup task', async () => {
    const { scheduleObservedStartupTask, StartupWorkloadCoordinator } =
      await import('@/app/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    const startupRunId = coordinator.createRun('main')
    const started = createDeferred<void>()
    const onFailure = vi.fn()

    scheduleObservedStartupTask({
      coordinator,
      startupRunId,
      task: {
        id: 'main:cancellable-background',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.cancellableBackground',
        run: async ({ signal }) => {
          started.resolve()
          await new Promise<void>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
          })
        }
      },
      onFailure
    })

    await started.promise
    coordinator.cancelTarget('main')
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(onFailure).not.toHaveBeenCalled()
  })
})
