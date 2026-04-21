import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: publishDeepchatEventMock
}))

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('prefers higher-priority pending work when a resource lane frees up', async () => {
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
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
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
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

  it('cancels visible settings tasks and publishes the cancelled state', async () => {
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
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

    const lastPayload = publishDeepchatEventMock.mock.calls.at(-1)?.[1]
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
})
