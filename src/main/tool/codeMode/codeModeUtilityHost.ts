import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'
import {
  RUN_CODE_MAX_NESTED_CALLS,
  RUN_CODE_MAX_NESTED_CONCURRENCY,
  RUN_CODE_OUTPUT_MAX_BYTES,
  RUN_CODE_PROTOCOL_VERSION,
  RUN_CODE_SOURCE_MAX_BYTES,
  type RunCodeHostMessage,
  type RunCodeParentMessage,
  type RunCodeToolBinding
} from '@shared/codeModeProtocol'

type ParentPort = {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
  start?(): void
}

type PendingCall = {
  toolName: string
  resolve(value: unknown): void
  reject(error: Error): void
}

class ToolCallError extends Error {
  readonly toolName: string

  constructor(toolName: string, message: string) {
    super(message)
    this.name = 'ToolCallError'
    this.toolName = toolName
  }
}

const HOST_ARG = '--deepchat-code-mode-host'

export interface CodeModeContextBridge {
  invoke(bindingId: string, args: unknown): Promise<string>
  append(serializedValue: string): void
  setTimer(callback: () => void, delay: number): number
  clearTimer(timerId: number): void
  yield(): Promise<void>
}

export interface CodeModeContextRuntime {
  context: vm.Context
  isExit(error: unknown): boolean
  serializeStore(): string
  serializeValue(value: unknown): string
}

const CONTEXT_RUNTIME_FACTORY_SOURCE = String.raw`
((bridge, bindingsJson, initialStoreJson, frontend) => {
  'use strict'

  class ToolCallError extends Error {
    constructor(toolName, message) {
      super(message)
      this.name = 'ToolCallError'
      this.toolName = toolName
    }
  }

  const bindings = JSON.parse(bindingsJson)
  const storeValues = JSON.parse(initialStoreJson)
  const store = new Map(Object.entries(storeValues))
  const exitSignal = Object.freeze(Object.create(null))
  const tools = Object.create(null)

  const cloneJson = (value) => {
    if (value === undefined) return null
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new TypeError('Value is not JSON serializable.')
    return JSON.parse(serialized)
  }

  const append = (value) => bridge.append(JSON.stringify(value))
  const renderText = (value) => {
    if (typeof value === 'string') return value
    if (
      value === undefined ||
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    ) {
      return String(value)
    }
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  for (const binding of bindings) {
    const callTool = async (args = {}) => {
      const envelope = JSON.parse(await bridge.invoke(binding.id, args))
      if (!envelope.ok) {
        throw new ToolCallError(binding.name, envelope.error || 'Nested tool call failed.')
      }
      return envelope.hasValue ? envelope.value : undefined
    }
    Object.freeze(callTool)
    Object.defineProperty(tools, binding.name, {
      value: callTool,
      enumerable: true,
      configurable: false,
      writable: false
    })
  }
  Object.freeze(tools)

  const consoleShim = Object.create(null)
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    Object.defineProperty(consoleShim, level, {
      value: (...args) => append(args.map(renderText).join(' ')),
      enumerable: true,
      configurable: false,
      writable: false
    })
  }
  Object.freeze(consoleShim)

  const globals = Object.create(null)
  Object.assign(globals, {
    tools,
    process: undefined,
    require: undefined,
    Buffer: undefined,
    console: frontend === 'function' ? consoleShim : undefined
  })

  if (frontend === 'function') {
    globals.ToolCallError = ToolCallError
  } else {
    Object.assign(globals, {
      ALL_TOOLS: Object.freeze(
        bindings.map(({ name, description }) => Object.freeze({ name, description }))
      ),
      exit: () => {
        throw exitSignal
      },
      text: (value) => append({ type: 'text', text: renderText(value) }),
      image: (value) => append({ type: 'image', value }),
      audio: (value) => append({ type: 'audio', value }),
      generatedImage: (value) => append({ type: 'generated_image', value }),
      notify: (value) => append({ type: 'notification', value }),
      store: (key, value) => {
        if (typeof key !== 'string' || !key || key.length > 256) {
          throw new Error('store key must be a non-empty string up to 256 characters.')
        }
        store.set(key, cloneJson(value))
      },
      load: (key) => store.get(key),
      setTimeout: (callback, delay = 0) => {
        if (typeof callback !== 'function') {
          throw new TypeError('setTimeout callback must be a function.')
        }
        return bridge.setTimer(callback, delay)
      },
      clearTimeout: (timerId) => bridge.clearTimer(timerId),
      yield_control: async () => await bridge.yield()
    })
  }
  Object.freeze(globals)

  return Object.freeze({
    globals,
    isExit: (error) => error === exitSignal,
    serializeStore: () => JSON.stringify(Object.fromEntries(store)),
    serializeValue: (value) =>
      JSON.stringify({
        hasValue: value !== undefined,
        ...(value === undefined ? {} : { value: cloneJson(value) })
      })
  })
})
`

function getParentPort(): ParentPort {
  const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
  if (!parentPort) throw new Error('Code mode utility host started without a parent port.')
  return parentPort
}

function unwrapMessage(message: unknown): unknown {
  if (message && typeof message === 'object' && 'data' in message) {
    return (message as { data?: unknown }).data
  }
  return message
}

function isParentMessage(value: unknown): value is RunCodeParentMessage {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'version' in value &&
    (value as { version?: unknown }).version === RUN_CODE_PROTOCOL_VERSION
  )
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error)
}

function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return RUN_CODE_OUTPUT_MAX_BYTES + 1
  }
}

function cloneForIpc(value: unknown): unknown {
  if (value === undefined) return null
  return structuredClone(value)
}

function snapshotJsonValue(value: unknown, location = 'value'): unknown {
  const seen = new WeakSet<object>()
  const visit = (candidate: unknown, path: string): unknown => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') {
      return candidate
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new Error(`${path} contains a non-finite number.`)
      return candidate
    }
    if (typeof candidate !== 'object') {
      throw new Error(`${path} is not lossless JSON.`)
    }
    if (seen.has(candidate)) throw new Error(`${path} contains a cycle.`)
    seen.add(candidate)
    if (Array.isArray(candidate)) {
      const result = candidate.map((item, index) => visit(item, `${path}[${index}]`))
      seen.delete(candidate)
      return result
    }
    if (Object.prototype.toString.call(candidate) !== '[object Object]') {
      throw new Error(`${path} contains a non-JSON object.`)
    }
    const result: Record<string, unknown> = Object.create(null)
    for (const [key, item] of Object.entries(candidate)) {
      result[key] = visit(item, `${path}.${key}`)
    }
    seen.delete(candidate)
    return result
  }
  return visit(value, location)
}

function compileSource(source: string, frontend: 'codex' | 'function'): string {
  const wrapped = `(async () => {\n${source}\n})()`
  if (frontend === 'codex') return wrapped
  return stripTypeScriptTypes(wrapped, { mode: 'strip' })
}

type ContextRuntimeFactoryResult = {
  globals: Record<string, unknown>
  isExit(error: unknown): boolean
  serializeStore(): string
  serializeValue(value: unknown): string
}

export function createCodeModeRuntimeContext(
  input: {
    name: string
    frontend: 'codex' | 'function'
    bindings: RunCodeToolBinding[]
    store: Record<string, unknown>
  },
  bridge: CodeModeContextBridge
): CodeModeContextRuntime {
  const context = vm.createContext(Object.create(null), {
    name: input.name,
    codeGeneration: { strings: false, wasm: false }
  })
  const factory = new vm.Script(CONTEXT_RUNTIME_FACTORY_SOURCE, {
    filename: 'deepchat-code-mode-runtime.js'
  }).runInContext(context) as (
    bridge: CodeModeContextBridge,
    bindingsJson: string,
    initialStoreJson: string,
    frontend: 'codex' | 'function'
  ) => ContextRuntimeFactoryResult
  const runtime = factory(
    Object.freeze(bridge),
    JSON.stringify(input.bindings),
    JSON.stringify(input.store),
    input.frontend
  )
  Object.assign(context, runtime.globals)
  return {
    context,
    isExit: runtime.isExit,
    serializeStore: runtime.serializeStore,
    serializeValue: runtime.serializeValue
  }
}

export function runCodeModeUtilityHost(): void {
  if (process.env.DEEPCHAT_CODE_MODE_HOST !== '1' && !process.argv.includes(HOST_ARG)) {
    return
  }

  const parentPort = getParentPort()
  const pendingCalls = new Map<string, PendingCall>()
  const timers = new Set<NodeJS.Timeout>()
  let currentCellId: string | null = null
  let stopped = false
  let nestedCallCount = 0
  let nestedCallSequence = 0
  let activeNestedCalls = 0
  let outputBytes = 0
  let resumeYield: (() => void) | null = null
  let currentOutput: unknown[] = []

  const post = (message: RunCodeHostMessage): void => {
    if (!stopped) parentPort.postMessage(message)
  }

  const stop = (reason: string): void => {
    if (stopped) return
    stopped = true
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    for (const pending of pendingCalls.values()) pending.reject(new Error(reason))
    pendingCalls.clear()
    resumeYield?.()
    resumeYield = null
    setImmediate(() => process.exit(0))
  }

  const appendOutput = (output: unknown[], value: unknown): void => {
    const cloned = cloneForIpc(value)
    outputBytes += byteLength(cloned)
    if (outputBytes > RUN_CODE_OUTPUT_MAX_BYTES) {
      throw new Error('Code mode output exceeded the 1 MiB limit.')
    }
    output.push(cloned)
  }

  const execute = async (message: Extract<RunCodeParentMessage, { type: 'START' }>) => {
    if (currentCellId) throw new Error('Code mode utility host accepts one cell only.')
    if (Buffer.byteLength(message.source, 'utf8') > RUN_CODE_SOURCE_MAX_BYTES) {
      throw new Error('Code mode source exceeded the 256 KiB limit.')
    }

    currentCellId = message.cellId
    const output: unknown[] = []
    currentOutput = output
    const dispatch = async (binding: RunCodeToolBinding, args: unknown): Promise<unknown> => {
      if (stopped) throw new Error('Code cell has stopped.')
      if (nestedCallCount >= RUN_CODE_MAX_NESTED_CALLS) {
        throw new Error(`Code cell exceeded ${RUN_CODE_MAX_NESTED_CALLS} nested tool calls.`)
      }
      if (activeNestedCalls >= RUN_CODE_MAX_NESTED_CONCURRENCY) {
        throw new Error(
          `Code cell exceeded ${RUN_CODE_MAX_NESTED_CONCURRENCY} concurrent nested tool calls.`
        )
      }

      nestedCallCount += 1
      activeNestedCalls += 1
      const callId = `${message.cellId}:${++nestedCallSequence}`
      try {
        return await new Promise<unknown>((resolve, reject) => {
          pendingCalls.set(callId, { toolName: binding.name, resolve, reject })
          post({
            type: 'NESTED_CALL',
            version: RUN_CODE_PROTOCOL_VERSION,
            cellId: message.cellId,
            callId,
            bindingId: binding.id,
            arguments: snapshotJsonValue(args, 'tool arguments')
          })
        })
      } finally {
        pendingCalls.delete(callId)
        activeNestedCalls -= 1
      }
    }
    let sequentialBarrier = Promise.resolve()
    const parallelCalls = new Set<Promise<unknown>>()
    const invoke = (binding: RunCodeToolBinding, args: unknown): Promise<unknown> => {
      if (binding.execution === 'parallel') {
        const call = sequentialBarrier.then(() => dispatch(binding, args))
        parallelCalls.add(call)
        void call.then(
          () => parallelCalls.delete(call),
          () => parallelCalls.delete(call)
        )
        return call
      }

      const precedingParallelCalls = [...parallelCalls]
      const call = sequentialBarrier.then(async () => {
        await Promise.allSettled(precedingParallelCalls)
        return await dispatch(binding, args)
      })
      sequentialBarrier = call.then(
        () => undefined,
        () => undefined
      )
      return call
    }

    const bindingsById = new Map(message.bindings.map((binding) => [binding.id, binding]))
    const modelTimers = new Map<number, NodeJS.Timeout>()
    let timerSequence = 0
    let rejectTimerFailure!: (reason?: unknown) => void
    let timerFailureSettled = false
    const timerFailure = new Promise<never>((_, reject) => {
      rejectTimerFailure = reject
    })
    const runtime = createCodeModeRuntimeContext(
      {
        name: `deepchat-code-cell-${message.cellId}`,
        frontend: message.frontend,
        bindings: message.bindings,
        store: message.store
      },
      {
        invoke: async (bindingId, args) => {
          const binding = bindingsById.get(bindingId)
          if (!binding) {
            return JSON.stringify({ ok: false, error: 'Unknown Code Mode tool binding.' })
          }
          try {
            const value = await invoke(binding, args)
            const serialized = JSON.stringify({
              ok: true,
              hasValue: value !== undefined,
              ...(value === undefined ? {} : { value: snapshotJsonValue(value, 'tool result') })
            })
            if (Buffer.byteLength(serialized, 'utf8') > RUN_CODE_OUTPUT_MAX_BYTES) {
              throw new Error('Nested tool result exceeded the 1 MiB limit.')
            }
            return serialized
          } catch (error) {
            return JSON.stringify({ ok: false, error: errorText(error).slice(0, 16_384) })
          }
        },
        append: (serializedValue) => appendOutput(output, JSON.parse(serializedValue)),
        setTimer: (callback, delay) => {
          const timerId = ++timerSequence
          const boundedDelay =
            typeof delay === 'number' && Number.isFinite(delay)
              ? Math.max(0, Math.min(delay, 60_000))
              : 0
          const timer = setTimeout(() => {
            timers.delete(timer)
            modelTimers.delete(timerId)
            try {
              callback()
            } catch (error) {
              if (!timerFailureSettled) {
                timerFailureSettled = true
                rejectTimerFailure(error)
              }
            }
          }, boundedDelay)
          timers.add(timer)
          modelTimers.set(timerId, timer)
          return timerId
        },
        clearTimer: (timerId) => {
          const timer = modelTimers.get(timerId)
          if (!timer) return
          clearTimeout(timer)
          timers.delete(timer)
          modelTimers.delete(timerId)
        },
        yield: async () => {
          if (resumeYield) {
            throw new Error('yield_control already has a pending resume.')
          }
          post({
            type: 'YIELDED',
            version: RUN_CODE_PROTOCOL_VERSION,
            cellId: message.cellId,
            output: cloneForIpc(output) as unknown[]
          })
          await new Promise<void>((resolve) => {
            resumeYield = resolve
          })
          resumeYield = null
        }
      }
    )

    const compiled = compileSource(message.source, message.frontend)
    const script = new vm.Script(compiled, {
      filename: `deepchat-code-cell-${message.cellId}.js`
    })
    let returnValue: unknown
    try {
      returnValue = await Promise.race([
        script.runInContext(runtime.context, { timeout: 2_000 }),
        timerFailure
      ])
    } catch (error) {
      if (!runtime.isExit(error)) throw error
    } finally {
      for (const timer of modelTimers.values()) {
        clearTimeout(timer)
        timers.delete(timer)
      }
      modelTimers.clear()
    }
    const serializedStore = snapshotJsonValue(
      JSON.parse(runtime.serializeStore()),
      'code mode store'
    ) as Record<string, unknown>
    if (byteLength(serializedStore) > RUN_CODE_OUTPUT_MAX_BYTES) {
      throw new Error('Code mode store exceeded the 1 MiB limit.')
    }
    const completionEnvelope = JSON.parse(runtime.serializeValue(returnValue)) as {
      hasValue: boolean
      value?: unknown
    }
    post({
      type: 'RESULT',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: message.cellId,
      output,
      ...(completionEnvelope.hasValue ? { returnValue: completionEnvelope.value } : {}),
      store: serializedStore
    })
  }

  parentPort.start?.()
  parentPort.on('message', (rawMessage) => {
    const message = unwrapMessage(rawMessage)
    if (!isParentMessage(message)) return

    if (message.type === 'START') {
      void execute(message).catch((error) => {
        post({
          type: 'ERROR',
          version: RUN_CODE_PROTOCOL_VERSION,
          cellId: message.cellId,
          error: errorText(error),
          output: cloneForIpc(currentOutput) as unknown[]
        })
      })
      return
    }

    if (message.type === 'STOP') {
      stop(message.reason)
      return
    }
    if (message.cellId !== currentCellId) return

    if (message.type === 'RESUME') {
      resumeYield?.()
      return
    }
    if (message.type === 'NESTED_RESULT') {
      const pending = pendingCalls.get(message.callId)
      if (!pending) return
      if (message.ok) pending.resolve(message.result)
      else {
        pending.reject(
          new ToolCallError(pending.toolName, message.error || 'Nested tool call failed.')
        )
      }
    }
  })

  const heartbeat = setInterval(() => {
    post({
      type: 'HEARTBEAT',
      version: RUN_CODE_PROTOCOL_VERSION,
      ...(currentCellId ? { cellId: currentCellId } : {}),
      now: Date.now()
    })
  }, 1_000)
  timers.add(heartbeat)

  post({
    type: 'READY',
    version: RUN_CODE_PROTOCOL_VERSION,
    pid: process.pid
  })
}
