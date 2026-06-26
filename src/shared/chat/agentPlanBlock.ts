import type { AssistantMessageBlock } from '../types/agent-interface'
import type {
  AgentPlanDisplayItem,
  AgentPlanItem,
  AgentPlanSnapshot,
  AgentPlanTerminalReason
} from '../types/agent-plan'
import { UPDATE_PLAN_TOOL_NAME } from '../types/agent-plan'
import {
  normalizeAgentPlanEntries,
  normalizeAgentPlanStatus,
  normalizeAgentPlanTerminalReason
} from '../types/agent-plan-block'

export {
  normalizeAgentPlanEntry,
  normalizeAgentPlanEntries,
  normalizeAgentPlanStatus,
  normalizeAgentPlanTerminalReason,
  snapshotFromAgentPlanBlock,
  type AgentPlanBlockLike,
  type AgentPlanHydratedSnapshot
} from '../types/agent-plan-block'

type AgentPlanBlockFields = {
  plan: AgentPlanItem[]
  explanation?: string
  revision: number
  updatedAt: string
  terminalReason?: AgentPlanTerminalReason
}

type UpsertAgentPlanBlockOptions = {
  toolCallId?: string
}

function toPlanBlockEntries(plan: AgentPlanItem[]): AgentPlanDisplayItem[] {
  return plan.map((entry) => ({
    step: entry.step,
    status: normalizeAgentPlanStatus(entry.status)
  }))
}

function applyPlanBlockFields(block: AssistantMessageBlock, fields: AgentPlanBlockFields): void {
  block.type = 'plan'
  block.content = fields.explanation ?? ''
  block.status = 'success'
  block.extra = {
    ...block.extra,
    plan_entries: toPlanBlockEntries(fields.plan),
    ...(fields.explanation ? { plan_explanation: fields.explanation } : {}),
    plan_revision: fields.revision,
    plan_updated_at: fields.updatedAt,
    ...(fields.terminalReason ? { plan_terminal_reason: fields.terminalReason } : {})
  }
}

export function createAgentPlanBlock(fields: AgentPlanBlockFields): AssistantMessageBlock {
  const block: AssistantMessageBlock = {
    type: 'plan',
    content: fields.explanation ?? '',
    status: 'success',
    timestamp: Date.now()
  }
  applyPlanBlockFields(block, fields)
  return block
}

function findPlanBlockIndex(blocks: AssistantMessageBlock[]): number {
  return blocks.findIndex((block) => block.type === 'plan')
}

function findPlanInsertIndex(
  blocks: AssistantMessageBlock[],
  options: UpsertAgentPlanBlockOptions
): number {
  const internalPlanToolCallIndex = blocks.findIndex(
    (block) =>
      block.type === 'tool_call' &&
      block.extra?.internalTool === true &&
      block.tool_call?.name === UPDATE_PLAN_TOOL_NAME
  )
  if (internalPlanToolCallIndex >= 0) {
    return internalPlanToolCallIndex + 1
  }

  const exactToolCallIndex = options.toolCallId?.trim()
    ? blocks.findIndex(
        (block) => block.type === 'tool_call' && block.tool_call?.id === options.toolCallId
      )
    : -1

  if (exactToolCallIndex >= 0) {
    return exactToolCallIndex + 1
  }

  return blocks.length
}

export function upsertAgentPlanBlock(
  blocks: AssistantMessageBlock[],
  snapshot: AgentPlanSnapshot,
  options: UpsertAgentPlanBlockOptions = {}
): AssistantMessageBlock {
  const fields: AgentPlanBlockFields = {
    plan: snapshot.plan,
    ...(snapshot.explanation ? { explanation: snapshot.explanation } : {}),
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    ...(snapshot.terminalReason ? { terminalReason: snapshot.terminalReason } : {})
  }
  const existingIndex = findPlanBlockIndex(blocks)
  if (existingIndex >= 0) {
    const block = blocks[existingIndex]
    applyPlanBlockFields(block, fields)
    return block
  }

  const block = createAgentPlanBlock(fields)
  blocks.splice(findPlanInsertIndex(blocks, options), 0, block)
  return block
}

export function stampLatestAgentPlanBlockTerminal(
  blocks: AssistantMessageBlock[],
  reason: AgentPlanTerminalReason,
  updatedAt: string = new Date().toISOString()
): AgentPlanSnapshot | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.type !== 'plan') {
      continue
    }

    const plan = normalizeAgentPlanEntries(block.extra?.plan_entries)
    if (!plan.some((entry) => entry.status === 'in_progress')) {
      return null
    }

    if (normalizeAgentPlanTerminalReason(block.extra?.plan_terminal_reason)) {
      return null
    }

    const rawRevision = block.extra?.plan_revision
    const revision = typeof rawRevision === 'number' && rawRevision > 0 ? rawRevision : 1
    const rawExplanation = block.extra?.plan_explanation
    const explanation =
      typeof rawExplanation === 'string' && rawExplanation.trim()
        ? rawExplanation.trim()
        : block.content?.trim() || undefined

    block.extra = {
      ...block.extra,
      plan_entries: toPlanBlockEntries(plan),
      ...(explanation ? { plan_explanation: explanation } : {}),
      plan_revision: revision,
      plan_updated_at: updatedAt,
      plan_terminal_reason: reason
    }

    return {
      sessionId: '',
      messageId: '',
      plan,
      ...(explanation ? { explanation } : {}),
      revision,
      updatedAt,
      terminalReason: reason
    }
  }

  return null
}
