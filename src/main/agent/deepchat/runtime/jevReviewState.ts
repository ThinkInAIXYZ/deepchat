import type { ChatMessage } from '@shared/types/core/chat-message'
import { chatMessageContentToReviewText, truncateReviewText } from './reviewText'
import type { ToolPermissionReviewRequest } from './types'
import {
  JEV_REVIEW_MAX_CONTENT_CHARS,
  JEV_REVIEW_MAX_RECENT_MESSAGES
} from './jevPermissionQuestions'

/**
 * Builds and bounds the System One review state.
 *
 * Jev's documented request budget is 64k tokens, with 32k for `state` plus the longest question.
 * Nothing previously bounded `proposedAction.toolArgs`, so a `write` carrying a large file body sent
 * that whole body as state, exceeded the limit, and came back as an HTTP failure that resolved to
 * `ask_user`. Large-argument actions were therefore escalated systematically rather than judged.
 *
 * The fix is to bound the state by an estimated token budget and fit it in stages, tightening only
 * as far as needed. The staged approach is adapted from the `fast-jev-compaction` plugin, which
 * solves the same class of problem for conversation pruning.
 */

/**
 * Conservative token estimate, adapted from the `fast-jev-compaction` plugin's estimator.
 *
 * A plain characters-per-token ratio is not good enough here: that plugin calibrated against the
 * usage Jev reports for real transcripts and found a ratio undercounts JSON-heavy states by up to
 * 40%, because JSON punctuation costs far more than the letters around it. The review state is
 * JSON-heavy by construction — `toolArgs` and `permission` are both JSON — so under-counting would
 * let an oversized request through and silently degrade the action to `ask_user`.
 *
 * Their estimator scores token-like pieces instead: a word costs one token plus one per six further
 * letters, a digit run half a token per digit, and any other symbol nine tenths. Measured against
 * real transcripts it lands 2-18% above the true count, which is the direction we want.
 */
const JEV_TOKEN_PIECES = /[A-Za-z]+|\d+|[^\sA-Za-z\d]/g

export function estimateJevTokens(value: string): number {
  let tokens = 0

  for (const [piece] of value.matchAll(JEV_TOKEN_PIECES)) {
    const first = piece.charCodeAt(0)
    if (first >= 48 && first <= 57) tokens += piece.length / 2
    else if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
      tokens += 1 + Math.floor((piece.length - 1) / 6)
    } else tokens += 0.9
  }

  return Math.ceil(tokens)
}

/**
 * Estimated ceiling for the serialized state. Kept well under Jev's 32k state-plus-question limit so
 * the questions' own text and the estimate's error cannot push a request over.
 */
export const JEV_REVIEW_MAX_STATE_TOKENS = 20_000

type JevReviewStateShape = {
  /** Recorded in logs so an evaluation can see how often fitting was needed and how hard. */
  label: string
  maxMessages: number
  messageChars: number
  toolArgsChars: number
  /** `null` keeps the permission object intact; a number replaces it with a truncated JSON string. */
  permissionChars: number | null
}

const JEV_REVIEW_STATE_SHAPES: readonly JevReviewStateShape[] = [
  {
    label: 'full',
    maxMessages: JEV_REVIEW_MAX_RECENT_MESSAGES,
    messageChars: JEV_REVIEW_MAX_CONTENT_CHARS,
    toolArgsChars: 4_000,
    permissionChars: null
  },
  {
    label: 'tight',
    maxMessages: JEV_REVIEW_MAX_RECENT_MESSAGES,
    messageChars: 800,
    toolArgsChars: 1_000,
    permissionChars: 1_000
  },
  {
    label: 'tighter',
    maxMessages: 4,
    messageChars: 400,
    toolArgsChars: 400,
    permissionChars: 300
  },
  {
    label: 'minimal',
    maxMessages: 2,
    messageChars: 200,
    toolArgsChars: 160,
    permissionChars: 120
  },
  {
    label: 'action-only',
    maxMessages: 1,
    messageChars: 120,
    toolArgsChars: 80,
    permissionChars: 60
  }
]

/**
 * Reduces the permission payload to the facts a reviewer needs in order to judge the action.
 *
 * Passing it through as-is caused two distinct defects.
 *
 * 1. It carries this app's own pre-assessment as prose. `commandInfo.suggestion` is a user-facing
 *    sentence such as "该命令为只读操作，影响较小" — an assertion that the action is safe, which is one
 *    of the patterns the injection question is defined to catch. Measured against Jev, that sentence
 *    alone lifts `injection_pressure` from 0.07 to 0.77, well past the composition's 0.2 ceiling, so
 *    every command escalated to `ask_user` no matter how benign.
 * 2. `commandInfo.riskLevel` is this app's own verdict on the command. Handing the reviewer the
 *    conclusion of the very layer it exists to check makes the review dependent rather than
 *    independent, and biases the answer toward whatever the local regex decided.
 *
 * `description`, the signatures, and the approval plumbing (`requestId`, `rememberable`,
 * `requiresUserConfirmation`) go the same way: they describe the approval rather than the action.
 * What remains is the action itself — what runs, against which paths, in which shell.
 */
function toReviewablePermission(
  permission: NonNullable<ToolPermissionReviewRequest['permission']>
): Record<string, unknown> {
  return {
    permissionType: permission.permissionType,
    command: permission.command,
    shellProfile: permission.shellProfile,
    paths: permission.paths,
    baseCommand: permission.commandInfo?.baseCommand
  }
}

function buildStateForShape(
  request: ToolPermissionReviewRequest,
  recentMessages: ChatMessage[],
  shape: JevReviewStateShape
): Record<string, unknown> {
  const recentConversation = recentMessages.slice(-shape.maxMessages).map((message) => ({
    role: message.role,
    content: chatMessageContentToReviewText(message.content, shape.messageChars, 'head-and-tail'),
    calledTools: message.tool_calls?.map((toolCall) => toolCall.function.name)
  }))

  const reviewablePermission = request.permission
    ? toReviewablePermission(request.permission)
    : null

  const permission =
    shape.permissionChars === null
      ? reviewablePermission
      : truncateReviewText(
          JSON.stringify(reviewablePermission),
          shape.permissionChars,
          'head-and-tail'
        )

  return {
    reviewTask: 'deepchat_judgment_tool_action',
    proposedAction: {
      toolName: request.toolName,
      toolArgs: truncateReviewText(request.toolArgs ?? '', shape.toolArgsChars, 'head-and-tail'),
      toolSource: request.toolSource,
      serverName: request.serverName,
      reason: request.reason,
      permission
    },
    recentConversation
  }
}

export type FittedJevReviewState = {
  state: Record<string, unknown>
  estimatedTokens: number
  shape: string
}

/**
 * Fits the review state into the token budget, tightening in stages only as far as needed.
 *
 * Returns `null` when even the tightest shape does not fit. The caller must then escalate rather than
 * send an oversized request: if the action cannot be shown to the model within its limit, there is no
 * judgement to be had, and `ask_user` is the honest answer.
 */
export function fitJevReviewState(params: {
  request: ToolPermissionReviewRequest
  recentMessages: ChatMessage[]
  maxStateTokens?: number
}): FittedJevReviewState | null {
  const budget = params.maxStateTokens ?? JEV_REVIEW_MAX_STATE_TOKENS

  for (const shape of JEV_REVIEW_STATE_SHAPES) {
    const state = buildStateForShape(params.request, params.recentMessages, shape)
    const estimatedTokens = estimateJevTokens(JSON.stringify(state))

    if (estimatedTokens <= budget) {
      return { state, estimatedTokens, shape: shape.label }
    }
  }

  return null
}
