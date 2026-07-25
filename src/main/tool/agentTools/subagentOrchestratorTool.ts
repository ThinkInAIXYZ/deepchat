import { nanoid } from 'nanoid'
import { z } from 'zod'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import type { DeepChatSubagentSlot, SubagentTapeLinkOutcome } from '@shared/types/agent-interface'
import type { AgentToolProgressUpdate } from '@shared/types/tool'
import type { AgentToolCallResult } from './agentToolManager'
import type {
  AgentSubagentToolPort,
  AgentToolSessionPort,
  ConversationSessionInfo
} from '../runtimePorts'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import { SUBAGENT_ORCHESTRATOR_TOOL_NAME } from '@shared/agentTools'
import type { DeepChatSubagentCapability } from '@shared/types/agent-interface'
import { DEEPCHAT_SUBAGENT_MODEL_GUIDANCE } from '@shared/lib/deepchatSubagents'

export { SUBAGENT_ORCHESTRATOR_TOOL_NAME } from '@shared/agentTools'
const DEFAULT_RUN_TIMEOUT_MS = 300000
const MIN_RUN_TIMEOUT_MS = 1000
const MAX_RUN_TIMEOUT_MS = 1800000
const MAX_ACTIVE_RUNS_PER_PARENT = 3
const SUBAGENT_WORKDIR_RULE =
  'Every child session inherits the same working directory as the parent session.'
const SUBAGENT_PROMPT_DESCRIPTION = [
  'Describe only the delegated subtask itself.',
  'Keep its scope bounded and request concrete evidence or validation.',
  'The child session uses the same working directory as the parent session.',
  'When a child waits for permission or a question, open that child sessionId from progress to respond.'
].join(' ')

export const subagentOrchestratorTaskSchema = z.object({
  id: z.string().trim().min(1).optional(),
  slotId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  expectedOutput: z.string().trim().min(1).optional()
})

export const subagentOrchestratorSchema = z
  .object({
    operation: z.enum(['run', 'list', 'info', 'log', 'wait', 'kill']).default('run'),
    mode: z.enum(['parallel', 'chain']).optional(),
    tasks: z.array(subagentOrchestratorTaskSchema).min(1).max(5).optional(),
    background: z.boolean().default(false).optional(),
    runId: z.string().trim().min(1).optional(),
    timeoutMs: z.number().int().min(0).max(300000).optional(),
    runTimeoutMs: z.number().int().min(MIN_RUN_TIMEOUT_MS).max(MAX_RUN_TIMEOUT_MS).optional()
  })
  .superRefine((value, ctx) => {
    if (value.operation === 'run') {
      if (!value.mode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mode'],
          message: 'mode is required when operation is run.'
        })
      }
      if (!value.tasks?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tasks'],
          message: 'tasks is required when operation is run.'
        })
      }
      return
    }

    if (value.operation !== 'list' && !value.runId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['runId'],
        message: `runId is required when operation is ${value.operation}.`
      })
    }
  })

type SubagentOrchestratorArgs = z.infer<typeof subagentOrchestratorSchema>
type SubagentTerminalStatus =
  | 'completed'
  | 'error'
  | 'cancelled'
  | 'waiting_permission'
  | 'waiting_question'
  | 'running'
  | 'queued'

type MutableTaskState = {
  taskId: string
  index: number
  slotId: string
  title: string
  prompt: string
  expectedOutput?: string
  targetAgentId: string | null
  targetAgentName: string
  sessionId: string | null
  status: SubagentTerminalStatus
  previewMarkdown: string
  responseMarkdown: string
  updatedAt: number
  waitingInteraction: {
    type: 'permission' | 'question'
    messageId: string
    toolCallId: string
  } | null
  resultSummary?: string
  runtimeStatus?: 'idle' | 'generating' | 'error'
  started: boolean
  handoffSettled: boolean
  cancelRequested: boolean
  tapeFinalized: boolean
  tapeFinalizeError?: string
  tapeFinalizePromise?: Promise<void>
  cancellationPromise?: Promise<void>
  cancellationSettled: boolean
  completion: {
    promise: Promise<void>
    resolve: () => void
  }
}

type MutableRunState = {
  runId: string
  parentSessionId: string
  mode: NonNullable<SubagentOrchestratorArgs['mode']>
  background: boolean
  toolCallId: string
  tasks: MutableTaskState[]
  status: SubagentTerminalStatus
  createdAt: number
  updatedAt: number
  runTimeoutMs: number
  deadlineAt: number
  completion: Promise<void>
  abortController: AbortController
  executionSettled: boolean
  deadlineTimer?: ReturnType<typeof setTimeout>
  cancellationReason?: string
  error?: string
}

const createDeferred = (): MutableTaskState['completion'] => {
  let resolve = () => {}
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve
  })

  return {
    promise,
    resolve
  }
}

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

const summarizeResult = (value: string): string | undefined => {
  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  return truncate(normalized, 2000)
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const awaitWithSubagentCancellation = async <T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> => {
  try {
    return await awaitWithAbort(promise, signal)
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('subagent_orchestrator cancelled.')
    }
    throw error
  }
}

const hasTapeFinalizeError = (tasks: MutableTaskState[]): boolean =>
  tasks.some((task) => Boolean(task.tapeFinalizeError?.trim()))

const renderProgressMarkdown = (
  mode: NonNullable<SubagentOrchestratorArgs['mode']>,
  tasks: MutableTaskState[]
): string => {
  const lines: string[] = [`${mode} · ${tasks.length} subagents`, '']

  for (const task of tasks) {
    lines.push(`### ${task.index + 1}. ${task.title}`)
    lines.push(`- Agent: ${task.targetAgentName}`)
    lines.push(`- Status: ${task.status}`)
    if (task.sessionId) {
      lines.push(`- Session: \`${task.sessionId}\``)
    }
    if (task.status === 'waiting_permission' || task.status === 'waiting_question') {
      lines.push(
        `- Action required: open child session \`${task.sessionId ?? 'pending'}\` to respond (${task.status === 'waiting_permission' ? 'permission' : 'question'}).`
      )
      if (task.waitingInteraction) {
        lines.push(
          `- Waiting: ${task.waitingInteraction.type} · message \`${task.waitingInteraction.messageId}\` · tool \`${task.waitingInteraction.toolCallId}\``
        )
      }
    }
    if (task.tapeFinalizeError?.trim()) {
      lines.push(`- Tape Finalization: failed: ${task.tapeFinalizeError}`)
    }

    const previewLines = task.previewMarkdown
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    if (previewLines.length > 0) {
      lines.push('')
      for (const line of previewLines.slice(-3)) {
        lines.push(`> ${line}`)
      }
    }

    lines.push('')
  }

  return lines.join('\n').trim()
}

const renderFinalMarkdown = (
  mode: NonNullable<SubagentOrchestratorArgs['mode']>,
  tasks: MutableTaskState[]
): string => {
  const lines: string[] = [`${mode} · ${tasks.length} subagents`, '']

  for (const task of tasks) {
    lines.push(`## ${task.index + 1}. ${task.title}`)
    lines.push(`Subagent: ${task.targetAgentName}`)
    lines.push(`Child Session: \`${task.sessionId ?? 'unknown'}\``)
    lines.push(`Status: ${task.status}`)
    if (task.tapeFinalizeError?.trim()) {
      lines.push(`Tape Finalization: failed: ${task.tapeFinalizeError}`)
    }
    lines.push('')
    lines.push(task.resultSummary?.trim() || '_No result produced._')
    lines.push('')
  }

  return lines.join('\n').trim()
}

const buildHandoffMessage = (params: {
  parent: ConversationSessionInfo
  mode: NonNullable<SubagentOrchestratorArgs['mode']>
  totalTasks: number
  task: MutableTaskState
  inheritedWorkspace: string | null
}): string => {
  const contract = [
    'Return concise markdown with all of these sections:',
    '## Result',
    '## Evidence',
    '## Changed Files',
    '## Validation',
    '## Unresolved',
    'Use `None` as the section content when a section has no entries.'
  ]
  const additionalRequirements = params.task.expectedOutput?.trim()
    ? ['', 'Additional Requirements:', params.task.expectedOutput.trim()]
    : []

  return [
    '# Structured Handoff',
    '',
    'Parent Task Summary:',
    `- The parent session delegated this work through \`${SUBAGENT_ORCHESTRATOR_TOOL_NAME}\`.`,
    `- Orchestration mode: ${params.mode}.`,
    `- Total delegated tasks in this run: ${params.totalTasks}.`,
    '',
    'Current Subtask:',
    `Title: ${params.task.title}`,
    params.task.prompt,
    '',
    'Output Contract:',
    ...contract,
    ...additionalRequirements,
    '',
    'Current Agent Working Directory:',
    params.inheritedWorkspace?.trim() || '(none)',
    '',
    'Rules:',
    '- You are a child session with an isolated context.',
    '- Do not assume access to the full parent transcript.',
    '- Ask for permission or clarification through the normal tool flow when needed.'
  ].join('\n')
}

const isTerminalStatus = (status: SubagentTerminalStatus): status is SubagentTapeLinkOutcome =>
  status === 'completed' || status === 'error' || status === 'cancelled'

export class SubagentOrchestratorTool {
  private readonly runs = new Map<string, MutableRunState>()

  constructor(
    private readonly sessions: AgentToolSessionPort,
    private readonly subagents: AgentSubagentToolPort
  ) {}

  private resolveRunStatus(tasks: MutableTaskState[]): SubagentTerminalStatus {
    if (tasks.some((task) => task.status === 'waiting_permission')) {
      return 'waiting_permission'
    }
    if (tasks.some((task) => task.status === 'waiting_question')) {
      return 'waiting_question'
    }
    if (tasks.some((task) => task.status === 'running')) {
      return 'running'
    }
    if (tasks.some((task) => task.status === 'queued')) {
      return 'queued'
    }
    if (tasks.some((task) => task.status === 'error')) {
      return 'error'
    }
    if (tasks.some((task) => task.status === 'cancelled')) {
      return 'cancelled'
    }

    return 'completed'
  }

  private updateRunStatus(run: MutableRunState): void {
    run.status = run.cancellationReason ? 'cancelled' : this.resolveRunStatus(run.tasks)
    run.updatedAt = Date.now()
  }

  private serializeRun(run: MutableRunState) {
    return {
      runId: run.runId,
      mode: run.mode,
      background: run.background,
      parentSessionId: run.parentSessionId,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      runTimeoutMs: run.runTimeoutMs,
      deadlineAt: run.deadlineAt,
      cancellationReason: run.cancellationReason,
      error: run.error,
      tasks: run.tasks.map((task) => ({
        taskId: task.taskId,
        title: task.title,
        slotId: task.slotId,
        sessionId: task.sessionId,
        targetAgentId: task.targetAgentId,
        targetAgentName: task.targetAgentName,
        status: task.status,
        previewMarkdown: task.previewMarkdown,
        updatedAt: task.updatedAt,
        waitingInteraction: task.waitingInteraction,
        resultSummary: task.resultSummary,
        tapeFinalized: task.tapeFinalized,
        tapeFinalizeError: task.tapeFinalizeError
      }))
    }
  }

  private renderRunListMarkdown(parentSessionId: string): string {
    const runs = [...this.runs.values()]
      .filter((run) => run.parentSessionId === parentSessionId)
      .sort((left, right) => right.createdAt - left.createdAt)

    if (runs.length === 0) {
      return 'No subagent runs found for this session.'
    }

    const lines = ['Subagent runs:', '']
    for (const run of runs) {
      lines.push(
        `- \`${run.runId}\` · ${run.status} · ${run.mode} · ${run.tasks.length} task${run.tasks.length === 1 ? '' : 's'}`
      )
    }

    return lines.join('\n')
  }

  private getRunForSession(parentSessionId: string, runId?: string): MutableRunState {
    const normalizedRunId = runId?.trim()
    if (!normalizedRunId) {
      throw new Error('runId is required.')
    }

    const run = this.runs.get(normalizedRunId)
    if (!run || run.parentSessionId !== parentSessionId) {
      throw new Error(`Subagent run not found: ${normalizedRunId}`)
    }

    return run
  }

  private buildRunProgressResult(
    run: MutableRunState,
    label = 'Subagent run status'
  ): AgentToolCallResult {
    const content = [
      `${label}: \`${run.runId}\``,
      `Status: ${run.status}`,
      '',
      renderProgressMarkdown(run.mode, run.tasks)
    ].join('\n')

    return {
      content,
      rawData: {
        content,
        isError: run.status === 'error' || hasTapeFinalizeError(run.tasks),
        toolResult: {
          subagentProgress: JSON.stringify(this.serializeRun(run))
        }
      }
    }
  }

  private buildRunFinalResult(run: MutableRunState): AgentToolCallResult {
    const finalProgress = this.serializeRun(run)
    const finalMarkdown = renderFinalMarkdown(run.mode, run.tasks)

    return {
      content: finalMarkdown,
      rawData: {
        content: finalMarkdown,
        isError: run.status === 'error' || hasTapeFinalizeError(run.tasks),
        toolResult: {
          subagentFinal: JSON.stringify(finalProgress),
          subagentProgress: JSON.stringify(finalProgress)
        }
      }
    }
  }

  private pruneRuns(): void {
    const completedRuns = [...this.runs.values()]
      .filter((run) => isTerminalStatus(run.status))
      .sort((left, right) => right.updatedAt - left.updatedAt)

    for (const run of completedRuns.slice(20)) {
      this.runs.delete(run.runId)
    }
  }

  private markTaskCancelled(task: MutableTaskState, reason: string): void {
    task.cancelRequested = true
    task.status = 'cancelled'
    task.resultSummary = task.resultSummary || reason
    task.updatedAt = Date.now()
    task.completion.resolve()
  }

  private isTaskCancellationRequested(
    run: MutableRunState,
    task: MutableTaskState,
    parentSignal?: AbortSignal
  ): boolean {
    return (
      parentSignal?.aborted === true || run.abortController.signal.aborted || task.cancelRequested
    )
  }

  private requestTaskCancellation(
    task: MutableTaskState,
    forceNewRequest = false
  ): Promise<void> | undefined {
    const childSessionId = task.sessionId
    if (!childSessionId) {
      return undefined
    }

    if (task.cancellationPromise && !forceNewRequest) {
      return task.cancellationPromise
    }

    const previousCancellation = task.cancellationPromise
    const currentCancellation = (async () => {
      try {
        await this.subagents.cancelConversation(childSessionId)
      } catch {
        // Cancellation is best effort, but tape finalization must still observe its settlement.
      }
    })()

    task.cancellationSettled = false
    let combinedCancellation: Promise<void>
    combinedCancellation = Promise.all(
      previousCancellation ? [previousCancellation, currentCancellation] : [currentCancellation]
    )
      .then(() => undefined)
      .finally(() => {
        if (task.cancellationPromise === combinedCancellation) {
          task.cancellationSettled = true
        }
      })
    task.cancellationPromise = combinedCancellation
    return combinedCancellation
  }

  private async cancelRun(run: MutableRunState, reason: string): Promise<void> {
    run.abortController.abort()
    if (!run.executionSettled) {
      run.cancellationReason = run.cancellationReason || reason
    }

    const cancellationRequests: Promise<void>[] = []
    for (const task of run.tasks) {
      if (isTerminalStatus(task.status)) {
        continue
      }

      this.markTaskCancelled(task, reason)

      const cancellationRequest = this.requestTaskCancellation(task)
      if (cancellationRequest) {
        cancellationRequests.push(cancellationRequest)
      }
    }

    this.updateRunStatus(run)
    await Promise.all(cancellationRequests)
  }

  private async cancelAndFinalizeTask(params: {
    run: MutableRunState
    task: MutableTaskState
    reason: string
    forceNewCancellation?: boolean
  }): Promise<void> {
    const { run, task, reason, forceNewCancellation = false } = params
    this.markTaskCancelled(task, reason)

    const cancellationRequest = this.requestTaskCancellation(task, forceNewCancellation)
    if (cancellationRequest) {
      await cancellationRequest
    }

    await this.finalizeTaskTape({
      parentSessionId: run.parentSessionId,
      runId: run.runId,
      task
    })
  }

  private async finalizeTaskTape(params: {
    parentSessionId: string
    runId: string
    task: MutableTaskState
  }): Promise<void> {
    const { parentSessionId, runId, task } = params
    if (
      !task.sessionId ||
      task.tapeFinalized ||
      !isTerminalStatus(task.status) ||
      (task.status === 'cancelled' &&
        (!task.handoffSettled || (task.cancellationPromise && !task.cancellationSettled)))
    ) {
      return
    }

    if (task.tapeFinalizePromise) {
      await task.tapeFinalizePromise
      return
    }

    const childSessionId = task.sessionId
    const input = {
      parentSessionId,
      childSessionId,
      runId,
      taskId: task.taskId,
      slotId: task.slotId,
      taskTitle: task.title,
      outcome: task.status,
      resultSummary: task.resultSummary ?? null
    }

    task.tapeFinalizePromise = (async () => {
      try {
        if (typeof this.subagents.linkSubagentTape !== 'function') {
          throw new Error('Subagent Tape link capability is unavailable.')
        }
        const receipt = await this.subagents.linkSubagentTape(input)
        if (
          receipt.linkEntry.sessionId !== parentSessionId ||
          !Number.isSafeInteger(receipt.linkEntry.entryId) ||
          receipt.linkEntry.entryId <= 0 ||
          receipt.childSessionId !== childSessionId ||
          !Number.isSafeInteger(receipt.childHeadEntryId) ||
          receipt.childHeadEntryId < 0 ||
          !Number.isSafeInteger(receipt.childEntryCount) ||
          receipt.childEntryCount < 0 ||
          receipt.childEntryCount > receipt.childHeadEntryId ||
          receipt.outcome !== input.outcome
        ) {
          throw new Error('Subagent Tape link receipt does not match the finalized task.')
        }
        task.tapeFinalized = true
        task.tapeFinalizeError = undefined
      } catch (error) {
        task.tapeFinalizeError = errorMessage(error)
        console.warn('[SubagentOrchestratorTool] Failed to link finalized subagent Tape:', {
          parentSessionId,
          childSessionId: task.sessionId,
          status: task.status,
          error
        })
      } finally {
        task.tapeFinalizePromise = undefined
      }
    })()

    await task.tapeFinalizePromise
  }

  private async retryPendingTapeFinalization(run: MutableRunState): Promise<void> {
    for (const task of run.tasks) {
      if (!task.sessionId || task.tapeFinalized || !isTerminalStatus(task.status)) {
        continue
      }

      const finalization = {
        parentSessionId: run.parentSessionId,
        runId: run.runId,
        task
      }

      if (!run.executionSettled) {
        // A terminal task can freeze independently while sibling tasks remain active. Keep polling
        // non-blocking; finalizeTaskTape deduplicates in-flight work and guards cancellation settlement.
        void this.finalizeTaskTape(finalization)
          .then(() => this.updateRunStatus(run))
          .catch(() => undefined)
        continue
      }

      await this.finalizeTaskTape(finalization)
    }

    this.updateRunStatus(run)
  }

  private async handleRunOperation(
    args: SubagentOrchestratorArgs,
    conversationId: string,
    options?: {
      signal?: AbortSignal
    }
  ): Promise<AgentToolCallResult> {
    if (args.operation === 'list') {
      const content = this.renderRunListMarkdown(conversationId)
      const runs = [...this.runs.values()]
        .filter((run) => run.parentSessionId === conversationId)
        .map((run) => this.serializeRun(run))

      return {
        content,
        rawData: {
          content,
          isError: false,
          toolResult: {
            ok: true,
            summary: `Found ${runs.length} subagent run${runs.length === 1 ? '' : 's'}.`,
            data: { runs },
            meta: { resultCount: runs.length }
          }
        }
      }
    }

    const run = this.getRunForSession(conversationId, args.runId)

    if (args.operation === 'kill') {
      await this.cancelRun(run, 'Cancelled by parent session.')
      return this.buildRunProgressResult(run, 'Subagent run cancelled')
    }

    if (args.operation === 'wait') {
      const timeoutMs = args.timeoutMs ?? 60000
      if (!isTerminalStatus(run.status)) {
        await this.waitForRunCompletion(run, timeoutMs, options?.signal)
      }
      await this.retryPendingTapeFinalization(run)
      return isTerminalStatus(run.status)
        ? this.buildRunFinalResult(run)
        : this.buildRunProgressResult(run, 'Subagent run still active')
    }

    if (args.operation === 'log') {
      await this.retryPendingTapeFinalization(run)
      return this.buildRunFinalResult(run)
    }

    if (args.operation === 'info') {
      await this.retryPendingTapeFinalization(run)
    }

    return this.buildRunProgressResult(run)
  }

  private async waitForRunCompletion(
    run: MutableRunState,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) {
      throw new Error('subagent_orchestrator cancelled.')
    }

    let abortListener: (() => void) | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const pending = [
      run.completion,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs)
      })
    ]

    if (signal) {
      pending.push(
        new Promise<void>((_, reject) => {
          abortListener = () => {
            reject(new Error('subagent_orchestrator cancelled.'))
          }
          signal.addEventListener('abort', abortListener, { once: true })
        })
      )
    }

    try {
      await Promise.race(pending)
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener)
      }
    }
  }

  private buildSlotIdParameter(slots: DeepChatSubagentSlot[]) {
    const normalizedSlots = [...slots]
      .map((slot) => ({
        ...slot,
        id: slot.id.trim(),
        displayName: slot.displayName.trim(),
        description: slot.description.trim(),
        targetAgentId: slot.targetAgentId?.trim()
      }))
      .filter((slot) => Boolean(slot.id))
      .sort((left, right) => {
        return (
          left.id.localeCompare(right.id) ||
          left.displayName.localeCompare(right.displayName) ||
          (left.targetAgentId ?? '').localeCompare(right.targetAgentId ?? '')
        )
      })

    const slotIds = Array.from(new Set(normalizedSlots.map((slot) => slot.id)))

    const slotLines = normalizedSlots.map((slot) => {
      const target =
        slot.targetType === 'self'
          ? 'current agent'
          : (slot.targetAgentId?.trim() ?? 'configured agent')
      const summaryParts = [`${slot.id}: ${slot.displayName || slot.id}`, `target=${target}`]
      if (slot.description) {
        const description = slot.description.trim()
        summaryParts.push(description)
      }

      return `- ${summaryParts.join(' | ')}`
    })

    const description =
      slotLines.length > 0
        ? ['Use one of the configured subagent slot IDs for this session.', ...slotLines].join('\n')
        : 'Use one of the configured subagent slot IDs for this session.'

    return slotIds.length > 0
      ? {
          type: 'string',
          enum: slotIds,
          description
        }
      : {
          type: 'string',
          description
        }
  }

  getToolDefinition(capability?: DeepChatSubagentCapability): MCPToolDefinition | null {
    if (!capability?.available) {
      return null
    }

    const slotIdParameter = this.buildSlotIdParameter(capability.slots)

    return {
      execution: TOOL_EXECUTION.write,
      type: 'function',
      function: {
        name: SUBAGENT_ORCHESTRATOR_TOOL_NAME,
        description: `Delegate up to 5 tasks to configured Subagents and aggregate their results. ${DEEPCHAT_SUBAGENT_MODEL_GUIDANCE} Use parallel mode only for independent tasks and chain mode when later tasks depend on earlier results. Use background=true for long-running work, then use operation=list/info/log/wait/kill with the returned runId. ${SUBAGENT_WORKDIR_RULE}`,
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['run', 'list', 'info', 'log', 'wait', 'kill'],
              description:
                'Use run to start tasks. Use list/info/log/wait/kill to manage background runs.'
            },
            mode: {
              type: 'string',
              enum: ['parallel', 'chain'],
              description:
                'Required for operation=run. Choose whether delegated tasks run concurrently or one by one.'
            },
            tasks: {
              type: 'array',
              maxItems: 5,
              description: `Required for operation=run. Ordered delegated subtasks. ${SUBAGENT_WORKDIR_RULE}`,
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    description: 'Optional stable task identifier for this orchestrator run.'
                  },
                  slotId: slotIdParameter,
                  title: {
                    type: 'string',
                    description:
                      'Short task label shown in progress cards and the final aggregate result.'
                  },
                  prompt: {
                    type: 'string',
                    description: SUBAGENT_PROMPT_DESCRIPTION
                  },
                  expectedOutput: {
                    type: 'string',
                    description:
                      'Optional requirements appended to the standard child output contract.'
                  }
                },
                required: ['slotId', 'title', 'prompt']
              }
            },
            background: {
              type: 'boolean',
              description:
                'When true, start operation=run in the background and return a runId immediately.'
            },
            runId: {
              type: 'string',
              description: 'Required for operation=info, log, wait, or kill.'
            },
            timeoutMs: {
              type: 'number',
              description: 'Maximum wait time for operation=wait. Defaults to 60000.'
            },
            runTimeoutMs: {
              type: 'number',
              minimum: MIN_RUN_TIMEOUT_MS,
              maximum: MAX_RUN_TIMEOUT_MS,
              description:
                'Maximum lifetime for operation=run, independent of wait timeout. Defaults to 300000.'
            }
          }
        }
      },
      server: {
        name: 'agent-subagents',
        icons: '🧩',
        description: 'DeepChat subagent orchestration'
      }
    }
  }

  async call(
    rawArgs: Record<string, unknown>,
    conversationId: string | undefined,
    options?: {
      toolCallId?: string
      onProgress?: (update: AgentToolProgressUpdate) => void
      signal?: AbortSignal
    }
  ): Promise<AgentToolCallResult> {
    const args = subagentOrchestratorSchema.parse(rawArgs)
    if (!conversationId) {
      throw new Error('subagent_orchestrator requires a conversationId.')
    }

    if (options?.signal?.aborted) {
      throw new Error('subagent_orchestrator cancelled.')
    }

    const parent = await awaitWithSubagentCancellation(
      this.sessions.resolveConversationSessionInfo(conversationId),
      options?.signal
    )
    if (!parent) {
      throw new Error(`Conversation not found: ${conversationId}`)
    }

    if (
      parent.agentType !== 'deepchat' ||
      parent.sessionKind !== 'regular' ||
      !parent.subagentCapability.available
    ) {
      const reason = parent.subagentCapability.available
        ? 'unsupported_session'
        : parent.subagentCapability.reason
      throw new Error(`subagent_orchestrator is unavailable for the current session (${reason}).`)
    }
    const subagentCapability = parent.subagentCapability

    if (args.operation !== 'run') {
      return this.handleRunOperation(args, conversationId, options)
    }

    const mode = args.mode ?? 'parallel'
    const taskSpecs = args.tasks ?? []
    const inheritedWorkspace =
      (
        await awaitWithSubagentCancellation(
          this.sessions.resolveConversationWorkdir(parent.sessionId),
          options?.signal
        )
      )?.trim() ||
      parent.projectDir?.trim() ||
      null

    const activeRunCount = [...this.runs.values()].filter(
      (run) => run.parentSessionId === conversationId && !isTerminalStatus(run.status)
    ).length
    if (activeRunCount >= MAX_ACTIVE_RUNS_PER_PARENT) {
      throw new Error(
        `A parent session can have at most ${MAX_ACTIVE_RUNS_PER_PARENT} active subagent runs.`
      )
    }

    const slotMap = new Map(subagentCapability.slots.map((slot) => [slot.id, slot]))
    const now = Date.now()
    const runTimeoutMs = args.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS
    const tasks = taskSpecs.map((task, index): MutableTaskState => {
      const slot = slotMap.get(task.slotId)
      if (!slot) {
        throw new Error(`Subagent slot not found or not enabled: ${task.slotId}`)
      }

      const targetAgentId =
        slot.targetType === 'self' ? parent.agentId : (slot.targetAgentId?.trim() ?? null)
      if (!targetAgentId) {
        throw new Error(`Subagent slot is missing a target agent: ${task.slotId}`)
      }

      return {
        taskId: task.id?.trim() || `task-${index + 1}`,
        index,
        slotId: task.slotId,
        title: task.title,
        prompt: task.prompt,
        expectedOutput: task.expectedOutput,
        targetAgentId,
        targetAgentName: slot.displayName || targetAgentId,
        sessionId: null,
        status: 'queued',
        previewMarkdown: '',
        responseMarkdown: '',
        updatedAt: now,
        waitingInteraction: null,
        started: false,
        handoffSettled: false,
        cancelRequested: false,
        tapeFinalized: false,
        cancellationSettled: false,
        completion: createDeferred()
      }
    })

    const runId = nanoid()
    const toolCallId = options?.toolCallId || ''
    const sessionTaskMap = new Map<string, MutableTaskState>()
    const abortController = new AbortController()
    const run: MutableRunState = {
      runId,
      parentSessionId: conversationId,
      mode,
      background: args.background === true,
      toolCallId,
      tasks,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      runTimeoutMs,
      deadlineAt: now + runTimeoutMs,
      completion: Promise.resolve(),
      abortController,
      executionSettled: false
    }
    this.runs.set(runId, run)

    let lifecycleSettled = false
    const emitProgress = () => {
      this.updateRunStatus(run)
      if (lifecycleSettled || !options?.onProgress || run.background) {
        return
      }

      options.onProgress({
        kind: 'subagent_orchestrator',
        toolCallId,
        responseMarkdown: renderProgressMarkdown(mode, tasks),
        progressJson: JSON.stringify(this.serializeRun(run))
      })
    }

    const maybeResolveTask = (task: MutableTaskState) => {
      if (isTerminalStatus(task.status)) {
        task.completion.resolve()
      }
    }

    const updateTaskStatusFromRuntime = (task: MutableTaskState) => {
      if (task.cancelRequested) {
        task.status = 'cancelled'
        task.resultSummary = task.resultSummary || 'Cancelled by parent session.'
        maybeResolveTask(task)
        return
      }

      if (task.waitingInteraction?.type === 'permission') {
        task.status = 'waiting_permission'
        return
      }

      if (task.waitingInteraction?.type === 'question') {
        task.status = 'waiting_question'
        return
      }

      if (task.runtimeStatus === 'error') {
        task.status = 'error'
        task.resultSummary =
          task.resultSummary || summarizeResult(task.responseMarkdown) || 'Child session failed.'
        maybeResolveTask(task)
        return
      }

      if (task.runtimeStatus === 'idle' && task.started) {
        task.status = 'completed'
        task.resultSummary =
          summarizeResult(task.responseMarkdown) || task.resultSummary || 'Completed.'
        maybeResolveTask(task)
        return
      }

      if (task.started) {
        task.status = 'running'
      }
    }

    const unsubscribe = this.subagents.subscribeSessionRuntimeUpdates((update) => {
      const task = sessionTaskMap.get(update.sessionId)
      if (!task) {
        return
      }

      task.updatedAt = update.updatedAt

      if (update.kind === 'blocks') {
        task.previewMarkdown = truncate(update.previewMarkdown?.trim() || '', 600)
        task.responseMarkdown = truncate(update.responseMarkdown?.trim() || '', 12000)
        task.waitingInteraction = update.waitingInteraction ?? null
      } else if (update.kind === 'status' && update.status) {
        task.runtimeStatus = update.status
      }

      updateTaskStatusFromRuntime(task)
      emitProgress()
    })

    let resolveParentCancellation: (() => void) | undefined
    const parentCancellation = options?.signal
      ? new Promise<void>((resolve) => {
          resolveParentCancellation = resolve
        })
      : undefined
    let parentCancellationObserved = false
    const abortListener = () => {
      if (parentCancellationObserved) {
        return
      }

      parentCancellationObserved = true
      void this.cancelRun(run, 'Cancelled by parent session.')
      emitProgress()
      resolveParentCancellation?.()
    }

    options?.signal?.addEventListener('abort', abortListener, { once: true })
    if (options?.signal?.aborted) {
      abortListener()
    }

    const runTask = async (task: MutableTaskState): Promise<void> => {
      if (options?.signal?.aborted) {
        abortListener()
      }
      if (this.isTaskCancellationRequested(run, task, options?.signal)) {
        return
      }

      let handoffAttempted = false
      try {
        const child = await this.subagents.createSubagentSession({
          parentSessionId: parent.sessionId,
          agentId: task.targetAgentId || parent.agentId,
          parentAgentId: parent.agentId,
          slotId: task.slotId,
          displayName: task.targetAgentName,
          targetAgentId: task.targetAgentId,
          projectDir: inheritedWorkspace,
          providerId: parent.providerId,
          modelId: parent.modelId,
          permissionMode: parent.permissionMode,
          generationSettings: parent.generationSettings ?? undefined,
          disabledAgentTools: parent.disabledAgentTools,
          activeSkills: parent.activeSkills
        })

        if (!child) {
          throw new Error(`Failed to create subagent session for slot ${task.slotId}.`)
        }

        task.sessionId = child.sessionId
        task.targetAgentName = child.agentName || task.targetAgentName
        task.updatedAt = Date.now()
        sessionTaskMap.set(child.sessionId, task)

        if (this.isTaskCancellationRequested(run, task, options?.signal)) {
          task.handoffSettled = true
          await this.cancelAndFinalizeTask({
            run,
            task,
            reason: run.cancellationReason || 'Cancelled by parent session.'
          })
          emitProgress()
          return
        }

        emitProgress()

        const handoff = buildHandoffMessage({
          parent,
          mode,
          totalTasks: tasks.length,
          task,
          inheritedWorkspace
        })
        handoffAttempted = true
        await this.subagents.sendConversationMessage(child.sessionId, handoff)
        task.handoffSettled = true

        if (options?.signal?.aborted) {
          abortListener()
        }
        if (this.isTaskCancellationRequested(run, task, options?.signal)) {
          await this.cancelAndFinalizeTask({
            run,
            task,
            reason: run.cancellationReason || 'Cancelled by parent session.',
            forceNewCancellation: true
          })
          emitProgress()
          return
        }

        task.started = true
        task.updatedAt = Date.now()
        if (task.status === 'queued') {
          task.status = 'running'
        }
        updateTaskStatusFromRuntime(task)
        emitProgress()

        await task.completion.promise
        await task.cancellationPromise
        await this.finalizeTaskTape({
          parentSessionId: parent.sessionId,
          runId,
          task
        })
      } catch (error) {
        task.updatedAt = Date.now()
        task.handoffSettled = true
        if (options?.signal?.aborted) {
          abortListener()
        }

        if (this.isTaskCancellationRequested(run, task, options?.signal)) {
          await this.cancelAndFinalizeTask({
            run,
            task,
            reason: run.cancellationReason || 'Cancelled by parent session.',
            forceNewCancellation: handoffAttempted
          })
        } else {
          task.status = 'error'
          task.resultSummary =
            error instanceof Error ? error.message : 'Subagent session failed unexpectedly.'
          maybeResolveTask(task)
          await this.finalizeTaskTape({
            parentSessionId: parent.sessionId,
            runId,
            task
          })
        }
        emitProgress()
      }
    }

    const execution = (async () => {
      emitProgress()

      try {
        if (mode === 'parallel') {
          await Promise.all(tasks.map((task) => runTask(task)))
        } else {
          for (const task of tasks) {
            if (abortController.signal.aborted) {
              break
            }
            await runTask(task)
          }
        }
      } catch (error) {
        run.error = error instanceof Error ? error.message : String(error)
        for (const task of tasks) {
          if (isTerminalStatus(task.status)) {
            continue
          }
          task.status = abortController.signal.aborted ? 'cancelled' : 'error'
          task.resultSummary = run.error
          task.updatedAt = Date.now()
          task.completion.resolve()
        }
      }
    })().finally(() => {
      run.executionSettled = true
    })

    const deadline = new Promise<void>((resolve) => {
      run.deadlineTimer = setTimeout(() => {
        const reason = `Run deadline exceeded after ${run.runTimeoutMs}ms.`
        void this.cancelRun(run, reason)
        resolve()
      }, run.runTimeoutMs)
    })
    const lifecycleEvents = [execution, deadline]
    if (parentCancellation) {
      lifecycleEvents.push(parentCancellation)
    }
    const runCompletion = Promise.race(lifecycleEvents).finally(() => {
      if (run.deadlineTimer !== undefined) {
        clearTimeout(run.deadlineTimer)
        run.deadlineTimer = undefined
      }
      this.updateRunStatus(run)
      emitProgress()
      lifecycleSettled = true
      unsubscribe()
      options?.signal?.removeEventListener('abort', abortListener)
      this.pruneRuns()
    })

    run.completion = runCompletion

    void runCompletion.catch(() => undefined)

    if (run.background) {
      return this.buildRunProgressResult(run, 'Subagent run started')
    }

    await runCompletion

    await this.retryPendingTapeFinalization(run)

    if (options?.signal?.aborted) {
      throw new Error('subagent_orchestrator cancelled.')
    }

    return this.buildRunFinalResult(run)
  }
}
