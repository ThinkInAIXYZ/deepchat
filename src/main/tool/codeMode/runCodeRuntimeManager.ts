import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { UtilityProcess } from 'electron'
import type { MCPToolDefinition, MCPToolResponse, ToolDispatchCommitInput } from '@shared/types/mcp'
import type { ToolCallOptions } from '@shared/types/tool'
import {
  RUN_CODE_MAX_NESTED_CALLS,
  RUN_CODE_PROTOCOL_VERSION,
  RUN_CODE_SOURCE_MAX_BYTES,
  type RunCodeFrontend,
  type RunCodeHostMessage,
  type RunCodeParentMessage,
  type RunCodeToolBinding
} from '@shared/codeModeProtocol'
import { buildCanonicalToolCatalog } from '@/agent/deepchat/runtime/toolSurface'
import { MAX_EXECUTION_JOURNAL_NESTED_CHILDREN } from '@/tape/domain/executionJournal'
import { normalizeCodexToolName } from './toolModeTools'

type CodeModeUtilityProcess = Pick<UtilityProcess, 'postMessage' | 'kill' | 'pid'> & {
  on(event: 'message', listener: (message: unknown) => void): CodeModeUtilityProcess
  on(event: 'exit', listener: (code: number) => void): CodeModeUtilityProcess
  on(event: 'error', listener: (type: string, location: string) => void): CodeModeUtilityProcess
  off(event: 'message', listener: (message: unknown) => void): CodeModeUtilityProcess
  off(event: 'exit', listener: (code: number) => void): CodeModeUtilityProcess
  off(event: 'error', listener: (type: string, location: string) => void): CodeModeUtilityProcess
}

export interface RunCodeNestedExecutionInput {
  sessionId: string
  runId?: string
  callId: string
  definition: MCPToolDefinition
  arguments: unknown
  options: ToolCallOptions
}

export interface RunCodeRuntimeManagerOptions {
  executeNested(
    input: RunCodeNestedExecutionInput
  ): Promise<{ content: unknown; rawData: MCPToolResponse }>
  spawnHost?: () => Promise<CodeModeUtilityProcess>
}

export interface RunCodeExecutionInput {
  sessionId: string
  runId?: string
  toolCallId: string
  frontend: RunCodeFrontend
  source: string
  yieldTimeMs?: number
  maxOutputTokens?: number
  executionCatalog: readonly MCPToolDefinition[]
  outerDispatch: ToolDispatchCommitInput
  options: ToolCallOptions
}

export interface RunCodeWaitInput {
  sessionId: string
  cellId: string
  toolCallId: string
  yieldTimeMs: number
  maxTokens: number
  terminate: boolean
  outerDispatch: ToolDispatchCommitInput
  options: ToolCallOptions
}

export interface RunCodeExecutionResult {
  content: string
  rawData?: MCPToolResponse
}

type CellState = 'starting' | 'running' | 'yielded' | 'permission' | 'stopping'

type DeferredResult = {
  promise: Promise<RunCodeExecutionResult>
  resolve(value: RunCodeExecutionResult): void
  reject(error: Error): void
}

type PendingPermissionCall = {
  hostCallId: string
  binding: RunCodeToolBinding
  arguments: unknown
  response: { content: unknown; rawData: MCPToolResponse }
}

type NestedCallState = {
  hostCallId: string
  outerToolCallId: string
  childOrdinal: number
  definitionHash: string
  dispatchCommitted: boolean
  outcomeCommitted: boolean
}

type HostSettlementMessage = Extract<RunCodeHostMessage, { type: 'YIELDED' | 'RESULT' | 'ERROR' }>

type ActiveCell = {
  id: string
  sessionId: string
  runId?: string
  outerToolCallId: string
  frontend: RunCodeFrontend
  host: CodeModeUtilityProcess
  state: CellState
  bindings: Map<
    string,
    { binding: RunCodeToolBinding; definition: MCPToolDefinition; definitionHash: string }
  >
  capabilityHash: string
  nestedCalls: Map<string, NestedCallState>
  nestedCallsInFlight: number
  nextChildOrdinal: number
  pendingNestedMessages: Array<Extract<RunCodeHostMessage, { type: 'NESTED_CALL' }>>
  pendingHostSettlement: HostSettlementMessage | null
  options: ToolCallOptions
  waiter: DeferredResult | null
  yieldTimeMs: number
  maxOutputTokens: number
  yieldTimer: NodeJS.Timeout | null
  pausedAtYield: boolean
  pendingYieldOutput: unknown[] | null
  pendingResult: RunCodeExecutionResult | null
  pendingError: Error | null
  deliveredOutputCount: number
  pendingPermission: PendingPermissionCall | null
  committedDispatchToolCallId: string | null
  lastHeartbeatAt: number
  startupRssBytes: number | null
  heartbeatTimer: NodeJS.Timeout | null
  rssTimer: NodeJS.Timeout | null
  executionDeadlineTimer: NodeJS.Timeout | null
  yieldLeaseTimer: NodeJS.Timeout | null
  forceKillTimer: NodeJS.Timeout | null
  runtimeAbortController: AbortController
  abortSignal: AbortSignal | null
  abortListener: (() => void) | null
  exited: boolean
  terminal: boolean
  onMessage(message: unknown): void
  onExit(code: number): void
  onError(type: string, location: string): void
}

const READY_TIMEOUT_MS = 5_000
const HEARTBEAT_TIMEOUT_MS = 3_500
const CELL_EXECUTION_DEADLINE_MS = 5 * 60_000
const YIELD_LEASE_MS = 60_000
const MAX_JOURNALED_NESTED_CALLS = Math.min(
  RUN_CODE_MAX_NESTED_CALLS,
  MAX_EXECUTION_JOURNAL_NESTED_CHILDREN
)
const STOP_GRACE_MS = 500
const RSS_SOFT_MIN_BYTES = 256 * 1024 * 1024
const RSS_SOFT_DELTA_BYTES = 128 * 1024 * 1024
const RSS_HARD_BYTES = 512 * 1024 * 1024

function createDeferred(): DeferredResult {
  let resolve!: (value: RunCodeExecutionResult) => void
  let reject!: (error: Error) => void
  const promise = new Promise<RunCodeExecutionResult>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function unwrapMessage(message: unknown): unknown {
  if (message && typeof message === 'object' && 'data' in message) {
    return (message as { data?: unknown }).data
  }
  return message
}

function isHostMessage(value: unknown): value is RunCodeHostMessage {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'version' in value &&
    (value as { version?: unknown }).version === RUN_CODE_PROTOCOL_VERSION
  )
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function stringifyResult(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function getNestedToolResult(response: { content: unknown; rawData: MCPToolResponse }): unknown {
  return response.rawData.structuredContent === undefined
    ? response.content
    : response.rawData.structuredContent
}

function createResultContent(
  message: Extract<RunCodeHostMessage, { type: 'RESULT' }>,
  frontend: RunCodeFrontend,
  output: unknown[] = message.output
): string {
  if (frontend === 'function') {
    const logs = output.filter((value): value is string => typeof value === 'string')
    const rendered = message.returnValue === undefined ? '' : stringifyResult(message.returnValue)
    const parts = [logs.join('\n'), rendered].filter((value) => value.length > 0)
    return parts.length > 0 ? parts.join('\n') : '(run_code completed with no output)'
  }
  return stringifyResult({
    status: 'completed',
    output,
    ...(message.returnValue === undefined ? {} : { returnValue: message.returnValue })
  })
}

function createYieldContent(cellId: string, output: unknown[]): string {
  const running = `Script running with cell ID ${cellId}.`
  return output.length > 0 ? `${stringifyResult(output)}\n${running}` : running
}

function limitOutputTokens(content: string, maxTokens: number): string {
  const maxChars = Math.max(1, maxTokens) * 4
  if (content.length <= maxChars) return content
  return `${content.slice(0, maxChars)}\n<output truncated>`
}

function assertCompleteJournalCapabilities(options: ToolCallOptions): void {
  const capabilities = [
    options.commitDispatch,
    options.commitNestedDispatch,
    options.commitNestedToolOutcome
  ]
  const provided = capabilities.filter(Boolean).length
  if (provided !== 0 && provided !== capabilities.length) {
    throw new Error('Code Mode execution requires complete outer and nested journal capabilities.')
  }
}

export class RunCodeRuntimeManager {
  private readonly cellsById = new Map<string, ActiveCell>()
  private readonly cellsBySession = new Map<string, ActiveCell>()
  private readonly storesBySession = new Map<string, Record<string, unknown>>()
  private shuttingDown = false

  constructor(private readonly managerOptions: RunCodeRuntimeManagerOptions) {}

  async execute(input: RunCodeExecutionInput): Promise<RunCodeExecutionResult> {
    if (this.shuttingDown) throw new Error('Code mode runtime is shutting down.')
    input.options.signal?.throwIfAborted()
    assertCompleteJournalCapabilities(input.options)
    if (Buffer.byteLength(input.source, 'utf8') > RUN_CODE_SOURCE_MAX_BYTES) {
      throw new Error('Code mode source exceeded the 256 KiB limit.')
    }

    const existing = this.cellsBySession.get(input.sessionId)
    if (existing) {
      // Permission retries must keep the provider tool-call ID so parent and child journal
      // identities remain stable across the resumed execution.
      if (
        existing.outerToolCallId === input.toolCallId &&
        existing.state === 'permission' &&
        existing.pendingPermission
      ) {
        existing.options = input.options
        this.clearCellLease(existing)
        this.bindAbortSignal(existing, input.options.signal)
        existing.waiter = createDeferred()
        void this.retryPermissionCall(existing)
        return await existing.waiter.promise
      }
      throw new Error(`Session ${input.sessionId} already has an active code cell.`)
    }

    const cellId = randomUUID()

    const canonicalCatalog = buildCanonicalToolCatalog(input.executionCatalog)
    const catalogEntryByName = new Map(
      canonicalCatalog.entries.map((entry) => [entry.target.providerVisibleName, entry])
    )
    const bindings = new Map<
      string,
      { binding: RunCodeToolBinding; definition: MCPToolDefinition; definitionHash: string }
    >()
    const seenNames = new Set<string>()
    for (const definition of input.executionCatalog) {
      const rawName = definition.function.name.trim()
      if (!rawName) continue
      const catalogEntry = catalogEntryByName.get(rawName)
      if (!catalogEntry) throw new Error(`Code Mode catalog identity is missing for '${rawName}'.`)
      const name = input.frontend === 'codex' ? normalizeCodexToolName(rawName) : rawName
      if (seenNames.has(name)) throw new Error(`Duplicate Code Mode tool name: ${name}`)
      seenNames.add(name)
      const binding: RunCodeToolBinding = {
        id: randomUUID(),
        name,
        description: definition.function.description,
        execution:
          definition.execution.effect === 'read' && definition.execution.mode === 'parallel'
            ? 'parallel'
            : 'sequential'
      }
      bindings.set(binding.id, {
        binding,
        definition,
        definitionHash: catalogEntry.canonicalToolDefinitionHash
      })
    }

    input.options.commitDispatch?.(input.outerDispatch)
    const host = await this.spawnReadyHost()

    const cell = this.createCell({
      id: cellId,
      sessionId: input.sessionId,
      runId: input.runId,
      outerToolCallId: input.toolCallId,
      frontend: input.frontend,
      host,
      bindings,
      capabilityHash: canonicalCatalog.fullCatalogHash,
      yieldTimeMs: input.yieldTimeMs ?? 10_000,
      maxOutputTokens: input.maxOutputTokens ?? 10_000,
      options: input.options,
      committedDispatchToolCallId: input.toolCallId
    })
    this.cellsById.set(cell.id, cell)
    this.cellsBySession.set(cell.sessionId, cell)
    this.attachCell(cell)
    cell.state = 'running'
    this.post(cell, {
      type: 'START',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId,
      frontend: input.frontend,
      source: input.source,
      bindings: [...bindings.values()].map(({ binding }) => binding),
      store: structuredClone(this.storesBySession.get(input.sessionId) ?? {})
    })
    this.scheduleYield(cell)
    const waiter = cell.waiter
    if (!waiter) throw new Error('Code cell lost its initial result waiter.')
    return await waiter.promise
  }

  async wait(input: RunCodeWaitInput): Promise<RunCodeExecutionResult> {
    input.options.signal?.throwIfAborted()
    assertCompleteJournalCapabilities(input.options)
    const cell = this.cellsById.get(input.cellId)
    if (!cell || cell.sessionId !== input.sessionId) {
      throw new Error(`Code cell ${input.cellId} is not available for this session.`)
    }
    if (
      cell.state === 'permission' &&
      cell.pendingPermission &&
      cell.outerToolCallId !== input.toolCallId
    ) {
      throw new Error('Code Mode permission must resume through its original outer tool call.')
    }
    cell.outerToolCallId = input.toolCallId
    this.commitOuterDispatch(cell, input.toolCallId, input.outerDispatch, input.options)
    if (input.terminate) {
      cell.terminal = true
      this.cleanupCell(cell, 'Terminated by wait.')
      return { content: `Code cell ${input.cellId} was terminated.` }
    }

    if (cell.state === 'permission' && cell.pendingPermission) {
      cell.options = input.options
      this.clearCellLease(cell)
      this.bindAbortSignal(cell, input.options.signal)
      cell.waiter = createDeferred()
      void this.retryPermissionCall(cell)
      return await cell.waiter.promise
    }

    if (cell.state !== 'yielded') {
      throw new Error(`Code cell ${input.cellId} is not available to wait.`)
    }

    cell.outerToolCallId = input.toolCallId
    cell.options = input.options
    cell.yieldTimeMs = input.yieldTimeMs
    cell.maxOutputTokens = input.maxTokens
    this.clearCellLease(cell)

    if (cell.pendingError) {
      const error = cell.pendingError
      cell.pendingError = null
      cell.terminal = true
      this.cleanupCell(cell, error.message)
      throw error
    }
    if (cell.pendingResult) {
      const result = cell.pendingResult
      cell.pendingResult = null
      cell.terminal = true
      this.cleanupCell(cell, 'completed')
      return result
    }
    if (cell.pendingYieldOutput) {
      const output = this.takeUndeliveredOutput(cell, cell.pendingYieldOutput)
      cell.pendingYieldOutput = null
      this.armCellLease(cell, 'Code cell yield lease expired.')
      return {
        content: limitOutputTokens(createYieldContent(cell.id, output), cell.maxOutputTokens)
      }
    }

    cell.waiter = createDeferred()
    cell.state = 'running'
    this.bindAbortSignal(cell, input.options.signal)
    if (cell.pausedAtYield) {
      cell.pausedAtYield = false
      this.post(cell, {
        type: 'RESUME',
        version: RUN_CODE_PROTOCOL_VERSION,
        cellId: cell.id
      })
    }
    this.drainPendingNestedCalls(cell)
    this.scheduleYield(cell)
    return await cell.waiter.promise
  }

  cancelSession(sessionId: string, reason = 'Session closed.'): void {
    const cell = this.cellsBySession.get(sessionId)
    if (cell) this.failAndCleanup(cell, new Error(reason))
    this.storesBySession.delete(sessionId)
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const cells = [...this.cellsById.values()]
    await Promise.all(
      cells.map(async (cell) => {
        this.failAndCleanup(cell, new Error('Code mode runtime shut down.'))
        await this.waitForExit(cell, STOP_GRACE_MS + 100)
      })
    )
    this.cellsById.clear()
    this.cellsBySession.clear()
    this.storesBySession.clear()
  }

  private createCell(input: {
    id: string
    sessionId: string
    runId?: string
    outerToolCallId: string
    frontend: RunCodeFrontend
    host: CodeModeUtilityProcess
    bindings: ActiveCell['bindings']
    yieldTimeMs: number
    maxOutputTokens: number
    options: ToolCallOptions
    capabilityHash: string
    committedDispatchToolCallId: string | null
  }): ActiveCell {
    const cell: ActiveCell = {
      ...input,
      state: 'starting',
      waiter: createDeferred(),
      yieldTimer: null,
      pausedAtYield: false,
      pendingYieldOutput: null,
      pendingResult: null,
      pendingError: null,
      deliveredOutputCount: 0,
      pendingPermission: null,
      nestedCalls: new Map(),
      nestedCallsInFlight: 0,
      nextChildOrdinal: 0,
      pendingNestedMessages: [],
      pendingHostSettlement: null,
      lastHeartbeatAt: Date.now(),
      startupRssBytes: null,
      heartbeatTimer: null,
      rssTimer: null,
      executionDeadlineTimer: null,
      yieldLeaseTimer: null,
      forceKillTimer: null,
      runtimeAbortController: new AbortController(),
      abortSignal: null,
      abortListener: null,
      exited: false,
      terminal: false,
      onMessage: (message) => this.handleCellMessage(cell, message),
      onExit: (code) => this.handleCellExit(cell, code),
      onError: (type, location) =>
        this.failAndCleanup(
          cell,
          new Error(`Code mode utility process error: ${type} at ${location}`)
        )
    }
    return cell
  }

  private attachCell(cell: ActiveCell): void {
    cell.host.on('message', cell.onMessage)
    cell.host.on('exit', cell.onExit)
    cell.host.on('error', cell.onError)
    cell.heartbeatTimer = setInterval(() => {
      if (Date.now() - cell.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
        this.failAndCleanup(cell, new Error('Code cell heartbeat timed out.'))
      }
    }, 1_000)
    cell.rssTimer = setInterval(() => this.inspectRss(cell), 1_000)
    cell.executionDeadlineTimer = setTimeout(
      () => this.failAndCleanup(cell, new Error('Code cell execution deadline exceeded.')),
      CELL_EXECUTION_DEADLINE_MS
    )
    cell.executionDeadlineTimer.unref?.()

    this.bindAbortSignal(cell, cell.options.signal)
  }

  private scheduleYield(cell: ActiveCell): void {
    this.clearYieldTimer(cell)
    if (cell.frontend !== 'codex' || !cell.waiter || cell.state !== 'running') return
    cell.yieldTimer = setTimeout(() => {
      cell.yieldTimer = null
      if (cell.state !== 'running' || !cell.waiter || cell.terminal) return
      if (cell.nestedCallsInFlight > 0) {
        this.scheduleYield(cell)
        return
      }
      const waiter = cell.waiter
      cell.waiter = null
      cell.state = 'yielded'
      cell.pausedAtYield = false
      this.bindAbortSignal(cell, undefined)
      waiter.resolve({
        content: limitOutputTokens(createYieldContent(cell.id, []), cell.maxOutputTokens)
      })
      this.armCellLease(cell, 'Code cell yield lease expired.')
    }, cell.yieldTimeMs)
  }

  private clearYieldTimer(cell: ActiveCell): void {
    if (cell.yieldTimer) clearTimeout(cell.yieldTimer)
    cell.yieldTimer = null
  }

  private armCellLease(cell: ActiveCell, errorMessage: string): void {
    this.clearCellLease(cell)
    cell.yieldLeaseTimer = setTimeout(
      () => this.failAndCleanup(cell, new Error(errorMessage)),
      YIELD_LEASE_MS
    )
  }

  private clearCellLease(cell: ActiveCell): void {
    if (cell.yieldLeaseTimer) clearTimeout(cell.yieldLeaseTimer)
    cell.yieldLeaseTimer = null
  }

  private takeUndeliveredOutput(cell: ActiveCell, output: unknown[]): unknown[] {
    const start = output.length < cell.deliveredOutputCount ? 0 : cell.deliveredOutputCount
    cell.deliveredOutputCount = output.length
    return output.slice(start)
  }

  private commitOuterDispatch(
    cell: ActiveCell,
    toolCallId: string,
    outerDispatch: ToolDispatchCommitInput,
    options: ToolCallOptions
  ): void {
    if (cell.committedDispatchToolCallId === toolCallId) return
    options.commitDispatch?.(outerDispatch)
    cell.committedDispatchToolCallId = toolCallId
  }

  private createNestedCallState(
    cell: ActiveCell,
    hostCallId: string,
    definitionHash: string
  ): NestedCallState {
    if (cell.nestedCalls.has(hostCallId)) {
      throw new Error(`Duplicate Code Mode subtool call ID: ${hostCallId}`)
    }
    if (cell.nextChildOrdinal >= MAX_JOURNALED_NESTED_CALLS) {
      throw new Error(`Code cell exceeded ${MAX_JOURNALED_NESTED_CALLS} nested tool calls.`)
    }
    if (cell.committedDispatchToolCallId !== cell.outerToolCallId) {
      throw new Error('Code Mode subtool call has no committed outer dispatch.')
    }
    const child: NestedCallState = {
      hostCallId,
      outerToolCallId: cell.outerToolCallId,
      childOrdinal: cell.nextChildOrdinal,
      definitionHash,
      dispatchCommitted: false,
      outcomeCommitted: false
    }
    cell.nextChildOrdinal += 1
    cell.nestedCalls.set(hostCallId, child)
    return child
  }

  private drainPendingNestedCalls(cell: ActiveCell): void {
    const pending = cell.pendingNestedMessages.splice(0)
    for (const message of pending) void this.handleNestedCall(cell, message)
  }

  private flushPendingHostSettlement(cell: ActiveCell): void {
    if (
      cell.state !== 'running' ||
      cell.nestedCallsInFlight > 0 ||
      cell.terminal ||
      !cell.pendingHostSettlement
    ) {
      return
    }
    const message = cell.pendingHostSettlement
    cell.pendingHostSettlement = null
    this.handleCellMessage(cell, message)
  }

  private async handleNestedCall(
    cell: ActiveCell,
    message: Extract<RunCodeHostMessage, { type: 'NESTED_CALL' }>
  ): Promise<void> {
    if (cell.state === 'yielded') {
      cell.pendingNestedMessages.push(message)
      return
    }
    if (cell.state !== 'running') {
      this.postNestedError(cell, message.callId, 'Code Mode cell is not accepting subtool calls.')
      return
    }
    const entry = cell.bindings.get(message.bindingId)
    if (!entry) {
      this.postNestedError(cell, message.callId, 'Unknown or stale Code Mode tool binding.')
      return
    }
    let child: NestedCallState
    try {
      child = this.createNestedCallState(cell, message.callId, entry.definitionHash)
    } catch (error) {
      this.postNestedError(cell, message.callId, toError(error).message)
      return
    }
    cell.nestedCallsInFlight += 1

    try {
      const response = await this.managerOptions.executeNested({
        sessionId: cell.sessionId,
        runId: cell.runId,
        callId: message.callId,
        definition: entry.definition,
        arguments: message.arguments,
        options: this.createNestedOptions(cell, child)
      })
      if (cell.terminal) return
      if (response.rawData.requiresPermission === true) {
        if (child.dispatchCommitted) {
          throw new Error('Code Mode subtool requested permission after dispatch.')
        }
        this.clearYieldTimer(cell)
        cell.state = 'permission'
        cell.pendingPermission = {
          hostCallId: message.callId,
          binding: entry.binding,
          arguments: message.arguments,
          response
        }
        const waiter = cell.waiter
        cell.waiter = null
        this.bindAbortSignal(cell, undefined)
        waiter?.resolve({
          content: stringifyResult(response.content),
          rawData: response.rawData
        })
        this.armCellLease(cell, 'Code cell permission lease expired.')
        return
      }
      this.commitNestedOutcome(
        cell,
        child,
        stringifyResult(response.rawData.content ?? response.content),
        response.rawData.isError === true
      )
      this.postNestedResponse(cell, message.callId, response)
    } catch (error) {
      if (cell.terminal) return
      this.completeNestedFailure(cell, child, toError(error))
    } finally {
      cell.nestedCallsInFlight -= 1
      this.flushPendingHostSettlement(cell)
    }
  }

  private async retryPermissionCall(cell: ActiveCell): Promise<void> {
    const pending = cell.pendingPermission
    if (!pending) return
    const entry = cell.bindings.get(pending.binding.id)
    const child = cell.nestedCalls.get(pending.hostCallId)
    if (!entry || !child) {
      this.failAndCleanup(cell, new Error('Code Mode tool binding expired during permission wait.'))
      return
    }

    cell.nestedCallsInFlight += 1
    try {
      const response = await this.managerOptions.executeNested({
        sessionId: cell.sessionId,
        runId: cell.runId,
        callId: pending.hostCallId,
        definition: entry.definition,
        arguments: pending.arguments,
        options: this.createNestedOptions(cell, child)
      })
      if (cell.terminal || cell.state === 'stopping') return
      if (response.rawData.requiresPermission === true) {
        if (child.dispatchCommitted) {
          throw new Error('Code Mode subtool requested permission after dispatch.')
        }
        pending.response = response
        const waiter = cell.waiter
        cell.waiter = null
        this.bindAbortSignal(cell, undefined)
        waiter?.resolve({
          content: stringifyResult(response.content),
          rawData: response.rawData
        })
        this.armCellLease(cell, 'Code cell permission lease expired.')
        return
      }
      this.commitNestedOutcome(
        cell,
        child,
        stringifyResult(response.rawData.content ?? response.content),
        response.rawData.isError === true
      )
      cell.pendingPermission = null
      cell.state = 'running'
      this.postNestedResponse(cell, pending.hostCallId, response)
      this.scheduleYield(cell)
    } catch (error) {
      if (cell.terminal || cell.state === 'stopping') return
      cell.pendingPermission = null
      cell.state = 'running'
      this.completeNestedFailure(cell, child, toError(error))
      this.scheduleYield(cell)
    } finally {
      cell.nestedCallsInFlight -= 1
      this.flushPendingHostSettlement(cell)
    }
  }

  private handleCellMessage(cell: ActiveCell, rawMessage: unknown): void {
    const message = unwrapMessage(rawMessage)
    if (!isHostMessage(message)) return
    if (message.type === 'READY') return
    if ('cellId' in message && message.cellId && message.cellId !== cell.id) return
    if (
      (message.type === 'YIELDED' || message.type === 'RESULT' || message.type === 'ERROR') &&
      (cell.nestedCallsInFlight > 0 || cell.pendingNestedMessages.length > 0)
    ) {
      if (cell.pendingHostSettlement) {
        this.failAndCleanup(cell, new Error('Code Mode host sent overlapping settlement messages.'))
        return
      }
      this.clearYieldTimer(cell)
      cell.pendingHostSettlement = message
      return
    }

    switch (message.type) {
      case 'HEARTBEAT':
        cell.lastHeartbeatAt = Date.now()
        return
      case 'NESTED_CALL':
        void this.handleNestedCall(cell, message)
        return
      case 'YIELDED':
        if (cell.frontend !== 'codex') {
          this.failAndCleanup(cell, new Error('yield_control is unavailable for this frontend.'))
          return
        }
        this.clearYieldTimer(cell)
        cell.state = 'yielded'
        cell.pausedAtYield = true
        if (cell.waiter) {
          const waiter = cell.waiter
          cell.waiter = null
          this.bindAbortSignal(cell, undefined)
          const output = this.takeUndeliveredOutput(cell, message.output)
          waiter.resolve({
            content: limitOutputTokens(createYieldContent(cell.id, output), cell.maxOutputTokens)
          })
        } else {
          cell.pendingYieldOutput = message.output
        }
        this.armCellLease(cell, 'Code cell yield lease expired.')
        return
      case 'RESULT':
        this.storesBySession.set(cell.sessionId, structuredClone(message.store))
        this.clearYieldTimer(cell)
        {
          const output = this.takeUndeliveredOutput(cell, message.output)
          const result = {
            content: limitOutputTokens(
              createResultContent(message, cell.frontend, output),
              cell.maxOutputTokens
            )
          }
          if (cell.waiter) {
            const waiter = cell.waiter
            cell.waiter = null
            cell.terminal = true
            waiter.resolve(result)
            this.cleanupCell(cell, 'completed')
          } else {
            cell.state = 'yielded'
            cell.pendingResult = result
            this.armCellLease(cell, 'Code cell yield lease expired.')
          }
        }
        return
      case 'ERROR':
        this.clearYieldTimer(cell)
        {
          const error = new Error(
            message.output?.length
              ? `${message.output.map(stringifyResult).join('\n')}\n${message.error}`
              : message.error
          )
          if (cell.waiter) {
            this.failAndCleanup(cell, error)
          } else {
            cell.state = 'yielded'
            cell.pendingError = error
            this.armCellLease(cell, 'Code cell yield lease expired.')
          }
        }
        return
      default:
        return
    }
  }

  private handleCellExit(cell: ActiveCell, code: number): void {
    cell.exited = true
    if (cell.forceKillTimer) clearTimeout(cell.forceKillTimer)
    cell.forceKillTimer = null
    if (!cell.terminal && cell.state !== 'stopping') {
      this.failAndCleanup(cell, new Error(`Code mode utility process exited with code ${code}.`))
      return
    }
    this.detachCell(cell)
  }

  private postNestedError(cell: ActiveCell, callId: string, error: string): void {
    this.post(cell, {
      type: 'NESTED_RESULT',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: cell.id,
      callId,
      ok: false,
      error
    })
  }

  private postNestedResponse(
    cell: ActiveCell,
    callId: string,
    response: { content: unknown; rawData: MCPToolResponse }
  ): void {
    if (response.rawData.isError === true) {
      this.postNestedError(
        cell,
        callId,
        stringifyResult(response.rawData.content ?? response.content)
      )
      return
    }
    this.post(cell, {
      type: 'NESTED_RESULT',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: cell.id,
      callId,
      ok: true,
      result: getNestedToolResult(response)
    })
  }

  private post(cell: ActiveCell, message: RunCodeParentMessage): void {
    try {
      cell.host.postMessage(message)
    } catch (error) {
      this.failAndCleanup(cell, toError(error))
    }
  }

  private failAndCleanup(cell: ActiveCell, error: Error): void {
    if (cell.terminal) return
    cell.terminal = true
    const waiter = cell.waiter
    cell.waiter = null
    waiter?.reject(error)
    this.cleanupCell(cell, error.message)
  }

  private cleanupCell(cell: ActiveCell, reason: string): void {
    if (cell.state === 'stopping') return
    cell.state = 'stopping'
    this.cellsById.delete(cell.id)
    if (this.cellsBySession.get(cell.sessionId) === cell) {
      this.cellsBySession.delete(cell.sessionId)
    }
    if (cell.heartbeatTimer) clearInterval(cell.heartbeatTimer)
    if (cell.rssTimer) clearInterval(cell.rssTimer)
    if (cell.executionDeadlineTimer) clearTimeout(cell.executionDeadlineTimer)
    if (cell.yieldTimer) clearTimeout(cell.yieldTimer)
    if (cell.yieldLeaseTimer) clearTimeout(cell.yieldLeaseTimer)
    cell.heartbeatTimer = null
    cell.rssTimer = null
    cell.executionDeadlineTimer = null
    cell.yieldTimer = null
    cell.yieldLeaseTimer = null
    cell.runtimeAbortController.abort(new DOMException(reason, 'AbortError'))
    this.bindAbortSignal(cell, undefined)
    try {
      cell.host.postMessage({
        type: 'STOP',
        version: RUN_CODE_PROTOCOL_VERSION,
        cellId: cell.id,
        reason
      } satisfies RunCodeParentMessage)
    } catch {}
    cell.forceKillTimer = setTimeout(() => {
      if (!cell.exited) {
        try {
          cell.host.kill()
        } catch {}
      }
      this.detachCell(cell)
    }, STOP_GRACE_MS)
    cell.forceKillTimer.unref?.()
  }

  private detachCell(cell: ActiveCell): void {
    if (cell.forceKillTimer) clearTimeout(cell.forceKillTimer)
    cell.forceKillTimer = null
    cell.host.off('message', cell.onMessage)
    cell.host.off('exit', cell.onExit)
    cell.host.off('error', cell.onError)
  }

  private bindAbortSignal(cell: ActiveCell, signal: AbortSignal | undefined): void {
    if (cell.abortListener && cell.abortSignal) {
      cell.abortSignal.removeEventListener('abort', cell.abortListener)
    }
    cell.abortSignal = signal ?? null
    cell.abortListener = null
    if (!signal || cell.terminal) return

    const listener = () => this.failAndCleanup(cell, new DOMException('Aborted', 'AbortError'))
    cell.abortListener = listener
    signal.addEventListener('abort', listener, { once: true })
    if (signal.aborted) listener()
  }

  private createNestedOptions(cell: ActiveCell, child: NestedCallState): ToolCallOptions {
    const {
      commitDispatch: _commitOuterDispatch,
      commitNestedDispatch,
      commitNestedToolOutcome: _commitNestedToolOutcome,
      ...options
    } = cell.options
    return {
      ...options,
      signal: cell.runtimeAbortController.signal,
      ...(commitNestedDispatch
        ? {
            commitDispatch: (input) => {
              if (child.dispatchCommitted) {
                throw new Error(`Code Mode subtool ${child.hostCallId} dispatched more than once.`)
              }
              if (
                child.outerToolCallId !== cell.outerToolCallId ||
                cell.committedDispatchToolCallId !== child.outerToolCallId
              ) {
                throw new Error('Code Mode subtool parent dispatch identity changed.')
              }
              commitNestedDispatch({
                ...input,
                childOrdinal: child.childOrdinal,
                definitionHash: child.definitionHash,
                capabilityHash: cell.capabilityHash
              })
              child.dispatchCommitted = true
            }
          }
        : {})
    }
  }

  private commitNestedOutcome(
    cell: ActiveCell,
    child: NestedCallState,
    responseText: string,
    isError: boolean
  ): void {
    if (!child.dispatchCommitted || child.outcomeCommitted) return
    cell.options.commitNestedToolOutcome?.({
      childOrdinal: child.childOrdinal,
      responseText,
      isError
    })
    child.outcomeCommitted = true
  }

  private completeNestedFailure(cell: ActiveCell, child: NestedCallState, error: Error): void {
    try {
      this.commitNestedOutcome(cell, child, error.message, true)
    } catch (journalError) {
      this.failAndCleanup(cell, toError(journalError))
      return
    }
    this.postNestedError(cell, child.hostCallId, error.message)
  }

  private inspectRss(cell: ActiveCell): void {
    if (!cell.host.pid) return
    void import('electron')
      .then(({ app }) => {
        if (cell.state === 'stopping') return
        const metric = app.getAppMetrics().find((entry) => entry.pid === cell.host.pid)
        const rssBytes = metric ? metric.memory.workingSetSize * 1024 : null
        if (rssBytes === null) return
        cell.startupRssBytes ??= rssBytes
        const softLimit = Math.max(RSS_SOFT_MIN_BYTES, cell.startupRssBytes + RSS_SOFT_DELTA_BYTES)
        if (rssBytes > RSS_HARD_BYTES) {
          this.failAndCleanup(cell, new Error('Code cell exceeded the 512 MiB RSS limit.'))
        } else if (rssBytes > softLimit) {
          console.warn('[RunCodeRuntime] Code cell exceeded the RSS soft ceiling.', {
            cellId: cell.id,
            rssBytes,
            softLimit
          })
        }
      })
      .catch((error) => {
        if (cell.state !== 'stopping') {
          console.warn('[RunCodeRuntime] Failed to inspect utility process RSS.', error)
        }
      })
  }

  private async spawnReadyHost(): Promise<CodeModeUtilityProcess> {
    const host = this.managerOptions.spawnHost
      ? await this.managerOptions.spawnHost()
      : await this.spawnDefaultHost()
    return await new Promise<CodeModeUtilityProcess>((resolve, reject) => {
      let settled = false
      const settle = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        host.off('message', onMessage)
        host.off('exit', onExit)
        host.off('error', onError)
        callback()
      }
      const onMessage = (rawMessage: unknown) => {
        const message = unwrapMessage(rawMessage)
        if (
          isHostMessage(message) &&
          message.type === 'READY' &&
          message.version === RUN_CODE_PROTOCOL_VERSION
        ) {
          settle(() => resolve(host))
        }
      }
      const onExit = (code: number) =>
        settle(() => reject(new Error(`Code mode utility exited before ready: ${code}`)))
      const onError = (type: string, location: string) =>
        settle(() =>
          reject(new Error(`Code mode utility failed before ready: ${type} at ${location}`))
        )
      const timeout = setTimeout(() => {
        settle(() => {
          try {
            host.kill()
          } catch {}
          reject(new Error('Code mode utility did not become ready within 5 seconds.'))
        })
      }, READY_TIMEOUT_MS)
      host.on('message', onMessage)
      host.on('exit', onExit)
      host.on('error', onError)
    })
  }

  private async spawnDefaultHost(): Promise<CodeModeUtilityProcess> {
    const { app, utilityProcess } = await import('electron')
    const modulePath = this.resolveUtilityHostEntryPoint(app.getAppPath())
    const env: Record<string, string> = {
      DEEPCHAT_CODE_MODE_HOST: '1'
    }
    for (const name of ['LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot']) {
      const value = process.env[name]
      if (value) env[name] = value
    }
    return utilityProcess.fork(modulePath, ['--deepchat-code-mode-host'], {
      serviceName: 'DeepChat Code Mode Cell',
      stdio: 'ignore',
      env,
      execArgv: ['--max-old-space-size=64'],
      allowLoadingUnsignedLibraries: false
    }) as CodeModeUtilityProcess
  }

  private resolveUtilityHostEntryPoint(appPath?: string): string {
    const modulePath = fileURLToPath(import.meta.url)
    const candidates = [
      ...(appPath
        ? [
            path.join(appPath, 'out/main/codeModeUtilityHost.js'),
            path.join(appPath, 'codeModeUtilityHost.js')
          ]
        : []),
      path.resolve(path.dirname(modulePath), 'codeModeUtilityHost.js'),
      path.resolve(path.dirname(modulePath), '../../codeModeUtilityHost.js'),
      path.resolve(process.cwd(), 'out/main/codeModeUtilityHost.js')
    ]
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  }

  private async waitForExit(cell: ActiveCell, timeoutMs: number): Promise<void> {
    if (cell.exited) return
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        cell.host.off('exit', onExit)
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      const onExit = () => {
        finish()
      }
      cell.host.on('exit', onExit)
    })
  }
}
