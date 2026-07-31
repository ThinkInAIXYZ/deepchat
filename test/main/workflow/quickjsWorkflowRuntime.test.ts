import { afterEach, describe, expect, it } from 'vitest'
import {
  WORKFLOW_RUNTIME_DEFAULT_LIMITS,
  type WorkflowRuntimeEvent
} from '@shared/workflow/runtimeProtocol'
import { QuickJSWorkflowRuntime } from '@/workflow/runtime/quickjsWorkflowRuntime'

type InvocationEvent = Extract<WorkflowRuntimeEvent, { type: 'INVOKE_AGENT' }>

const runtimes: QuickJSWorkflowRuntime[] = []

async function createRuntime(
  events: WorkflowRuntimeEvent[],
  overrides: Partial<typeof WORKFLOW_RUNTIME_DEFAULT_LIMITS> = {}
): Promise<QuickJSWorkflowRuntime> {
  const runtime = await QuickJSWorkflowRuntime.create({
    runId: `run-${runtimes.length + 1}`,
    limits: {
      ...WORKFLOW_RUNTIME_DEFAULT_LIMITS,
      ...overrides
    },
    emit: (event) => events.push(event)
  })
  runtimes.push(runtime)
  return runtime
}

function invocationEvents(events: WorkflowRuntimeEvent[]): InvocationEvent[] {
  return events.filter((event): event is InvocationEvent => event.type === 'INVOKE_AGENT')
}

async function waitForInvocationCount(
  events: WorkflowRuntimeEvent[],
  count: number
): Promise<InvocationEvent[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const invocations = invocationEvents(events)
    if (invocations.length >= count) {
      return invocations
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error(`Timed out waiting for ${count} workflow invocations.`)
}

afterEach(() => {
  for (const runtime of runtimes.splice(0)) {
    runtime.dispose()
  }
})

describe('QuickJSWorkflowRuntime', () => {
  it('advances multiple deferred agents concurrently and preserves Promise.all order', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const runtime = await createRuntime(events)
    const completion = runtime.start(
      `
const results = await Promise.all([
  agent('slow prompt', { key: 'slow' }),
  agent('fast prompt', { key: 'fast' })
])
return results
`,
      null
    )

    const [slow, fast] = await waitForInvocationCount(events, 2)
    expect(slow.request.callPath).toBe('root/agent/slow')
    expect(fast.request.callPath).toBe('root/agent/fast')

    await runtime.settleInvocation(fast.requestId, {
      status: 'success',
      value: 'fast result'
    })
    expect(runtime.getPendingInvocationCount()).toBe(1)

    await runtime.settleInvocation(slow.requestId, {
      status: 'success',
      value: 'slow result'
    })

    await expect(completion).resolves.toEqual(['slow result', 'fast result'])
    expect(events.at(-1)).toMatchObject({
      type: 'COMPLETE',
      value: ['slow result', 'fast result']
    })
  })

  it('runs pipeline items without a stage barrier and keeps declared item order', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const runtime = await createRuntime(events)
    const completion = runtime.start(
      `
return await pipeline(
  'review',
  [
    { key: 'a', value: 'A' },
    { key: 'b', value: 'B' }
  ],
  [
    {
      key: 'inspect',
      run: (value, api) => api.agent('inspect ' + value, { key: 'worker' })
    },
    {
      key: 'verify',
      run: (value, api) => api.agent('verify ' + value, { key: 'worker' })
    }
  ]
)
`,
      null
    )

    const initial = await waitForInvocationCount(events, 2)
    const firstA = initial.find((event) => event.request.callPath.includes('/item/a/'))!
    const firstB = initial.find((event) => event.request.callPath.includes('/item/b/'))!

    await runtime.settleInvocation(firstB.requestId, {
      status: 'success',
      value: 'B-inspected'
    })
    const afterFastItem = await waitForInvocationCount(events, 3)
    const secondB = afterFastItem[2]
    expect(secondB.request.callPath).toBe('root/pipeline/review/item/b/stage/verify/agent/worker')

    await runtime.settleInvocation(secondB.requestId, {
      status: 'success',
      value: 'B-verified'
    })
    await runtime.settleInvocation(firstA.requestId, {
      status: 'success',
      value: 'A-inspected'
    })
    const allInvocations = await waitForInvocationCount(events, 4)
    const secondA = allInvocations[3]
    expect(secondA.request.callPath).toBe('root/pipeline/review/item/a/stage/verify/agent/worker')
    await runtime.settleInvocation(secondA.requestId, {
      status: 'success',
      value: 'A-verified'
    })

    await expect(completion).resolves.toEqual([
      { key: 'a', value: 'A-verified' },
      { key: 'b', value: 'B-verified' }
    ])
  })

  it('rejects all outstanding deferred promises on cancellation', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const runtime = await createRuntime(events)
    const completion = runtime.start(
      `
return await Promise.all([
  agent('one', { key: 'one' }),
  agent('two', { key: 'two' })
])
`,
      null
    )
    const observed = completion.then(
      () => null,
      (error: unknown) => error
    )

    await waitForInvocationCount(events, 2)
    await runtime.cancel('Cancelled by test.')

    expect(runtime.getPendingInvocationCount()).toBe(0)
    await expect(observed).resolves.toMatchObject({
      name: 'WORKFLOW_CANCELLED',
      message: 'Cancelled by test.'
    })
    expect(events.filter((event) => event.type === 'FAILED')).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({ code: 'WORKFLOW_CANCELLED' })
      })
    ])
  })

  it('removes timing and ambient host globals', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const runtime = await createRuntime(events)

    await expect(
      runtime.start(
        `
return {
  dateType: typeof Date,
  performanceType: typeof performance,
  raceType: typeof Promise.race,
  anyType: typeof Promise.any,
  processType: typeof process,
  requireType: typeof require
}
`,
        null
      )
    ).resolves.toEqual({
      anyType: 'undefined',
      dateType: 'undefined',
      performanceType: 'undefined',
      processType: 'undefined',
      raceType: 'undefined',
      requireType: 'undefined'
    })
  })

  it('protects host settlement from guest Promise and JSON mutation', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const runtime = await createRuntime(events)
    const completion = runtime.start(
      `
const nativePromise = (async () => null)().constructor
let promiseMutationBlocked = false
try {
  nativePromise.prototype.then = () => null
} catch {
  promiseMutationBlocked = true
}
JSON.parse = () => ({ poisoned: true })
const value = await agent('inspect', { key: 'inspect' })
return {
  jsonWasPoisoned: JSON.parse('{}').poisoned === true,
  promiseMutationBlocked,
  promisePrototypeFrozen: Object.isFrozen(nativePromise.prototype),
  value
}
`,
      null
    )

    const [invocation] = await waitForInvocationCount(events, 1)
    await runtime.settleInvocation(invocation.requestId, {
      status: 'success',
      value: { safe: true }
    })

    await expect(completion).resolves.toEqual({
      jsonWasPoisoned: true,
      promiseMutationBlocked: true,
      promisePrototypeFrozen: true,
      value: { safe: true }
    })
  })

  it('rejects the guest and drains jobs when settlement conversion fails', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const runtime = await createRuntime(events)
    const completion = runtime.start("return await agent('inspect', { key: 'inspect' })", null)
    const observed = completion.then(
      () => null,
      (error: unknown) => error
    )
    const [invocation] = await waitForInvocationCount(events, 1)

    await expect(
      runtime.settleInvocation(invocation.requestId, {
        status: 'success',
        value: undefined as never
      })
    ).resolves.toBe(true)

    expect(runtime.getPendingInvocationCount()).toBe(0)
    await expect(observed).resolves.toMatchObject({
      name: 'WORKFLOW_SETTLEMENT_FAILED'
    })
    expect(events.filter((event) => event.type === 'FAILED')).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({ code: 'WORKFLOW_SETTLEMENT_FAILED' })
      })
    ])
  })

  it('interrupts CPU-bound guest code within the configured burst', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const runtime = await createRuntime(events, { maxExecutionBurstMs: 20 })

    await expect(runtime.start('while (true) {}', null)).rejects.toThrow(/interrupt/i)
    expect(events.at(-1)).toMatchObject({
      type: 'FAILED'
    })
  })

  it('rejects duplicate logical call paths before a second invocation is emitted', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const runtime = await createRuntime(events)

    await expect(
      runtime.start(
        `
return await Promise.all([
  agent('first', { key: 'same' }),
  agent('second', { key: 'same' })
])
`,
        null
      )
    ).rejects.toThrow('Duplicate workflow call path')
    expect(invocationEvents(events)).toHaveLength(1)
  })

  it.each([
    ['direct promise construction', 'return await new Promise(() => {})', 'construction'],
    [
      'direct promise chaining',
      "return agent('one', { key: 'one' }).then((value) => value)",
      '.then()'
    ],
    ['dynamic eval', "return eval('1 + 1')", 'Dynamic eval'],
    ['injected global mutation', 'agent = null; return null', 'Mutation of injected global']
  ])('rejects unsupported source pattern: %s', async (_label, source, message) => {
    const events: WorkflowRuntimeEvent[] = []
    const runtime = await createRuntime(events)

    await expect(runtime.start(source, null)).rejects.toThrow(message)
    expect(events.at(-1)).toMatchObject({
      type: 'FAILED',
      error: {
        code: 'WORKFLOW_SOURCE_INVALID'
      }
    })
  })

  it('hides raw host callbacks and dynamic function constructors', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const runtime = await createRuntime(events)

    await expect(
      runtime.start(
        `
return {
  invokeType: typeof __deepchatWorkflowInvokeAgent,
  functionConstructorType: typeof (() => {}).constructor,
  asyncFunctionConstructorType: typeof (async () => {}).constructor
}
`,
        null
      )
    ).resolves.toEqual({
      asyncFunctionConstructorType: 'undefined',
      functionConstructorType: 'undefined',
      invokeType: 'undefined'
    })
  })

  it('validates malformed parallel entries before reading their keys', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const runtime = await createRuntime(events)

    await expect(runtime.start("return await parallel('bad', [null])", null)).rejects.toMatchObject(
      {
        name: 'WorkflowSourceError',
        message: 'parallel tasks must contain key and run.'
      }
    )
  })

  it('prevents phase options from replacing the scoped phase key', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const runtime = await createRuntime(events)

    await runtime.start(
      `
phase('inspect', { key: 'forged', label: 'Inspect', detail: { count: 1 } })
return null
`,
      null
    )

    expect(events.find((event) => event.type === 'PHASE')).toMatchObject({
      type: 'PHASE',
      key: 'root/phase/inspect',
      label: 'Inspect',
      detail: { count: 1 }
    })
  })

  it('reserves bounded log capacity for one explicit truncation marker', async () => {
    const events: WorkflowRuntimeEvent[] = []
    const runtime = await createRuntime(events, {
      maxLogEntries: 2,
      maxLogBytes: 1_024
    })

    await runtime.start(
      `
log({ index: 1 })
log({ index: 2 })
log({ index: 3 })
return null
`,
      null
    )

    expect(events.filter((event) => event.type === 'LOG')).toEqual([
      expect.objectContaining({ value: { index: 1 } }),
      expect.objectContaining({
        value: { reason: 'workflow_log_limit', truncated: true }
      })
    ])
  })
})
