import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync'
import {
  isFail,
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule
} from 'quickjs-emscripten-core'
import type { JsonValue } from '@shared/contracts/common'
import {
  WORKFLOW_RUNTIME_API_VERSION,
  WORKFLOW_RUNTIME_PROTOCOL_VERSION,
  WorkflowGuestAgentRequestSchema,
  WorkflowRuntimeLimitsSchema,
  createWorkflowRuntimeEvent,
  type WorkflowGuestAgentRequest,
  type WorkflowInvocationError,
  type WorkflowInvocationOutcome,
  type WorkflowRuntimeEvent,
  type WorkflowRuntimeLimits
} from '@shared/workflow/runtimeProtocol'
import { canonicalizeWorkflowJson, WorkflowJsonError } from '../domain/json'
import { validateWorkflowSource, WorkflowSourceValidationError } from './workflowSourceValidator'

const LOG_TRUNCATION_VALUE = {
  truncated: true,
  reason: 'workflow_log_limit'
} as const

const WORKFLOW_BOOTSTRAP_SOURCE = String.raw`
(() => {
  'use strict'

  const NativePromise = Promise
  const promiseAll = NativePromise.all.bind(NativePromise)
  const promiseAllSettled = NativePromise.allSettled.bind(NativePromise)
  const promiseResolve = NativePromise.resolve.bind(NativePromise)
  const promiseReject = NativePromise.reject.bind(NativePromise)
  const invokeAgentHost = __deepchatWorkflowInvokeAgent
  const phaseHost = __deepchatWorkflowPhase
  const logHost = __deepchatWorkflowLog
  delete globalThis.__deepchatWorkflowInvokeAgent
  delete globalThis.__deepchatWorkflowPhase
  delete globalThis.__deepchatWorkflowLog

  Object.freeze(NativePromise.prototype)
  Object.freeze(NativePromise)

  const fail = (message) => {
    const error = new Error(message)
    error.name = 'WorkflowSourceError'
    throw error
  }

  const keySegment = (value, label) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
      fail(label + ' must be a non-empty string no longer than 256 characters.')
    }
    if (/[\u0000-\u001f\u007f]/u.test(value)) {
      fail(label + ' cannot contain control characters.')
    }
    return encodeURIComponent(value)
  }

  const assertUniqueKeys = (values, label, validate) => {
    const keys = new Set()
    for (const value of values) {
      validate(value)
      const key = keySegment(value.key, label + ' key')
      if (keys.has(key)) {
        fail(label + ' contains duplicate key "' + value.key + '".')
      }
      keys.add(key)
    }
  }

  const createApi = (prefix) => {
    const agent = (prompt, options) => {
      if (!options || typeof options !== 'object' || Array.isArray(options)) {
        fail('agent options must be an object with a stable key.')
      }
      const key = keySegment(options.key, 'agent key')
      return invokeAgentHost({
        callPath: prefix + '/agent/' + key,
        prompt,
        options
      })
    }

    const parallel = (key, tasks) => {
      const scope = prefix + '/parallel/' + keySegment(key, 'parallel key')
      if (!Array.isArray(tasks)) {
        fail('parallel tasks must be an array.')
      }
      assertUniqueKeys(tasks, 'parallel task', (task) => {
        if (!task || typeof task !== 'object' || typeof task.run !== 'function') {
          fail('parallel tasks must contain key and run.')
        }
      })
      return promiseAll(
        tasks.map((task) => {
          const taskScope = scope + '/task/' + keySegment(task.key, 'parallel task key')
          return task.run(createApi(taskScope))
        })
      )
    }

    const pipeline = (key, items, stages) => {
      const scope = prefix + '/pipeline/' + keySegment(key, 'pipeline key')
      if (!Array.isArray(items) || !Array.isArray(stages)) {
        fail('pipeline items and stages must be arrays.')
      }
      assertUniqueKeys(items, 'pipeline item', (item) => {
        if (!item || typeof item !== 'object' || !('value' in item)) {
          fail('pipeline items must contain key and value.')
        }
      })
      assertUniqueKeys(stages, 'pipeline stage', (stage) => {
        if (!stage || typeof stage !== 'object' || typeof stage.run !== 'function') {
          fail('pipeline stages must contain key and run.')
        }
      })
      return promiseAll(
        items.map(async (item) => {
          const itemScope = scope + '/item/' + keySegment(item.key, 'pipeline item key')
          let value = item.value
          for (const stage of stages) {
            const stageScope =
              itemScope + '/stage/' + keySegment(stage.key, 'pipeline stage key')
            value = await stage.run(value, createApi(stageScope), item)
          }
          return { key: item.key, value }
        })
      )
    }

    const phase = (key, options = {}) => {
      if (!options || typeof options !== 'object' || Array.isArray(options)) {
        fail('phase options must be an object.')
      }
      return phaseHost({
        key: prefix + '/phase/' + keySegment(key, 'phase key'),
        ...(typeof options.label === 'string' ? { label: options.label } : {}),
        ...('detail' in options ? { detail: options.detail } : {})
      })
    }

    return Object.freeze({
      agent,
      parallel,
      pipeline,
      phase,
      log: logHost
    })
  }

  const rootApi = createApi('root')
  Object.defineProperties(globalThis, {
    agent: { value: rootApi.agent, writable: false, configurable: false },
    parallel: { value: rootApi.parallel, writable: false, configurable: false },
    pipeline: { value: rootApi.pipeline, writable: false, configurable: false },
    phase: { value: rootApi.phase, writable: false, configurable: false },
    log: { value: rootApi.log, writable: false, configurable: false },
    Promise: {
      value: Object.freeze({
        all: promiseAll,
        allSettled: promiseAllSettled,
        resolve: promiseResolve,
        reject: promiseReject
      }),
      writable: false,
      configurable: false
    },
    Date: { value: undefined, writable: false, configurable: false },
    performance: { value: undefined, writable: false, configurable: false },
    eval: { value: undefined, writable: false, configurable: false },
    Function: { value: undefined, writable: false, configurable: false }
  })

  Object.defineProperty(Math, 'random', {
    value: () => fail('Math.random is unavailable in workflow runtime API v1.'),
    writable: false,
    configurable: false
  })
  Object.freeze(Math)

  const functionPrototypes = [
    Object.getPrototypeOf(function () {}),
    Object.getPrototypeOf(async function () {}),
    Object.getPrototypeOf(function* () {}),
    Object.getPrototypeOf(async function* () {})
  ]
  for (const prototype of functionPrototypes) {
    Object.defineProperty(prototype, 'constructor', {
      value: undefined,
      writable: false,
      configurable: false
    })
  }
})()
`

let quickJSModulePromise: Promise<QuickJSWASMModule> | null = null

function loadQuickJSModule(): Promise<QuickJSWASMModule> {
  quickJSModulePromise ??= newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
  return quickJSModulePromise
}

export interface QuickJSWorkflowRuntimeOptions {
  runId: string
  limits: WorkflowRuntimeLimits
  emit: (event: WorkflowRuntimeEvent) => void
}

interface PendingInvocation {
  request: WorkflowGuestAgentRequest
  deferred: QuickJSDeferredPromise
}

type WithoutRuntimeEnvelope<Event> = Event extends unknown
  ? Omit<Event, 'protocolVersion' | 'runId'>
  : never

type WorkflowRuntimeEventPayload = WithoutRuntimeEnvelope<WorkflowRuntimeEvent>

export class QuickJSWorkflowRuntime {
  private readonly pendingInvocations = new Map<string, PendingInvocation>()
  private readonly seenCallPaths = new Set<string>()
  private vmQueue: Promise<void> = Promise.resolve()
  private rootPromiseHandle: QuickJSHandle | null = null
  private jsonParseHandle: QuickJSHandle | null = null
  private interruptDeadline = Number.POSITIVE_INFINITY
  private requestSequence = 0
  private invocationCount = 0
  private phaseUpdates = 0
  private logEntries = 0
  private logBytes = 0
  private logTruncationEmitted = false
  private started = false
  private cancelled = false
  private disposed = false

  private constructor(
    private readonly options: QuickJSWorkflowRuntimeOptions,
    private readonly runtime: QuickJSRuntime,
    private readonly context: QuickJSContext
  ) {}

  static async create(options: QuickJSWorkflowRuntimeOptions): Promise<QuickJSWorkflowRuntime> {
    const limits = WorkflowRuntimeLimitsSchema.parse(options.limits)
    const module = await loadQuickJSModule()
    const runtime = module.newRuntime({
      memoryLimitBytes: limits.memoryLimitBytes,
      maxStackSizeBytes: limits.maxStackSizeBytes,
      interruptHandler: () => false
    })
    const context = runtime.newContext()
    const instance = new QuickJSWorkflowRuntime({ ...options, limits }, runtime, context)
    runtime.setInterruptHandler(() => Date.now() >= instance.interruptDeadline)

    try {
      instance.installHostFunctions()
      instance.evaluateBootstrap()
      instance.captureHostIntrinsics()
      return instance
    } catch (error) {
      instance.dispose()
      throw error
    }
  }

  async start(source: string, input: JsonValue): Promise<JsonValue> {
    if (this.started) {
      throw new Error('Workflow runtime can only start once.')
    }
    this.assertAlive()
    this.started = true
    try {
      this.assertSourceWithinLimit(source)
      validateWorkflowSource(source)
      const canonicalInput = canonicalizeWorkflowJson(input, {
        maxBytes: this.options.limits.maxInputBytes
      })

      const inputHandle = this.context.newString(canonicalInput.json)
      try {
        this.context.setProp(this.context.global, '__deepchatWorkflowInputJson', inputHandle)
      } finally {
        inputHandle.dispose()
      }

      const wrappedSource = `
(async () => {
  'use strict'
  const input = JSON.parse(__deepchatWorkflowInputJson)
  delete globalThis.__deepchatWorkflowInputJson
  const result = await (async () => {
${source}
  })()
  return result === undefined ? null : result
})()
`

      let rootResolution: Promise<
        ReturnType<QuickJSContext['resolvePromise']> extends Promise<infer R> ? R : never
      >
      await this.enqueueVm(() => {
        this.withInterruptDeadline(() => {
          const evaluation = this.context.evalCode(wrappedSource, 'deepchat-workflow.js')
          if (isFail(evaluation)) {
            const error = this.readQuickJSError(evaluation.error)
            evaluation.dispose()
            throw error
          }
          this.rootPromiseHandle = evaluation.value
          rootResolution = this.context.resolvePromise(this.rootPromiseHandle)
        })
        this.drainPendingJobs()
      })

      const resolved = await rootResolution!
      const result = await this.enqueueVm(() => {
        if (isFail(resolved)) {
          try {
            throw this.readQuickJSError(resolved.error)
          } finally {
            resolved.dispose()
          }
        }
        try {
          const dumped = this.context.dump(resolved.value)
          return canonicalizeWorkflowJson(dumped, {
            maxBytes: this.options.limits.maxResultBytes
          }).value
        } finally {
          resolved.dispose()
        }
      })
      if (!this.cancelled) {
        this.emit({
          type: 'COMPLETE',
          value: result
        })
      }
      return result
    } catch (error) {
      if (!this.cancelled) {
        this.emit({
          type: 'FAILED',
          error: toWorkflowInvocationError(error, 'WORKFLOW_EXECUTION_FAILED')
        })
      }
      throw error
    } finally {
      const rootPromiseHandle = this.rootPromiseHandle
      this.rootPromiseHandle = null
      if (rootPromiseHandle && !this.disposed) {
        await this.enqueueVm(() => rootPromiseHandle.dispose())
      }
    }
  }

  async settleInvocation(
    requestId: string,
    outcome: WorkflowInvocationOutcome
  ): Promise<boolean> {
    this.assertAlive()
    return await this.enqueueVm(() => {
      const pending = this.pendingInvocations.get(requestId)
      if (!pending) {
        return false
      }
      this.pendingInvocations.delete(requestId)

      let fatalSettlementError: unknown = null
      try {
        this.applyInvocationOutcome(pending, outcome)
      } catch (error) {
        try {
          this.rejectDeferred(pending.deferred, {
            code: 'WORKFLOW_SETTLEMENT_FAILED',
            message:
              error instanceof Error ? error.message : 'Workflow invocation settlement failed.',
            retriable: false
          })
        } catch (rejectError) {
          fatalSettlementError = combineErrors(
            error,
            rejectError,
            'Workflow settlement and fallback rejection both failed.'
          )
        }
      } finally {
        try {
          pending.deferred.dispose()
        } catch (disposeError) {
          fatalSettlementError = combineErrors(
            fatalSettlementError,
            disposeError,
            'Workflow deferred disposal failed.'
          )
        }
        try {
          this.drainPendingJobs()
        } catch (drainError) {
          fatalSettlementError = combineErrors(
            fatalSettlementError,
            drainError,
            'Workflow settlement pending-job drain failed.'
          )
        }
      }

      if (fatalSettlementError) {
        throw fatalSettlementError
      }
      return true
    })
  }

  async cancel(reason: string): Promise<void> {
    if (this.disposed || this.cancelled) {
      return
    }
    this.cancelled = true
    try {
      await this.enqueueVm(() => {
        let cancellationError: unknown = null
        for (const pending of this.pendingInvocations.values()) {
          try {
            this.rejectDeferred(pending.deferred, {
              code: 'WORKFLOW_CANCELLED',
              message: reason,
              retriable: false
            })
          } catch (error) {
            cancellationError = combineErrors(
              cancellationError,
              error,
              'One or more workflow promises could not be cancelled.'
            )
          }
          try {
            pending.deferred.dispose()
          } catch (error) {
            cancellationError = combineErrors(
              cancellationError,
              error,
              'One or more cancelled workflow promises could not be disposed.'
            )
          }
        }
        this.pendingInvocations.clear()
        try {
          this.drainPendingJobs()
        } catch (error) {
          cancellationError = combineErrors(
            cancellationError,
            error,
            'Workflow cancellation pending-job drain failed.'
          )
        }
        if (cancellationError) {
          throw cancellationError
        }
      })
    } catch {
      // Cancellation is terminal even if hostile guest cleanup exhausts the VM job budget.
    } finally {
      this.emit({
        type: 'FAILED',
        error: {
          code: 'WORKFLOW_CANCELLED',
          message: clampString(reason, 8_192, 'Workflow was cancelled.'),
          retriable: false
        }
      })
    }
  }

  getPendingInvocationCount(): number {
    return this.pendingInvocations.size
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const pending of this.pendingInvocations.values()) {
      pending.deferred.dispose()
    }
    this.pendingInvocations.clear()
    this.rootPromiseHandle?.dispose()
    this.rootPromiseHandle = null
    this.jsonParseHandle?.dispose()
    this.jsonParseHandle = null
    if (this.context.alive) {
      this.context.dispose()
    }
    if (this.runtime.alive) {
      this.runtime.dispose()
    }
  }

  private installHostFunctions(): void {
    this.installFunction('__deepchatWorkflowInvokeAgent', (requestHandle) => {
      const canonicalRequest = canonicalizeWorkflowJson(this.context.dump(requestHandle), {
        maxBytes: this.options.limits.maxInputBytes
      })
      const request = WorkflowGuestAgentRequestSchema.parse(canonicalRequest.value)
      if (this.invocationCount >= this.options.limits.maxInvocations) {
        throw new Error(`Workflow invocation limit exceeded (${this.options.limits.maxInvocations}).`)
      }
      if (this.pendingInvocations.size >= this.options.limits.maxPendingInvocations) {
        throw new Error(
          `Workflow pending invocation limit exceeded (${this.options.limits.maxPendingInvocations}).`
        )
      }
      if (this.seenCallPaths.has(request.callPath)) {
        throw new Error(`Duplicate workflow call path in this execution: ${request.callPath}`)
      }

      this.seenCallPaths.add(request.callPath)
      this.invocationCount += 1
      const requestId = `${this.options.runId}:${++this.requestSequence}`
      const deferred = this.context.newPromise()
      this.pendingInvocations.set(requestId, { request, deferred })
      try {
        this.emit({
          type: 'INVOKE_AGENT',
          requestId,
          request
        })
      } catch (error) {
        this.pendingInvocations.delete(requestId)
        deferred.dispose()
        throw error
      }
      return deferred.handle
    })

    this.installFunction('__deepchatWorkflowPhase', (valueHandle) => {
      if (this.phaseUpdates >= this.options.limits.maxPhaseUpdates) {
        throw new Error(
          `Workflow phase update limit exceeded (${this.options.limits.maxPhaseUpdates}).`
        )
      }
      const value = this.context.dump(valueHandle)
      const phase = canonicalizeWorkflowJson(value, { maxBytes: 64 * 1024 }).value
      if (!isJsonObject(phase) || typeof phase.key !== 'string') {
        throw new Error('phase payload must contain a string key.')
      }
      this.phaseUpdates += 1
      this.emit({
        type: 'PHASE',
        key: phase.key,
        ...(typeof phase.label === 'string' ? { label: phase.label } : {}),
        ...('detail' in phase ? { detail: phase.detail } : {})
      })
      return this.context.undefined
    })

    this.installFunction('__deepchatWorkflowLog', (valueHandle) => {
      if (
        this.options.limits.maxLogEntries === 0 ||
        this.options.limits.maxLogBytes === 0
      ) {
        return this.context.undefined
      }
      let canonical: ReturnType<typeof canonicalizeWorkflowJson>
      try {
        canonical = canonicalizeWorkflowJson(this.context.dump(valueHandle), {
          maxBytes: this.options.limits.maxLogBytes
        })
      } catch (error) {
        if (error instanceof WorkflowJsonError && error.code === 'LIMIT_EXCEEDED') {
          this.emitLogTruncation()
          return this.context.undefined
        }
        throw error
      }
      const truncationByteLength = Buffer.byteLength(JSON.stringify(LOG_TRUNCATION_VALUE), 'utf8')
      const availableEntries = Math.max(this.options.limits.maxLogEntries - 1, 0)
      const availableBytes = Math.max(this.options.limits.maxLogBytes - truncationByteLength, 0)
      if (
        this.logEntries >= availableEntries ||
        this.logBytes + canonical.byteLength > availableBytes
      ) {
        this.emitLogTruncation()
        return this.context.undefined
      }
      this.logEntries += 1
      this.logBytes += canonical.byteLength
      this.emit({
        type: 'LOG',
        value: canonical.value
      })
      return this.context.undefined
    })
  }

  private installFunction(
    name: string,
    callback: (...args: QuickJSHandle[]) => QuickJSHandle | void
  ): void {
    const functionHandle = this.context.newFunction(name, callback)
    try {
      this.context.setProp(this.context.global, name, functionHandle)
    } finally {
      functionHandle.dispose()
    }
  }

  private evaluateBootstrap(): void {
    this.withInterruptDeadline(() => {
      const result = this.context.evalCode(WORKFLOW_BOOTSTRAP_SOURCE, 'deepchat-workflow-bootstrap.js')
      if (isFail(result)) {
        const error = this.readQuickJSError(result.error)
        result.dispose()
        throw error
      }
      result.dispose()
    })
  }

  private captureHostIntrinsics(): void {
    const jsonObject = this.context.getProp(this.context.global, 'JSON')
    try {
      const parseHandle = this.context.getProp(jsonObject, 'parse')
      if (this.context.typeof(parseHandle) !== 'function') {
        parseHandle.dispose()
        throw new Error('QuickJS JSON.parse intrinsic is unavailable.')
      }
      this.jsonParseHandle = parseHandle
    } finally {
      jsonObject.dispose()
    }
  }

  private drainPendingJobs(): void {
    this.withInterruptDeadline(() => {
      const result = this.runtime.executePendingJobs(
        this.options.limits.maxPendingJobsPerDrain
      )
      if (isFail(result)) {
        const error = this.readQuickJSError(result.error)
        result.dispose()
        throw error
      }
      result.dispose()
      if (this.runtime.hasPendingJob()) {
        throw new Error(
          `Workflow pending job drain exceeded ${this.options.limits.maxPendingJobsPerDrain} jobs.`
        )
      }
    })
  }

  private jsonToHandle(json: string): QuickJSHandle {
    const parseFunction = this.jsonParseHandle
    if (!parseFunction?.alive) {
      throw new Error('QuickJS JSON.parse intrinsic is unavailable.')
    }
    const stringHandle = this.context.newString(json)
    try {
      return this.context.unwrapResult(
        this.context.callFunction(parseFunction, this.context.undefined, stringHandle)
      )
    } finally {
      stringHandle.dispose()
    }
  }

  private applyInvocationOutcome(
    pending: PendingInvocation,
    outcome: WorkflowInvocationOutcome
  ): void {
    if (outcome.status === 'error') {
      this.rejectDeferred(pending.deferred, outcome.error)
      return
    }

    const maxBytes = Math.min(
      pending.request.options.maxOutputBytes ?? this.options.limits.maxResultBytes,
      this.options.limits.maxResultBytes
    )
    const canonical = canonicalizeWorkflowJson(outcome.value, { maxBytes })
    const valueHandle = this.jsonToHandle(canonical.json)
    try {
      pending.deferred.resolve(valueHandle)
    } finally {
      valueHandle.dispose()
    }
  }

  private rejectDeferred(
    deferred: QuickJSDeferredPromise,
    error: WorkflowInvocationError
  ): void {
    const errorHandle = this.context.newError({
      name: error.code,
      message: clampString(error.message, 8_192, 'Workflow invocation failed.')
    })
    try {
      deferred.reject(errorHandle)
    } finally {
      errorHandle.dispose()
    }
  }

  private emit(event: WorkflowRuntimeEventPayload): void {
    this.options.emit(
      createWorkflowRuntimeEvent({
        ...event,
        protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
        runId: this.options.runId
      } as WorkflowRuntimeEvent)
    )
  }

  private emitLogTruncation(): void {
    if (
      this.logTruncationEmitted ||
      this.logEntries >= this.options.limits.maxLogEntries
    ) {
      return
    }
    let canonical: ReturnType<typeof canonicalizeWorkflowJson>
    try {
      canonical = canonicalizeWorkflowJson(LOG_TRUNCATION_VALUE, {
        maxBytes: this.options.limits.maxLogBytes
      })
    } catch (error) {
      if (error instanceof WorkflowJsonError && error.code === 'LIMIT_EXCEEDED') {
        this.logTruncationEmitted = true
        return
      }
      throw error
    }
    this.logTruncationEmitted = true
    this.logEntries += 1
    this.logBytes += canonical.byteLength
    this.emit({
      type: 'LOG',
      value: canonical.value
    })
  }

  private withInterruptDeadline<T>(operation: () => T): T {
    this.interruptDeadline = Date.now() + this.options.limits.maxExecutionBurstMs
    try {
      return operation()
    } finally {
      this.interruptDeadline = Number.POSITIVE_INFINITY
    }
  }

  private enqueueVm<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.vmQueue.then(operation, operation)
    this.vmQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private readQuickJSError(handle: QuickJSHandle): Error {
    const dumped = this.context.dump(handle)
    if (isJsonObject(dumped)) {
      const error = new Error(
        typeof dumped.message === 'string' ? dumped.message : 'QuickJS workflow execution failed.'
      )
      error.name = typeof dumped.name === 'string' ? dumped.name : 'QuickJSWorkflowError'
      if (typeof dumped.stack === 'string') {
        error.stack = dumped.stack
      }
      return error
    }
    return new Error(String(dumped))
  }

  private assertSourceWithinLimit(source: string): void {
    const byteLength = Buffer.byteLength(source, 'utf8')
    if (byteLength === 0) {
      throw new Error('Workflow source cannot be empty.')
    }
    if (byteLength > this.options.limits.maxScriptBytes) {
      throw new Error(
        `Workflow source exceeds the ${this.options.limits.maxScriptBytes}-byte limit.`
      )
    }
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new Error('Workflow runtime is disposed.')
    }
  }
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toWorkflowInvocationError(error: unknown, fallbackCode: string): WorkflowInvocationError {
  if (error instanceof WorkflowSourceValidationError) {
    return {
      code: 'WORKFLOW_SOURCE_INVALID',
      message: clampString(error.message, 8_192, 'Workflow source is invalid.'),
      retriable: false
    }
  }
  if (error instanceof WorkflowJsonError) {
    return {
      code: 'WORKFLOW_JSON_INVALID',
      message: error.message,
      retriable: false
    }
  }
  if (error instanceof Error) {
    return {
      code: clampString(
        error.name && error.name !== 'Error' ? error.name : fallbackCode,
        128,
        fallbackCode
      ),
      message: clampString(error.message, 8_192, 'Workflow execution failed.'),
      retriable: false
    }
  }
  return {
    code: fallbackCode,
    message: clampString(String(error), 8_192, 'Workflow execution failed.'),
    retriable: false
  }
}

function clampString(value: string, maxLength: number, fallback: string): string {
  if (!value) {
    return fallback
  }
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function combineErrors(current: unknown, next: unknown, message: string): unknown {
  if (!current) {
    return next
  }
  return new AggregateError([current, next], message)
}

export function workflowRuntimeReadyEvent(runId: string): WorkflowRuntimeEvent {
  return createWorkflowRuntimeEvent({
    type: 'READY',
    protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
    runId,
    pid: process.pid
  })
}

export const WORKFLOW_GUEST_RUNTIME_API_VERSION = WORKFLOW_RUNTIME_API_VERSION
