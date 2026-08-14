import { randomUUID } from 'node:crypto'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type {
  MCPToolCall,
  MCPToolResponse,
  ToolCallImagePreview,
  ToolDispatchCommitInput,
  ToolOutcomeProjection
} from '@shared/types/core/mcp'
import type { ToolExecutionPort, ToolResultPort } from '@/agent/deepchat/loop/ports'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import { extractToolCallImagePreviews } from '@/lib/toolCallImagePreviews'
import {
  CommittedToolOutcomeProjectionError,
  ExecutionJournalCorruptionError,
  ExecutionJournalDuplicateDispatchError,
  ExecutionJournalError,
  isExecutionJournalError,
  type ExecutionOperationIdentity,
  type ExecutionRunOutcome
} from '@/tape/domain/executionJournal'
import type { ExecutionJournalWriter } from '@/tape/ports/capabilities'
import {
  notifyRunJournalObserver,
  type PendingToolInteraction,
  type RunJournalObserver
} from './types'
import type { DeepChatToolResolver } from './toolResolver'
import type { MessageProjectionService } from './messageProjectionService'
import type { RunLifecycleCoordinator } from './runLifecycleCoordinator'
import { elapsedMonotonicMs, readMonotonicNow, type MonotonicClock } from '@/lib/monotonicTime'
import type { SessionIdentityService } from './sessionIdentityService'
import type { SessionSettingsCoordinator } from './sessionSettingsCoordinator'
import type { SessionStateResolver } from './sessionStateResolver'
import { toolContentToText } from './toolAdapters'
import { isUserConfigurableAgentTool } from '@shared/agentTools'
import type { DeepChatExecutionContract } from '@shared/types/execution-contract'
import { CommandShellProfileSchema, type CommandShellProfile } from '@shared/commandShell'
import type { CommandShellService } from '@/agent/shared/process/commandShellService'
import type { ToolSurfaceDeferredDispatch } from './toolSurface'
import type { ToolPermissionLeaseCapability } from '@shared/types/tool'
import type {
  ProgrammaticToolParentRegistration,
  ProgrammaticToolParentRegistry
} from '@/cli/programmaticToolParentRegistry'
import {
  isProgrammaticCommandLaunchError,
  ProgrammaticCommandLaunchError
} from '@/tool/agentTools/agentBashHandler'
import { prepareProgrammaticExecParent } from './programmaticExecParent'
import {
  requireProgrammaticToolDeferredResumeCapability,
  type ProgrammaticToolCapabilityV1
} from './programmaticToolSurface'

export type DeferredToolExecutionResult = {
  responseText: string
  isError: boolean
  invoked?: boolean
  toolSource?: 'mcp' | 'agent'
  serverName?: string
  offloadPath?: string
  existingOffloadPath?: string
  rtkApplied?: boolean
  rtkMode?: 'rewrite' | 'direct' | 'bypass'
  rtkFallbackReason?: string
  imagePreviews?: ToolCallImagePreview[]
  requiresPermission?: boolean
  permissionRequest?: PendingToolInteraction['permission']
  terminalError?: string
  journalFailure?: {
    error: ExecutionJournalError
    dispatchCommitted: boolean
    outcomeCommitted: boolean
  }
}

export interface DeferredToolExecutorDependencies {
  toolExecutionPort: ToolExecutionPort
  toolResultPort: ToolResultPort
  toolResolver: DeepChatToolResolver
  cacheImage(data: string): Promise<string>
  runLifecycle: Pick<
    RunLifecycleCoordinator,
    'registerDeferredToolController' | 'clearDeferredToolController' | 'getAbortSignal'
  >
  sessionSettings: Pick<SessionSettingsCoordinator, 'resolveProjectDir'>
  sessionState: Pick<SessionStateResolver, 'get'>
  identity: Pick<SessionIdentityService, 'getAgentId'>
  messageProjection: Pick<MessageProjectionService, 'updateSubagentToolCallProgress'>
  executionJournal: ExecutionJournalWriter
  programmaticToolParents: Pick<ProgrammaticToolParentRegistry, 'commitRunTerminal' | 'prepare'>
  commandShell: Pick<CommandShellService, 'resolveForTurn' | 'resolveProfile'>
  runJournalObserver?: RunJournalObserver
  diagnosticNow?: MonotonicClock
}

function throwIfAbortRequested(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (typeof DOMException !== 'undefined') {
    throw new DOMException('Aborted', 'AbortError')
  }
  const error = new Error('Aborted')
  error.name = 'AbortError'
  throw error
}

function commitExecutionJournalFact<T>(fact: string, commit: () => T): T {
  try {
    return commit()
  } catch (error) {
    if (isExecutionJournalError(error)) throw error
    throw new ExecutionJournalError(
      `Failed to commit deferred tool ${fact}.`,
      'persistence_failed',
      { cause: error }
    )
  }
}

export class DeferredToolExecutor {
  constructor(private readonly dependencies: DeferredToolExecutorDependencies) {}

  async execute(
    sessionId: string,
    messageId: string,
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>,
    onToolCallStarted?: () => void,
    executionContract?: DeepChatExecutionContract,
    commandShellProfile?: CommandShellProfile,
    oneShotCommandGrantId?: string,
    toolSurfaceDeferredDispatch?: ToolSurfaceDeferredDispatch,
    onDispatchCommitted?: () => void,
    permissionLease?: ToolPermissionLeaseCapability
  ): Promise<DeferredToolExecutionResult> {
    const toolName = toolCall.name
    if (!toolName) {
      return {
        responseText: 'Invalid tool call without tool name.',
        isError: true
      }
    }
    if (!toolCall.id) {
      return {
        responseText: 'Invalid tool call without tool call id.',
        isError: true
      }
    }
    const toolCallId = toolCall.id

    const deferredAbortController = this.dependencies.runLifecycle.registerDeferredToolController(
      sessionId,
      toolCallId
    )
    const deferredAbortSignal =
      deferredAbortController?.signal ?? this.dependencies.runLifecycle.getAbortSignal(sessionId)
    let invoked = false
    let runId: string | null = null
    let runStartedCommitted = false
    let observedRunStartedAt: number | undefined
    let terminalCommitAttempted = false
    let dispatchCommitted = false
    let outcomeCommitted = false
    let programmaticToolParent: ProgrammaticToolParentRegistration | undefined
    let programmaticToolParentCancelled = false
    let programmaticCompletedResult:
      | ReturnType<ProgrammaticToolParentRegistration['takeCompletedInvocationResult']>
      | undefined
    let programmaticToolCapability: ProgrammaticToolCapabilityV1 | undefined
    let programmaticOuterOutcomeCommitted = false
    let returnedToolResponse: MCPToolResponse | null = null
    let committedOutcomeProjection: DeferredToolExecutionResult | null = null
    const pendingOutcomeProjections: ToolOutcomeProjection[] = []

    const operation = (): ExecutionOperationIdentity => {
      if (!runId) {
        throw new ExecutionJournalError(
          'Deferred tool operation identity was requested before run_started.',
          'invalid_fact'
        )
      }
      return { runId, requestSeq: 1, providerToolCallId: toolCallId }
    }
    const cancelProgrammaticParentBeforeDispatch = (): void => {
      if (
        !programmaticToolParent ||
        programmaticToolParentCancelled ||
        dispatchCommitted
      ) {
        return
      }
      programmaticToolParent.cancelBeforeOuterDispatch()
      programmaticToolParentCancelled = true
    }
    const commitRunTerminal = (input: {
      outcome: ExecutionRunOutcome
      stopReason: string
      errorMessage?: string
    }): void => {
      if (!runId || !runStartedCommitted) {
        throw new ExecutionJournalError(
          'Deferred tool terminal was requested before run_started.',
          'invalid_fact'
        )
      }
      if (terminalCommitAttempted) {
        throw new ExecutionJournalCorruptionError(
          `Deferred tool Run ${runId} attempted more than one terminal commit.`
        )
      }
      const committedRunId = runId
      terminalCommitAttempted = true
      const receipt = commitExecutionJournalFact('run_terminal', () =>
        this.dependencies.programmaticToolParents.commitRunTerminal(
          { sessionId, runId: committedRunId },
          () =>
            this.dependencies.executionJournal.commitRunTerminal({
              sessionId,
              runId: committedRunId,
              messageId,
              ...input
            })
        )
      )
      if (!receipt.created) {
        throw new ExecutionJournalCorruptionError(
          `Execution Journal terminal for deferred tool Run ${committedRunId} already existed.`
        )
      }
      const durationMs = elapsedMonotonicMs(
        observedRunStartedAt,
        this.dependencies.diagnosticNow
      )
      notifyRunJournalObserver(this.dependencies.runJournalObserver, {
        type: 'terminal',
        runKind: 'deferred_tool',
        runId: committedRunId,
        sessionId,
        messageId,
        outcome: input.outcome,
        stopReason: input.stopReason,
        ...(durationMs === undefined ? {} : { durationMs })
      })
    }
    const releaseOutcomeProjections = (): void => {
      if (pendingOutcomeProjections.length === 0) return
      if (!dispatchCommitted) {
        throw new ExecutionJournalError(
          `Deferred tool ${toolCallId} registered an outcome projection without a committed dispatch.`,
          'invalid_fact'
        )
      }
      const projections = pendingOutcomeProjections.splice(0)
      try {
        for (const project of projections) project()
      } catch (error) {
        throw new CommittedToolOutcomeProjectionError(operation(), { cause: error })
      }
    }
    const commitToolOutcome = (input: {
      responseText: string
      isError: boolean
      offloadPath?: string
    }): void => {
      if (programmaticToolParent) {
        if (
          !programmaticOuterOutcomeCommitted ||
          !programmaticCompletedResult ||
          programmaticCompletedResult.responseText !== input.responseText ||
          programmaticCompletedResult.isError !== input.isError
        ) {
          throw new ExecutionJournalError(
            'Deferred Programmatic outer projection does not match its committed process-live result.',
            'projection_failed'
          )
        }
        outcomeCommitted = true
        committedOutcomeProjection = {
          responseText: input.responseText,
          isError: input.isError,
          invoked,
          ...(input.offloadPath === undefined ? {} : { offloadPath: input.offloadPath })
        }
        releaseOutcomeProjections()
        return
      }
      if (!dispatchCommitted) {
        releaseOutcomeProjections()
        return
      }
      if (outcomeCommitted) {
        throw new ExecutionJournalCorruptionError(
          `Deferred tool operation ${toolCallId} attempted more than one outcome commit.`
        )
      }
      const receipt = commitExecutionJournalFact('tool_outcome', () =>
        this.dependencies.executionJournal.commitToolOutcome({
          sessionId,
          messageId,
          operation: operation(),
          responseText: input.responseText,
          isError: input.isError
        })
      )
      if (!receipt.created) {
        throw new ExecutionJournalCorruptionError(
          `Execution Journal outcome for deferred tool operation ${toolCallId} already existed.`
        )
      }
      outcomeCommitted = true
      committedOutcomeProjection = {
        responseText: input.responseText,
        isError: input.isError,
        invoked,
        ...(input.offloadPath === undefined ? {} : { offloadPath: input.offloadPath })
      }
      releaseOutcomeProjections()
    }
    const settleFailClosed = (error: unknown): DeferredToolExecutionResult => {
      const journalError = isExecutionJournalError(error)
        ? error
        : new ExecutionJournalError(
            error instanceof Error ? error.message : String(error),
            'persistence_failed',
            { cause: error }
          )
      let failure = journalError
      if (runStartedCommitted && !terminalCommitAttempted) {
        try {
          commitRunTerminal({
            outcome: 'error',
            stopReason: 'journal_error',
            errorMessage: journalError.message
          })
        } catch (terminalCommitError) {
          failure = new ExecutionJournalError(
            `${journalError.message} Terminal journal commit also failed: ${
              terminalCommitError instanceof Error
                ? terminalCommitError.message
                : String(terminalCommitError)
            }`,
            'persistence_failed',
            { cause: new AggregateError([journalError, terminalCommitError]) }
          )
        }
      }
      return {
        ...(committedOutcomeProjection ?? {
          responseText: dispatchCommitted
            ? 'Tool dispatch was recorded, but its outcome is indeterminate. It will not be retried automatically.'
            : 'Tool dispatch was not recorded because Execution Journal persistence failed.',
          isError: true,
          invoked
        }),
        journalFailure: {
          error: failure,
          dispatchCommitted,
          outcomeCommitted
        }
      }
    }

    try {
      throwIfAbortRequested(deferredAbortSignal)
      const parsedCommandShellProfile =
        commandShellProfile === undefined
          ? undefined
          : CommandShellProfileSchema.parse(commandShellProfile)
      const targetServerName = toolCall.server_name?.trim()
      if (!targetServerName) {
        return {
          responseText: 'Deferred tool execution is missing its server identity.',
          isError: true,
          invoked
        }
      }
      if (!parsedCommandShellProfile && oneShotCommandGrantId !== undefined) {
        return {
          responseText: 'Deferred command execution is missing its shell profile.',
          isError: true,
          invoked
        }
      }
      const projectDir = this.dependencies.sessionSettings.resolveProjectDir(sessionId)
      const toolDefinitions = await awaitWithAbort(
        this.dependencies.toolResolver.loadToolDefinitionsForSession(sessionId, projectDir),
        deferredAbortSignal
      )
      throwIfAbortRequested(deferredAbortSignal)

      const toolDefinition = toolDefinitions.find((definition) => {
        return (
          definition.function.name === toolName &&
          definition.server.name === targetServerName &&
          (targetServerName !== 'agent-filesystem' || definition.source === 'agent')
        )
      })

      if (!toolDefinition) {
        const disabledAgentTools = this.dependencies.toolResolver.getDisabledAgentTools(sessionId)
        return {
          responseText:
            isUserConfigurableAgentTool(toolName) && disabledAgentTools.includes(toolName)
              ? `Tool '${toolName}' is disabled for the current session.`
              : `Tool '${toolName}' is no longer available in the current session.`,
          isError: true
        }
      }

      if (
        !parsedCommandShellProfile &&
        targetServerName === 'agent-filesystem'
      ) {
        return {
          responseText: 'Deferred file execution is missing its shell profile.',
          isError: true,
          invoked
        }
      }

      const extensionPolicy = await awaitWithAbort(
        this.dependencies.toolResolver.resolveAgentExtensionPolicy(sessionId),
        deferredAbortSignal
      )
      throwIfAbortRequested(deferredAbortSignal)
      const deferredActiveSkillNames = await awaitWithAbort(
        this.dependencies.toolResolver.resolveActiveSkillNamesForToolProfile(sessionId),
        deferredAbortSignal
      )
      throwIfAbortRequested(deferredAbortSignal)
      const sessionState = await awaitWithAbort(
        this.dependencies.sessionState.get(sessionId),
        deferredAbortSignal
      )
      if (!sessionState) {
        return {
          responseText: `Session '${sessionId}' is no longer available.`,
          isError: true
        }
      }
      const commandShell = await awaitWithAbort(
        parsedCommandShellProfile
          ? this.dependencies.commandShell.resolveProfile(parsedCommandShellProfile)
          : this.dependencies.commandShell.resolveForTurn(),
        deferredAbortSignal
      )
      throwIfAbortRequested(deferredAbortSignal)
      const request: MCPToolCall = {
        id: toolCallId,
        type: 'function',
        function: {
          name: toolName,
          arguments: toolCall.params || '{}'
        },
        server: toolDefinition.server,
        conversationId: sessionId,
        providerId: sessionState.providerId.trim() || undefined
      }

      const deferredRunId = randomUUID()
      runId = deferredRunId
      programmaticToolParent = prepareProgrammaticExecParent({
        toolName,
        argumentsJson: toolCall.params || '{}',
        operation: operation(),
        sessionId,
        messageId,
        permissionMode: sessionState.permissionMode,
        deferredDispatch: toolSurfaceDeferredDispatch,
        parents: this.dependencies.programmaticToolParents
      })
      if (programmaticToolParent && toolSurfaceDeferredDispatch) {
        programmaticToolCapability = requireProgrammaticToolDeferredResumeCapability(
          toolSurfaceDeferredDispatch
        )
      }
      const runStarted = commitExecutionJournalFact('run_started', () =>
        this.dependencies.executionJournal.commitRunStarted({
          sessionId,
          runId: deferredRunId,
          messageId,
          runKind: 'deferred_tool'
        })
      )
      if (!runStarted.created) {
        throw new ExecutionJournalCorruptionError(
          `Execution Journal deferred tool Run identity ${deferredRunId} was already committed.`
        )
      }
      runStartedCommitted = true
      observedRunStartedAt = readMonotonicNow(this.dependencies.diagnosticNow)
      notifyRunJournalObserver(this.dependencies.runJournalObserver, {
        type: 'started',
        runKind: 'deferred_tool',
        runId: deferredRunId,
        sessionId,
        messageId
      })

      throwIfAbortRequested(deferredAbortSignal)
      invoked = true
      onToolCallStarted?.()
      const result = await this.dependencies.toolExecutionPort.execute(request, {
        ...(toolSurfaceDeferredDispatch
          ? {
              runId: toolSurfaceDeferredDispatch.binding.request.runId,
              messageId: toolSurfaceDeferredDispatch.binding.request.messageId,
              requestSeq: toolSurfaceDeferredDispatch.binding.request.requestSeq,
              toolSurfaceDeferredDispatch
            }
          : executionContract
            ? {
                runId: executionContract.request.runId,
                messageId,
                requestSeq: executionContract.request.requestSeq
              }
            : {}),
        ...(executionContract ? { executionContract } : {}),
        ...(programmaticToolParent && programmaticToolCapability
          ? {
              programmaticToolCapability,
              programmaticToolParent
            }
          : {}),
        agentId: this.dependencies.identity.getAgentId(sessionId) ?? 'deepchat',
        permissionMode: sessionState.permissionMode,
        activeSkillNames: deferredActiveSkillNames,
        enabledMcpServerIds: this.dependencies.toolResolver.toToolDefinitionMcpServerIds(
          extensionPolicy.enabledMcpServerIds
        ),
        onProgress: (update) => {
          if (update.kind !== 'subagent_orchestrator' || update.toolCallId !== toolCallId) {
            return
          }

          this.dependencies.messageProjection.updateSubagentToolCallProgress(
            sessionId,
            messageId,
            toolCallId,
            update.responseMarkdown,
            update.progressJson
          )
        },
        commitDispatch: (input: ToolDispatchCommitInput) => {
          const receipt = commitExecutionJournalFact('dispatch_committed', () =>
            this.dependencies.executionJournal.commitDispatch({
              sessionId,
              messageId,
              operation: operation(),
              ...input
            })
          )
          if (!receipt.created) {
            throw new ExecutionJournalDuplicateDispatchError(operation())
          }
          dispatchCommitted = true
          programmaticToolParent?.armOuterDispatch({
            ...receipt,
            operation: programmaticToolParent.operation
          })
          onDispatchCommitted?.()
        },
        registerOutcomeProjection: (projection) => pendingOutcomeProjections.push(projection),
        commandShell,
        oneShotCommandGrantId,
        permissionLease,
        signal: deferredAbortSignal
      })
      let rawData = result.rawData as MCPToolResponse
      if (rawData.requiresPermission && dispatchCommitted) {
        if (programmaticToolParent) {
          throw new ExecutionJournalError(
            `Tool ${toolName} requested permission after Programmatic outer dispatch.`,
            'invalid_fact'
          )
        }
        const terminalError = `Tool ${toolName} requested permission after dispatch.`
        commitToolOutcome({ responseText: `Error: ${terminalError}`, isError: true })
        committedOutcomeProjection = {
          responseText: `Error: ${terminalError}`,
          isError: true,
          invoked
        }
        commitRunTerminal({
          outcome: 'error',
          stopReason: 'post_dispatch_permission',
          errorMessage: terminalError
        })
        return {
          responseText: `Error: ${terminalError}`,
          isError: true,
          invoked,
          terminalError
        }
      }
      returnedToolResponse = rawData.requiresPermission ? null : rawData
      throwIfAbortRequested(deferredAbortSignal)
      if (rawData.requiresPermission) {
        cancelProgrammaticParentBeforeDispatch()
        commitRunTerminal({ outcome: 'paused', stopReason: 'interaction' })
        return {
          responseText: toolContentToText(rawData.content),
          isError: true,
          invoked,
          requiresPermission: true,
          permissionRequest: rawData.permissionRequest as PendingToolInteraction['permission']
        }
      }
      if (programmaticToolParent) {
        try {
          programmaticCompletedResult = programmaticToolParent.takeCompletedInvocationResult()
        } catch (cause) {
          throw new ProgrammaticCommandLaunchError({ cause })
        }
        rawData = {
          toolCallId,
          content: programmaticCompletedResult.responseText,
          isError: programmaticCompletedResult.isError
        }
        returnedToolResponse = rawData
        programmaticToolParent.settleOuterOutcome({
          responseText: programmaticCompletedResult.responseText,
          isError: programmaticCompletedResult.isError
        })
        programmaticOuterOutcomeCommitted = true
      }
      const subagentToolResult =
        rawData.toolResult && typeof rawData.toolResult === 'object'
          ? (rawData.toolResult as Record<string, unknown>)
          : null
      if (typeof subagentToolResult?.subagentProgress === 'string') {
        const subagentProgress = subagentToolResult.subagentProgress
        const subagentFinal =
          typeof subagentToolResult.subagentFinal === 'string'
            ? subagentToolResult.subagentFinal
            : undefined
        pendingOutcomeProjections.push(() =>
          this.dependencies.messageProjection.updateSubagentToolCallProgress(
            sessionId,
            messageId,
            toolCallId,
            toolContentToText(rawData.content),
            subagentProgress,
            subagentFinal
          )
        )
      } else if (typeof subagentToolResult?.subagentFinal === 'string') {
        const subagentFinal = subagentToolResult.subagentFinal
        pendingOutcomeProjections.push(() =>
          this.dependencies.messageProjection.updateSubagentToolCallProgress(
            sessionId,
            messageId,
            toolCallId,
            toolContentToText(rawData.content),
            undefined,
            subagentFinal
          )
        )
      }
      const imagePreviews =
        rawData.imagePreviews ??
        (await extractToolCallImagePreviews({
          toolName,
          toolArgs: toolCall.params || '{}',
          content: rawData.content,
          cacheImage: this.dependencies.cacheImage,
          signal: deferredAbortSignal
        }))
      throwIfAbortRequested(deferredAbortSignal)
      const normalizedContent = await this.dependencies.toolResultPort.normalize({
        sessionId,
        toolCallId,
        toolName,
        toolArgs: toolCall.params || '{}',
        content: rawData.content,
        isError: rawData.isError === true,
        ownerPluginId: rawData.ownerPluginId,
        signal: deferredAbortSignal
      })
      throwIfAbortRequested(deferredAbortSignal)
      const responseText = toolContentToText(normalizedContent)
      const prepared = await awaitWithAbort(
        this.dependencies.toolResultPort.prepare({
          sessionId,
          toolCallId,
          toolName,
          rawContent: responseText
        }),
        deferredAbortSignal
      )
      throwIfAbortRequested(deferredAbortSignal)
      if (prepared.kind === 'tool_error') {
        commitToolOutcome({ responseText: prepared.message, isError: true })
        committedOutcomeProjection = {
          responseText: prepared.message,
          isError: true,
          invoked
        }
        commitRunTerminal({ outcome: 'completed', stopReason: 'tool_result' })
        return committedOutcomeProjection
      }
      const isError = Boolean(rawData.isError)
      commitToolOutcome({
        responseText: prepared.content,
        isError,
        ...(prepared.offloadPath === undefined ? {} : { offloadPath: prepared.offloadPath })
      })
      committedOutcomeProjection = {
        responseText: prepared.content,
        isError,
        invoked,
        toolSource: toolDefinition.source,
        serverName: toolDefinition.server.name,
        offloadPath: prepared.offloadPath,
        existingOffloadPath: rawData.outputOffloadPath,
        rtkApplied: rawData.rtkApplied,
        rtkMode: rawData.rtkMode,
        rtkFallbackReason: rawData.rtkFallbackReason,
        imagePreviews
      }
      commitRunTerminal({ outcome: 'completed', stopReason: 'tool_result' })
      return committedOutcomeProjection
    } catch (error) {
      if (programmaticToolParent && !dispatchCommitted) {
        cancelProgrammaticParentBeforeDispatch()
      }
      if (isProgrammaticCommandLaunchError(error) && isExecutionJournalError(error.cause)) {
        return settleFailClosed(error.cause)
      }
      if (
        programmaticToolParent &&
        dispatchCommitted &&
        isProgrammaticCommandLaunchError(error)
      ) {
        const responseText =
          'Error: Programmatic CLI process exited before authoritative completion.'
        try {
          const processResult = programmaticToolParent.settleProcessFailure({ responseText }).result
          outcomeCommitted = true
          committedOutcomeProjection = { ...processResult, invoked }
          commitRunTerminal({
            outcome: 'completed',
            stopReason: 'tool_result'
          })
          return committedOutcomeProjection
        } catch (settlementError) {
          return settleFailClosed(
            isExecutionJournalError(settlementError)
              ? settlementError
              : new ExecutionJournalError(
                  'Deferred Programmatic CLI failure could not settle its outer operation.',
                  'invalid_fact',
                  { cause: settlementError }
                )
          )
        }
      }
      if (isExecutionJournalError(error)) {
        return settleFailClosed(error)
      }
      if (deferredAbortSignal?.aborted) {
        try {
          if (returnedToolResponse && dispatchCommitted && !outcomeCommitted) {
            commitToolOutcome({
              responseText: toolContentToText(returnedToolResponse.content),
              isError: returnedToolResponse.isError === true
            })
          }
          if (runStartedCommitted && !terminalCommitAttempted) {
            commitRunTerminal({
              outcome: 'aborted',
              stopReason: 'user_stop',
              errorMessage: error instanceof Error ? error.message : String(error)
            })
          }
        } catch (journalError) {
          if (isExecutionJournalError(journalError)) {
            return settleFailClosed(journalError)
          }
          throw journalError
        }
        throw error
      }
      const errorText = error instanceof Error ? error.message : String(error)
      try {
        if (dispatchCommitted && !outcomeCommitted) {
          commitToolOutcome({ responseText: `Error: ${errorText}`, isError: true })
          committedOutcomeProjection = {
            responseText: `Error: ${errorText}`,
            isError: true,
            invoked
          }
        }
        if (runStartedCommitted && !terminalCommitAttempted) {
          commitRunTerminal(
            dispatchCommitted
              ? { outcome: 'completed', stopReason: 'tool_result' }
              : {
                  outcome: 'error',
                  stopReason: 'pre_dispatch_error',
                  errorMessage: errorText
                }
          )
        }
      } catch (journalError) {
        if (isExecutionJournalError(journalError)) {
          return settleFailClosed(journalError)
        }
        throw journalError
      }
      return {
        responseText: `Error: ${errorText}`,
        isError: true,
        invoked
      }
    } finally {
      this.dependencies.runLifecycle.clearDeferredToolController(
        sessionId,
        toolCallId,
        deferredAbortController ?? undefined
      )
    }
  }
}
