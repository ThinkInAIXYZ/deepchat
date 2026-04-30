import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { MCPToolDefinition } from '@shared/presenter'
import type { DeepChatSubagentSlot } from '@shared/types/agent-interface'
import type { AgentToolProgressUpdate } from '@shared/types/presenters/tool.presenter'
import type { AgentToolCallResult } from './agentToolManager'
import type { AgentToolRuntimePort, ConversationSessionInfo } from '../runtimePorts'

export const SUBAGENT_ORCHESTRATOR_TOOL_NAME = 'subagent_orchestrator'
const SUBAGENT_WORKDIR_RULE =
  'Every child session inherits the same working directory as the parent session.'
const SUBAGENT_PROMPT_DESCRIPTION = [
  'Describe only the delegated subtask itself.',
  'The child session uses the same working directory as the parent session.'
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
    timeoutMs: z.number().int().min(0).max(300000).optional()
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
  cancelRequested: boolean
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
  completion: Promise<void>
  abortController: AbortController
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
  const contract =
    params.task.expectedOutput?.trim() ||
    'Return a concise markdown result with your answer, key findings, and any important file paths or commands.'

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
    contract,
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

const isTerminalStatus = (status: SubagentTerminalStatus): boolean =>
  status === 'completed' || status === 'error' || status === 'cancelled'

export class SubagentOrchestratorTool {
  private readonly runs = new Map<string, MutableRunState>()

  constructor(private readonly runtimePort: AgentToolRuntimePort) {}

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
    run.status = this.resolveRunStatus(run.tasks)
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
        resultSummary: task.resultSummary
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
        isError: run.status === 'error',
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
        isError: run.status === 'error',
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
      run.abortController.abort()
      for (const task of run.tasks) {
        if (isTerminalStatus(task.status)) {
          continue
        }

        task.cancelRequested = true
        task.status = 'cancelled'
        task.resultSummary = task.resultSummary || 'Cancelled by parent session.'
        task.updatedAt = Date.now()
        task.completion.resolve()

        if (task.sessionId) {
          await this.runtimePort.cancelConversation(task.sessionId).catch(() => undefined)
        }
      }
      this.updateRunStatus(run)
      return this.buildRunProgressResult(run, 'Subagent run cancelled')
    }

    if (args.operation === 'wait') {
      const timeoutMs = args.timeoutMs ?? 60000
      if (!isTerminalStatus(run.status)) {
        await this.waitForRunCompletion(run, timeoutMs, options?.signal)
      }
      return isTerminalStatus(run.status)
        ? this.buildRunFinalResult(run)
        : this.buildRunProgressResult(run, 'Subagent run still active')
    }

    if (args.operation === 'log') {
      return this.buildRunFinalResult(run)
    }

    return this.buildRunProgressResult(run)
  }

  private async waitForRunCompletion(
    run: MutableRunState,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<void> {
    let abortListener: (() => void) | undefined
    const pending = [
      run.completion,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs)
      })
    ]

    if (signal) {
      if (signal.aborted) {
        throw new Error('subagent_orchestrator cancelled.')
      }

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
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener)
      }
    }
  }

  private async getAvailableSession(
    conversationId?: string
  ): Promise<ConversationSessionInfo | null> {
    if (!conversationId) {
      return null
    }

    const session = await this.runtimePort.resolveConversationSessionInfo(conversationId)
    if (!session) {
      return null
    }

    return session.agentType === 'deepchat' &&
      session.sessionKind === 'regular' &&
      session.subagentEnabled === true &&
      session.availableSubagentSlots.length > 0
      ? session
      : null
  }

  async isAvailable(conversationId?: string): Promise<boolean> {
    return Boolean(await this.getAvailableSession(conversationId))
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

  async getToolDefinition(conversationId?: string): Promise<MCPToolDefinition | null> {
    const session = await this.getAvailableSession(conversationId)
    if (!session) {
      return null
    }

    const slotIdParameter = this.buildSlotIdParameter(session.availableSubagentSlots)

    return {
      type: 'function',
      function: {
        name: SUBAGENT_ORCHESTRATOR_TOOL_NAME,
        description: `Delegate up to 5 tasks to configured subagents, run them in parallel or in chain mode, and return a single aggregated markdown result after every child session finishes. Use background=true for long-running subagent work, then use operation=list/info/log/wait/kill with the returned runId. ${SUBAGENT_WORKDIR_RULE}`,
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
                      'Optional output contract for the child session, such as structure, scope, or formatting requirements.'
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

    const parent = await this.runtimePort.resolveConversationSessionInfo(conversationId)
    if (!parent) {
      throw new Error(`Conversation not found: ${conversationId}`)
    }

    if (
      parent.agentType !== 'deepchat' ||
      parent.sessionKind !== 'regular' ||
      parent.subagentEnabled !== true
    ) {
      throw new Error(
        'subagent_orchestrator is only available in DeepChat regular sessions with subagents enabled.'
      )
    }

    if (args.operation !== 'run') {
      return this.handleRunOperation(args, conversationId, options)
    }

    const mode = args.mode ?? 'parallel'
    const taskSpecs = args.tasks ?? []
    const inheritedWorkspace =
      (await this.runtimePort.resolveConversationWorkdir(parent.sessionId))?.trim() ||
      parent.projectDir?.trim() ||
      null

    const slotMap = new Map(parent.availableSubagentSlots.map((slot) => [slot.id, slot]))
    const now = Date.now()
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
        cancelRequested: false,
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
      completion: Promise.resolve(),
      abortController
    }
    this.runs.set(runId, run)

    const emitProgress = () => {
      this.updateRunStatus(run)
      if (!options?.onProgress || run.background) {
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

    const unsubscribe = this.runtimePort.subscribeDeepChatSessionUpdates((update) => {
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

    const abortListener = () => {
      abortController.abort()
      for (const task of tasks) {
        if (isTerminalStatus(task.status)) {
          continue
        }

        task.cancelRequested = true
        task.updatedAt = Date.now()
        updateTaskStatusFromRuntime(task)

        if (task.sessionId) {
          void this.runtimePort.cancelConversation(task.sessionId).catch(() => undefined)
        }
      }

      emitProgress()
    }

    options?.signal?.addEventListener('abort', abortListener)

    const runTask = async (task: MutableTaskState): Promise<void> => {
      if (options?.signal?.aborted || abortController.signal.aborted) {
        abortListener()
        return
      }

      try {
        const child = await this.runtimePort.createSubagentSession({
          parentSessionId: parent.sessionId,
          agentId: task.targetAgentId || parent.agentId,
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

        if (options?.signal?.aborted || abortController.signal.aborted || task.cancelRequested) {
          task.cancelRequested = true
          task.updatedAt = Date.now()
          task.status = 'cancelled'
          task.resultSummary = task.resultSummary || 'Cancelled by parent session.'
          maybeResolveTask(task)
          await this.runtimePort.cancelConversation(child.sessionId).catch(() => undefined)
          emitProgress()
          return
        }

        task.sessionId = child.sessionId
        task.targetAgentName = child.agentName || task.targetAgentName
        task.updatedAt = Date.now()
        sessionTaskMap.set(child.sessionId, task)
        emitProgress()

        const handoff = buildHandoffMessage({
          parent,
          mode,
          totalTasks: tasks.length,
          task,
          inheritedWorkspace
        })
        await this.runtimePort.sendConversationMessage(child.sessionId, handoff)
        task.started = true
        task.updatedAt = Date.now()
        if (task.status === 'queued') {
          task.status = 'running'
        }
        emitProgress()

        await task.completion.promise
      } catch (error) {
        task.updatedAt = Date.now()
        task.status = task.cancelRequested ? 'cancelled' : 'error'
        task.resultSummary =
          error instanceof Error ? error.message : 'Subagent session failed unexpectedly.'
        maybeResolveTask(task)
        emitProgress()
      }
    }

    const runCompletion = (async () => {
      emitProgress()

      try {
        if (mode === 'parallel') {
          await Promise.all(tasks.map((task) => runTask(task)))
        } else {
          for (const task of tasks) {
            if (abortController.signal.aborted) {
              abortListener()
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
      } finally {
        this.updateRunStatus(run)
        emitProgress()
        unsubscribe()
        options?.signal?.removeEventListener('abort', abortListener)
        this.pruneRuns()
      }
    })()
    run.completion = runCompletion

    void runCompletion.catch(() => undefined)

    if (run.background) {
      return this.buildRunProgressResult(run, 'Subagent run started')
    }

    await runCompletion

    if (options?.signal?.aborted) {
      throw new Error('subagent_orchestrator cancelled.')
    }

    return this.buildRunFinalResult(run)
  }
}
