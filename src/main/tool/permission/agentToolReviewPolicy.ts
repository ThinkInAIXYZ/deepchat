import type { ToolExecutionContract } from '@shared/types/core/mcp'
import {
  CRON_JOB_AGENT_TOOL_NAME,
  LIVE_DELEGATION_AGENT_TOOL_NAME,
  SKILL_VIEW_AGENT_TOOL_NAME
} from '@shared/agentTools'
import { UPDATE_PLAN_TOOL_NAME } from '@shared/types/agent-plan'
import { APPLY_PATCH_TOOL_NAME, STR_REPLACE_EDITOR_TOOL_NAME } from '@/tool/codeMode/toolModeTools'
import { collectApplyPatchPaths, parseApplyPatch } from '@/tool/agentTools/minimalEditorAdapter'

/**
 * One owner for what an agent built-in tool call means to the assistant review gate that
 * `auto_approve` runs on the user's behalf.
 *
 * The synthesizer and the allow path used to answer that question separately and disagreed: the
 * synthesizer guessed from tool-name substrings and argument shape, while the allow path assumed
 * every `agent-filesystem` approval authorized file paths. A `process` approval therefore demanded
 * paths the tool never had, and could not be approved at all.
 *
 * Coverage follows the tool's declared execution contract, corrected where the contract cannot
 * express what an operation does.
 */

/** What an approval authorizes. */
export type AgentToolReviewScope = 'command' | 'paths' | 'tool'

export interface AgentToolReviewDecision {
  /** Whether this call needs the assistant's review under `auto_approve`. */
  readonly reviewed: boolean
  /** What the approval authorizes when it is reviewed. */
  readonly scope: AgentToolReviewScope
  /** Permission type recorded on the approval. */
  readonly permissionType: 'read' | 'write' | 'command'
  /** Filesystem paths the approval authorizes; empty unless the scope is `paths`. */
  readonly paths: readonly string[]
}

const AGENT_FILESYSTEM_SERVER_NAME = 'agent-filesystem'

const NOT_REVIEWED: AgentToolReviewDecision = Object.freeze({
  reviewed: false,
  scope: 'tool',
  permissionType: 'read',
  paths: Object.freeze([])
})

/**
 * Tools that own an approval path, so this gate must not add a second one. `cronjob` gates its
 * write actions in the precheck, `deepchat_subagents` requires explicit user confirmation for
 * `spawn`/`follow_up`, and the question tool is an interaction rather than a permission.
 */
const TOOLS_WITH_OWN_APPROVAL_PATH: ReadonlySet<string> = new Set([
  CRON_JOB_AGENT_TOOL_NAME,
  'deepchat_question'
])

/**
 * Operations that this gate never reviews. Read operations cannot change anything, and the
 * `deepchat_subagents` operations listed are governed by the forced user confirmation or by the
 * conversation's orchestration policy, which already decided not to ask.
 */
const NOT_REVIEWED_OPERATIONS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  process: new Set(['list', 'poll', 'log']),
  [STR_REPLACE_EDITOR_TOOL_NAME]: new Set(['view']),
  [LIVE_DELEGATION_AGENT_TOOL_NAME]: new Set([
    'list',
    'inspect',
    'read_result',
    'wait',
    'spawn',
    'follow_up'
  ])
})

/**
 * Tools declared as writes that only read. Reviewing a retrieval would spend a review call on an
 * operation that cannot change anything. Their declarations are left alone because the contract
 * also drives execution parallelism and recovery classification.
 */
const READ_ONLY_DESPITE_CONTRACT: ReadonlySet<string> = new Set([
  'memory_recall',
  SKILL_VIEW_AGENT_TOOL_NAME
])

/**
 * Tools that only change session-local presentation state. `update_plan` is declared as a write
 * because it mutates the session plan, but it grants no capability the user would approve.
 */
const SESSION_LOCAL_TOOLS: ReadonlySet<string> = new Set([UPDATE_PLAN_TOOL_NAME])

/**
 * Agent-filesystem tools whose approvals authorize no filesystem path. Every other
 * agent-filesystem approval must carry the paths it authorizes, so an unrecognized tool keeps the
 * stricter validation instead of silently losing it.
 */
const PATHLESS_AGENT_FILESYSTEM_TOOLS: ReadonlySet<string> = new Set(['process'])

/**
 * The argument carrying the operation name differs per tool family; only tools with a mixed
 * read/write surface consult it.
 */
function resolveOperation(args: Record<string, unknown>): string {
  for (const key of ['action', 'operation', 'command', 'method']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

/** Filesystem paths an approval for this tool must authorize. Must stay in step with the tool
 * manager's own write targets, so the approval and the execution agree on which argument is a path.
 */
export function collectAgentToolApprovalPaths(
  toolName: string,
  args: Record<string, unknown>
): string[] {
  switch (toolName) {
    case 'read':
    case 'write':
    case 'edit':
    case STR_REPLACE_EDITOR_TOOL_NAME: {
      const pathArg = args.path
      return typeof pathArg === 'string' && pathArg.trim() ? [pathArg] : []
    }
    case APPLY_PATCH_TOOL_NAME: {
      const patch = args.patch
      if (typeof patch !== 'string') return []
      try {
        return collectApplyPatchPaths(parseApplyPatch(patch))
      } catch {
        return []
      }
    }
    default:
      return []
  }
}

/**
 * Whether an approval for this tool must carry the filesystem paths it authorizes. Only meaningful
 * for `agent-filesystem` approvals, where the allow path arms a file lease from those paths.
 */
export function requiresAgentToolApprovalPaths(toolName: string): boolean {
  return !PATHLESS_AGENT_FILESYSTEM_TOOLS.has(toolName)
}

/**
 * Whether an approval for this tool must carry a resolved command shell profile. The retry path
 * resolves the approved call against the shell it was reviewed under, so every `agent-filesystem`
 * approval carries one whether or not it also carries paths.
 */
export function requiresAgentToolApprovalShellProfile(serverName: string | undefined): boolean {
  return serverName === AGENT_FILESYSTEM_SERVER_NAME
}

/**
 * Decides whether an `auto_approve` call of this shape needs the assistant's review, and what its
 * approval authorizes.
 */
export function resolveAgentToolReview(input: {
  toolName: string
  args: Record<string, unknown>
  execution?: ToolExecutionContract | null
  source?: 'mcp' | 'agent'
}): AgentToolReviewDecision {
  const { toolName, args, execution, source } = input

  // Only agent built-in tools are covered here. MCP tools keep the permission broker's own path,
  // which under `full_access` short-circuits by design, and their execution contract is not
  // per-tool meaningful.
  if (source !== 'agent') {
    return NOT_REVIEWED
  }

  if (
    TOOLS_WITH_OWN_APPROVAL_PATH.has(toolName) ||
    SESSION_LOCAL_TOOLS.has(toolName) ||
    READ_ONLY_DESPITE_CONTRACT.has(toolName)
  ) {
    return NOT_REVIEWED
  }

  const operation = resolveOperation(args)
  if (operation && NOT_REVIEWED_OPERATIONS[toolName]?.has(operation)) {
    return NOT_REVIEWED
  }

  if (toolName === 'exec') {
    const command = args.command
    return typeof command === 'string' && command.trim()
      ? { reviewed: true, scope: 'command', permissionType: 'command', paths: [] }
      : NOT_REVIEWED
  }

  if (execution?.effect !== 'write') {
    return NOT_REVIEWED
  }

  const paths = collectAgentToolApprovalPaths(toolName, args)
  return paths.length > 0
    ? { reviewed: true, scope: 'paths', permissionType: 'write', paths }
    : { reviewed: true, scope: 'tool', permissionType: 'write', paths: [] }
}
