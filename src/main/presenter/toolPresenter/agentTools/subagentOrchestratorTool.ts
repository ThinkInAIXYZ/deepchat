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

export const subagentOrchestratorSchema = z.object({
  mode: z.enum(['parallel', 'chain']),
  tasks: z.array(subagentOrchestratorTaskSchema).min(1).max(5)
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
  slotDescription: string
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
  mode: SubagentOrchestratorArgs['mode'],
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
  mode: SubagentOrchestratorArgs['mode'],
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
  mode: SubagentOrchestratorArgs['mode']
  totalTasks: number
  task: MutableTaskState
}): string => {
  const contract =
    params.task.expectedOutput?.trim() ||
    'Return a concise markdown result with your answer, key findings, and any important file paths or commands.'
  const inheritedWorkspace = params.parent.projectDir?.trim() || '(none)'

  return [
    '# Structured Handoff',
    '',
    'Parent Task Summary:',
    `- The parent session delegated this work through \`${SUBAGENT_ORCHESTRATOR_TOOL_NAME}\`.`,
    `- Orchestration mode: ${params.mode}.`,
    `- Total delegated tasks in this run: ${params.totalTasks}.`,
    '',
    'Slot Description:',
    params.task.slotDescription || 'No additional slot description provided.',
    '',
    'Current Subtask:',
    `Title: ${params.task.title}`,
    params.task.prompt,
    '',
    'Output Contract:',
    contract,
    '',
    'Current Agent Working Directory:',
    inheritedWorkspace,
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
  constructor(private readonly runtimePort: AgentToolRuntimePort) {}

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
        description: `Delegate up to 5 tasks to configured subagents, run them in parallel or in chain mode, and return a single aggregated markdown result after every child session finishes. ${SUBAGENT_WORKDIR_RULE}`,
        parameters: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['parallel', 'chain'],
              description: 'Choose whether delegated tasks run concurrently or one by one.'
            },
            tasks: {
              type: 'array',
              maxItems: 5,
              description: `Ordered delegated subtasks. ${SUBAGENT_WORKDIR_RULE}`,
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
            }
          },
          required: ['mode', 'tasks']
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

    const slotMap = new Map(parent.availableSubagentSlots.map((slot) => [slot.id, slot]))
    const now = Date.now()
    const tasks = args.tasks.map((task, index): MutableTaskState => {
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
        slotDescription: slot.description || '',
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

    const emitProgress = () => {
      if (!options?.onProgress) {
        return
      }

      const progressPayload = {
        runId,
        mode: args.mode,
        tasks: tasks.map((task) => ({
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

      options.onProgress({
        kind: 'subagent_orchestrator',
        toolCallId,
        responseMarkdown: renderProgressMarkdown(args.mode, tasks),
        progressJson: JSON.stringify(progressPayload)
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
      if (options?.signal?.aborted) {
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
          projectDir: parent.projectDir,
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
        emitProgress()

        const handoff = buildHandoffMessage({
          parent,
          mode: args.mode,
          totalTasks: tasks.length,
          task
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

    emitProgress()

    try {
      if (args.mode === 'parallel') {
        await Promise.all(tasks.map((task) => runTask(task)))
      } else {
        for (const task of tasks) {
          await runTask(task)
        }
      }
    } finally {
      unsubscribe()
      options?.signal?.removeEventListener('abort', abortListener)
    }

    if (options?.signal?.aborted) {
      throw new Error('subagent_orchestrator cancelled.')
    }

    const finalProgress = {
      runId,
      mode: args.mode,
      tasks: tasks.map((task) => ({
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
    const finalMarkdown = renderFinalMarkdown(args.mode, tasks)

    return {
      content: finalMarkdown,
      rawData: {
        content: finalMarkdown,
        isError: tasks.some((task) => task.status === 'error'),
        toolResult: {
          subagentFinal: JSON.stringify(finalProgress),
          subagentProgress: JSON.stringify(finalProgress)
        }
      }
    }
  }
}
