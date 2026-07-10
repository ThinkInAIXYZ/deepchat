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

type TaskSettlementHooks = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  idleBarrierRefs: number
}

type CoordinatorInternals = {
  runs: Map<string, { tasks: Set<TaskSettlementHooks> }>
  activeTasks: Set<TaskSettlementHooks>
  pendingTasks: unknown[]
  runningCounts: { cpu: number; io: number }
  inFlightByDedupeKey: Map<string, unknown>
}

function getInternals(coordinator: object): CoordinatorInternals {
  return coordinator as unknown as CoordinatorInternals
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

  it('waits for the captured cpu and io generation before running the idle callback', async () => {
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('main')

    const cpuStarted = createDeferred<void>()
    const firstIoStarted = createDeferred<void>()
    const secondIoStarted = createDeferred<void>()
    const cpuGate = createDeferred<void>()
    const firstIoGate = createDeferred<void>()
    const secondIoGate = createDeferred<void>()

    const cpuTask = coordinator.scheduleTask({
      id: 'main:cpu',
      target: 'main',
      phase: 'deferred',
      resource: 'cpu',
      labelKey: 'startup.main.cpu',
      run: async () => {
        cpuStarted.resolve()
        await cpuGate.promise
      }
    })
    const firstIoTask = coordinator.scheduleTask({
      id: 'main:io:first',
      target: 'main',
      phase: 'deferred',
      resource: 'io',
      labelKey: 'startup.main.io.first',
      run: async () => {
        firstIoStarted.resolve()
        await firstIoGate.promise
      }
    })
    const secondIoTask = coordinator.scheduleTask({
      id: 'main:io:second',
      target: 'main',
      phase: 'deferred',
      resource: 'io',
      labelKey: 'startup.main.io.second',
      run: async () => {
        secondIoStarted.resolve()
        await secondIoGate.promise
        throw new Error('expected task failure')
      }
    })
    const secondIoFailure = expect(secondIoTask).rejects.toThrow('expected task failure')

    await Promise.all([cpuStarted.promise, firstIoStarted.promise, secondIoStarted.promise])

    const callback = vi.fn()
    const callsBeforeBarrier = publishDeepchatEventMock.mock.calls.length
    const idleBarrier = coordinator.whenIdle('main', async () => {
      callback()
    })

    expect(publishDeepchatEventMock.mock.calls).toHaveLength(callsBeforeBarrier)
    await new Promise((resolve) => setImmediate(resolve))
    expect(callback).not.toHaveBeenCalled()

    cpuGate.resolve()
    await cpuTask
    await new Promise((resolve) => setImmediate(resolve))
    expect(callback).not.toHaveBeenCalled()

    firstIoGate.resolve()
    await firstIoTask
    await new Promise((resolve) => setImmediate(resolve))
    expect(callback).not.toHaveBeenCalled()

    secondIoGate.resolve()
    await secondIoFailure
    await idleBarrier

    expect(callback).toHaveBeenCalledOnce()
    expect(coordinator.isIdle()).toBe(true)
  })

  it('does not extend an idle generation with tasks scheduled after the barrier starts', async () => {
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('main')

    const capturedStarted = createDeferred<void>()
    const capturedGate = createDeferred<void>()
    const capturedTask = coordinator.scheduleTask({
      id: 'main:captured',
      target: 'main',
      phase: 'deferred',
      resource: 'cpu',
      labelKey: 'startup.main.captured',
      run: async () => {
        capturedStarted.resolve()
        await capturedGate.promise
      }
    })
    await capturedStarted.promise

    const callback = vi.fn()
    const idleBarrier = coordinator.whenIdle('main', async () => {
      callback()
    })

    const laterStarted = createDeferred<void>()
    const laterGate = createDeferred<void>()
    const laterTask = coordinator.scheduleTask({
      id: 'main:later',
      target: 'main',
      phase: 'deferred',
      resource: 'io',
      labelKey: 'startup.main.later',
      run: async () => {
        laterStarted.resolve()
        await laterGate.promise
      }
    })

    await laterStarted.promise
    expect(callback).not.toHaveBeenCalled()

    capturedGate.resolve()
    await capturedTask
    await idleBarrier

    expect(callback).toHaveBeenCalledOnce()
    expect(coordinator.isIdle()).toBe(false)

    laterGate.resolve()
    await laterTask
    expect(coordinator.isIdle()).toBe(true)
  })

  it('protects captured pending work from later same-resource phase starvation', async () => {
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('main')

    const blockerStarted = createDeferred<void>()
    const blockerGate = createDeferred<void>()
    const capturedGate = createDeferred<void>()
    const laterStarted = createDeferred<void>()
    const laterGate = createDeferred<void>()
    const startOrder: string[] = []

    const blockerTask = coordinator.scheduleTask({
      id: 'main:blocker',
      target: 'main',
      phase: 'deferred',
      resource: 'cpu',
      labelKey: 'startup.main.blocker',
      run: async () => {
        startOrder.push('blocker')
        blockerStarted.resolve()
        await blockerGate.promise
      }
    })
    await blockerStarted.promise

    const capturedTask = coordinator.scheduleTask({
      id: 'main:captured-background',
      target: 'main',
      phase: 'background',
      resource: 'cpu',
      labelKey: 'startup.main.capturedBackground',
      run: async () => {
        startOrder.push('captured')
        await capturedGate.promise
      }
    })

    const callback = vi.fn()
    const idleBarrier = coordinator.whenIdle('main', async () => {
      callback()
    })

    const laterTask = coordinator.scheduleTask({
      id: 'main:later-interactive',
      target: 'main',
      phase: 'interactive',
      resource: 'cpu',
      labelKey: 'startup.main.laterInteractive',
      run: async () => {
        startOrder.push('later')
        laterStarted.resolve()
        await laterGate.promise
      }
    })

    blockerGate.resolve()
    await blockerTask
    await new Promise((resolve) => setImmediate(resolve))

    expect(startOrder).toEqual(['blocker', 'captured'])
    expect(callback).not.toHaveBeenCalled()

    capturedGate.resolve()
    await capturedTask
    await laterStarted.promise
    await idleBarrier

    expect(startOrder).toEqual(['blocker', 'captured', 'later'])
    expect(callback).toHaveBeenCalledOnce()
    expect(coordinator.isIdle()).toBe(false)

    laterGate.resolve()
    await laterTask
    expect(coordinator.isIdle()).toBe(true)
  })

  it('waits across targets for a publicly cancelled task to release its lane', async () => {
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('main')

    const taskStarted = createDeferred<void>()
    const taskGate = createDeferred<void>()
    const executionSettled = createDeferred<void>()
    const task = coordinator.scheduleTask({
      id: 'main:cancelled-but-running',
      target: 'main',
      phase: 'deferred',
      resource: 'cpu',
      labelKey: 'startup.main.cancelledButRunning',
      run: async () => {
        taskStarted.resolve()
        try {
          await taskGate.promise
        } finally {
          executionSettled.resolve()
        }
      }
    })
    const taskCancellation = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    await taskStarted.promise

    coordinator.cancelTarget('main')
    await taskCancellation

    const callback = vi.fn()
    const idleBarrier = coordinator.whenIdle('settings', async () => {
      callback()
    })

    await new Promise((resolve) => setImmediate(resolve))
    expect(callback).not.toHaveBeenCalled()
    expect(getInternals(coordinator).runningCounts.cpu).toBe(1)

    taskGate.resolve()
    await executionSettled.promise
    await idleBarrier

    expect(callback).toHaveBeenCalledOnce()
    expect(coordinator.isIdle()).toBe(true)
    expect(getInternals(coordinator).activeTasks.size).toBe(0)
  })

  it('runs every callback once when multiple idle waiters capture one generation', async () => {
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('main')

    const taskStarted = createDeferred<void>()
    const taskGate = createDeferred<void>()
    const task = coordinator.scheduleTask({
      id: 'main:shared-generation',
      target: 'main',
      phase: 'deferred',
      resource: 'cpu',
      labelKey: 'startup.main.sharedGeneration',
      run: async () => {
        taskStarted.resolve()
        await taskGate.promise
      }
    })
    await taskStarted.promise

    const firstCallback = vi.fn(async () => 'first')
    const secondCallback = vi.fn(async () => 'second')
    const firstWaiter = coordinator.whenIdle('main', firstCallback)
    const secondWaiter = coordinator.whenIdle('main', secondCallback)
    const taskRecord = [...getInternals(coordinator).activeTasks][0]!

    expect(taskRecord.idleBarrierRefs).toBe(2)

    taskGate.resolve()
    await task

    await expect(Promise.all([firstWaiter, secondWaiter])).resolves.toEqual(['first', 'second'])
    expect(firstCallback).toHaveBeenCalledOnce()
    expect(secondCallback).toHaveBeenCalledOnce()
    expect(taskRecord.idleBarrierRefs).toBe(0)
  })

  it('runs an immediate idle callback directly without publishing workload state', async () => {
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('main')

    const callback = vi.fn(async () => 42)
    const callsBeforeBarrier = publishDeepchatEventMock.mock.calls.length

    await expect(coordinator.whenIdle('main', callback)).resolves.toBe(42)

    expect(callback).toHaveBeenCalledOnce()
    expect(publishDeepchatEventMock.mock.calls).toHaveLength(callsBeforeBarrier)
    expect(coordinator.isIdle()).toBe(true)
  })

  it('preserves callback rejection after the callback owns cancellation', async () => {
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('main')

    const taskStarted = createDeferred<void>()
    const taskGate = createDeferred<void>()
    const task = coordinator.scheduleTask({
      id: 'main:before-callback',
      target: 'main',
      phase: 'deferred',
      resource: 'cpu',
      labelKey: 'startup.main.beforeCallback',
      run: async () => {
        taskStarted.resolve()
        await taskGate.promise
      }
    })
    await taskStarted.promise

    const callbackStarted = createDeferred<void>()
    const callbackGate = createDeferred<void>()
    const callback = vi.fn(async () => {
      callbackStarted.resolve()
      await callbackGate.promise
    })
    const idleBarrier = coordinator.whenIdle('main', callback)
    const barrierOutcome = idleBarrier.then(
      () => undefined,
      (error: unknown) => error
    )
    const taskRecord = [...getInternals(coordinator).activeTasks][0]!

    taskGate.resolve()
    await task
    await callbackStarted.promise

    expect(taskRecord.idleBarrierRefs).toBe(0)

    const callbackError = new Error('callback owns this failure')
    coordinator.cancelTarget('main')
    callbackGate.reject(callbackError)

    expect(await barrierOutcome).toBe(callbackError)
    expect(callback).toHaveBeenCalledOnce()

    const internals = getInternals(coordinator)
    expect(internals.activeTasks.size).toBe(0)
    expect(internals.pendingTasks).toHaveLength(0)
    expect(internals.inFlightByDedupeKey.size).toBe(0)
    expect(internals.runs.has('main')).toBe(false)
  })

  it('cancels an idle barrier once without leaking late task execution', async () => {
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('main')

    const taskStarted = createDeferred<void>()
    const taskGate = createDeferred<void>()
    const executionSettled = createDeferred<void>()
    const task = coordinator.scheduleTask({
      id: 'main:late-settlement',
      target: 'main',
      phase: 'deferred',
      resource: 'cpu',
      labelKey: 'startup.main.lateSettlement',
      run: async () => {
        taskStarted.resolve()
        try {
          await taskGate.promise
        } finally {
          executionSettled.resolve()
        }
      }
    })
    const taskCancellation = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    await taskStarted.promise

    const callback = vi.fn()
    const idleBarrier = coordinator.whenIdle('main', async () => {
      callback()
    })
    const barrierCancellation = expect(idleBarrier).rejects.toMatchObject({ name: 'AbortError' })
    const taskRecord = [...getInternals(coordinator).activeTasks][0]!

    coordinator.cancelTarget('main')
    await Promise.all([taskCancellation, barrierCancellation])

    const internals = getInternals(coordinator)
    expect(callback).not.toHaveBeenCalled()
    expect(internals.activeTasks.size).toBe(1)
    expect(internals.runningCounts.cpu).toBe(1)
    expect(internals.inFlightByDedupeKey.size).toBe(0)
    expect(internals.runs.has('main')).toBe(false)
    expect(taskRecord.idleBarrierRefs).toBe(0)

    taskGate.reject(new Error('late failure'))
    await executionSettled.promise
    await vi.waitFor(() => expect(coordinator.isIdle()).toBe(true))

    expect(callback).not.toHaveBeenCalled()
    expect(internals.activeTasks.size).toBe(0)
    expect(internals.pendingTasks).toHaveLength(0)
    expect(internals.runningCounts.cpu).toBe(0)
    expect(internals.inFlightByDedupeKey.size).toBe(0)
    expect(internals.runs.has('main')).toBe(false)
  })

  it('cleans pending task records across repeated target cancellation', async () => {
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('main')

    const blockerStarted = createDeferred<void>()
    const blockerGate = createDeferred<void>()
    const blockerTask = coordinator.scheduleTask({
      id: 'main:blocker',
      target: 'main',
      phase: 'deferred',
      resource: 'cpu',
      labelKey: 'startup.main.blocker',
      run: async () => {
        blockerStarted.resolve()
        await blockerGate.promise
      }
    })

    await blockerStarted.promise

    const internals = getInternals(coordinator)
    expect(internals.runningCounts.cpu).toBe(1)

    for (let index = 0; index < 20; index += 1) {
      coordinator.createRun('settings')
      const pendingTask = coordinator.scheduleTask({
        id: `settings:pending:${index}`,
        target: 'settings',
        phase: 'deferred',
        resource: 'cpu',
        labelKey: 'startup.settings.pending',
        run: async () => {}
      })
      const cancellation = expect(pendingTask).rejects.toMatchObject({ name: 'AbortError' })

      coordinator.cancelTarget('settings')
      await cancellation

      expect(internals.pendingTasks).toHaveLength(0)
      expect(internals.inFlightByDedupeKey.size).toBe(1)
      expect(internals.runs.has('settings')).toBe(false)
      expect([...internals.runs.values()].reduce((sum, run) => sum + run.tasks.size, 0)).toBe(1)
    }

    blockerGate.resolve()
    await blockerTask

    expect(coordinator.isIdle()).toBe(true)
    expect(internals.pendingTasks).toHaveLength(0)
    expect(internals.inFlightByDedupeKey.size).toBe(0)
    expect([...internals.runs.values()].reduce((sum, run) => sum + run.tasks.size, 0)).toBe(0)
  })

  it('settles a cancelled running task only once and restores its lane', async () => {
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('settings')

    const started = createDeferred<void>()
    const runGate = createDeferred<void>()
    const runSettled = createDeferred<void>()
    const taskPromise = coordinator.scheduleTask({
      id: 'settings:running',
      target: 'settings',
      phase: 'interactive',
      resource: 'cpu',
      labelKey: 'startup.settings.running',
      run: async () => {
        started.resolve()
        try {
          await runGate.promise
        } finally {
          runSettled.resolve()
        }
      }
    })

    await started.promise

    const internals = getInternals(coordinator)
    const task = [...(internals.runs.get('settings')?.tasks ?? [])][0]!
    const originalResolve = task.resolve
    const originalReject = task.reject
    const resolveSpy = vi.fn((value: unknown) => originalResolve(value))
    const rejectSpy = vi.fn((reason?: unknown) => originalReject(reason))
    task.resolve = resolveSpy
    task.reject = rejectSpy
    const cancellation = expect(taskPromise).rejects.toMatchObject({ name: 'AbortError' })

    coordinator.cancelTarget('settings')
    await cancellation
    expect(rejectSpy).toHaveBeenCalledTimes(1)

    const nextTaskStarted = vi.fn()
    coordinator.createRun('main')
    const nextTask = coordinator.scheduleTask({
      id: 'main:next',
      target: 'main',
      phase: 'interactive',
      resource: 'cpu',
      labelKey: 'startup.main.next',
      run: async () => {
        nextTaskStarted()
      }
    })

    await new Promise((resolve) => setImmediate(resolve))
    expect(nextTaskStarted).not.toHaveBeenCalled()
    expect(internals.pendingTasks).toHaveLength(1)
    expect(internals.runningCounts.cpu).toBe(1)

    runGate.reject(new Error('late failure'))
    await runSettled.promise
    await nextTask
    await vi.waitFor(() => expect(coordinator.isIdle()).toBe(true))

    expect(rejectSpy).toHaveBeenCalledTimes(1)
    expect(resolveSpy).not.toHaveBeenCalled()
    expect(nextTaskStarted).toHaveBeenCalledOnce()
    expect(internals.pendingTasks).toHaveLength(0)
    expect(internals.inFlightByDedupeKey.size).toBe(0)
    expect(internals.runs.has('settings')).toBe(false)
    expect(internals.runningCounts.cpu).toBe(0)
  })

  it('publishes one atomic snapshot when cancelling multiple visible tasks', async () => {
    const { StartupWorkloadCoordinator } = await import('@/presenter/startupWorkloadCoordinator')
    const coordinator = new StartupWorkloadCoordinator()
    coordinator.createRun('settings')

    const firstStarted = createDeferred<void>()
    const secondStarted = createDeferred<void>()

    const firstTask = coordinator.scheduleTask({
      id: 'settings.providers.summary',
      target: 'settings',
      phase: 'interactive',
      resource: 'io',
      labelKey: 'startup.settings.providers.summary',
      visibleId: 'settings.providers.summary',
      run: async ({ signal }) => {
        firstStarted.resolve()
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

    const secondTask = coordinator.scheduleTask({
      id: 'settings.provider.models',
      target: 'settings',
      phase: 'interactive',
      resource: 'io',
      labelKey: 'startup.settings.provider.models',
      visibleId: 'settings.provider.models',
      run: async ({ signal }) => {
        secondStarted.resolve()
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

    await Promise.all([firstStarted.promise, secondStarted.promise])
    const callsBeforeCancel = publishDeepchatEventMock.mock.calls.length
    const cancellations = [firstTask, secondTask].map((task) =>
      expect(task).rejects.toMatchObject({ name: 'AbortError' })
    )

    coordinator.cancelTarget('settings')
    await Promise.all(cancellations)
    await new Promise((resolve) => setImmediate(resolve))

    const cancellationEvents = publishDeepchatEventMock.mock.calls.slice(callsBeforeCancel)
    expect(cancellationEvents).toHaveLength(1)
    expect(cancellationEvents[0]?.[0]).toBe('startup.workload.changed')

    const lastPayload = cancellationEvents[0]?.[1]
    expect(lastPayload).toEqual(
      expect.objectContaining({
        target: 'settings',
        tasks: [
          expect.objectContaining({
            id: 'settings.providers.summary',
            state: 'cancelled'
          }),
          expect.objectContaining({
            id: 'settings.provider.models',
            state: 'cancelled'
          })
        ]
      })
    )
  })
})
