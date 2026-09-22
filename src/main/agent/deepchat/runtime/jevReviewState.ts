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

/**
 * Length at which an unbroken alphanumeric run stops looking like a word and starts looking like a
 * blob — base64, a hash, a minified payload, a data URL.
 */
const JEV_TOKEN_BLOB_RUN_LENGTH = 24

export function estimateJevTokens(value: string): number {
  let tokens = 0

  for (const [piece] of value.matchAll(JEV_TOKEN_PIECES)) {
    const first = piece.charCodeAt(0)
    if (first >= 48 && first <= 57) tokens += piece.length / 2
    else if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
      const wordRule = 1 + Math.floor((piece.length - 1) / 6)
      // The letter rule is calibrated on prose and undercounts a blob badly: a 119,000-character
      // base64 run estimates at ~19.8k tokens against a real count nearer 30k, so an oversized request
      // passes the budget check and fails at the HTTP layer instead — the exact degradation the budget
      // exists to prevent. Charge long runs by length instead, keeping whichever rule is larger so
      // ordinary words are unaffected.
      const blobRule = piece.length >= JEV_TOKEN_BLOB_RUN_LENGTH ? piece.length / 4 : 0
      tokens += Math.max(wordRule, blobRule)
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
  /** Bound on the executable strings inside the permission payload (`command`, each path). */
  permissionFieldChars: number
}

const JEV_REVIEW_STATE_SHAPES: readonly JevReviewStateShape[] = [
  {
    label: 'full',
    maxMessages: JEV_REVIEW_MAX_RECENT_MESSAGES,
    messageChars: JEV_REVIEW_MAX_CONTENT_CHARS,
    toolArgsChars: 4_000,
    permissionChars: null,
    permissionFieldChars: 2_000
  },
  {
    label: 'tight',
    maxMessages: JEV_REVIEW_MAX_RECENT_MESSAGES,
    messageChars: 800,
    toolArgsChars: 1_000,
    permissionChars: 1_000,
    permissionFieldChars: 1_000
  },
  {
    label: 'tighter',
    maxMessages: 4,
    messageChars: 400,
    toolArgsChars: 400,
    permissionChars: 300,
    permissionFieldChars: 400
  },
  {
    label: 'minimal',
    maxMessages: 2,
    messageChars: 200,
    toolArgsChars: 160,
    permissionChars: 120,
    permissionFieldChars: 200
  },
  {
    label: 'action-only',
    maxMessages: 1,
    messageChars: 120,
    toolArgsChars: 80,
    permissionChars: 60,
    permissionFieldChars: 100
  }
]

/**
 * Cap on how many `permission.paths` entries reach the reviewer. The per-entry bound alone leaves the
 * count free, so a `write` touching thousands of paths would still fill the state.
 */
export const JEV_REVIEW_MAX_PERMISSION_PATHS = 20

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
  permission: NonNullable<ToolPermissionReviewRequest['permission']>,
  maxFieldChars: number
): { permission: Record<string, unknown>; truncated: boolean } {
  const command = boundString(permission.command, maxFieldChars)
  // The array length is bounded as well as each entry: bounding only the entries leaves the count
  // free, and a `write` touching thousands of paths is the shape that made the state unbounded in the
  // first place.
  const paths = permission.paths?.slice(0, JEV_REVIEW_MAX_PERMISSION_PATHS)
  const boundedPaths = paths?.map((entry) => boundString(entry, maxFieldChars).value)

  return {
    permission: {
      permissionType: permission.permissionType,
      command: command.value,
      shellProfile: permission.shellProfile,
      paths: boundedPaths,
      baseCommand: permission.commandInfo?.baseCommand
    },
    // `command` and `paths` are executable: they say what runs and against what. Leaving them
    // unbounded let a 119,000-character command ride through the widest shape while still describing
    // the action, which is the same partial-view problem as a truncated `toolArgs`.
    truncated:
      command.truncated ||
      (permission.paths?.length ?? 0) > JEV_REVIEW_MAX_PERMISSION_PATHS ||
      (paths?.some((entry) => boundString(entry, maxFieldChars).truncated) ?? false)
  }
}

function boundString(value: string | undefined, maxChars: number): {
  value: string | undefined
  truncated: boolean
} {
  if (typeof value !== 'string') return { value, truncated: false }
  const bounded = truncateReviewText(value, maxChars, 'head-and-tail')
  return { value: bounded, truncated: bounded !== value }
}

function buildStateForShape(
  request: ToolPermissionReviewRequest,
  recentMessages: ChatMessage[],
  shape: JevReviewStateShape
): { state: Record<string, unknown>; actionTruncated: boolean } {
  const recentConversation = recentMessages.slice(-shape.maxMessages).map((message) => ({
    role: message.role,
    content: chatMessageContentToReviewText(message.content, shape.messageChars, 'head-and-tail'),
    calledTools: message.tool_calls?.map((toolCall) => toolCall.function.name)
  }))

  const reviewablePermission = request.permission
    ? toReviewablePermission(request.permission, shape.permissionFieldChars)
    : null

  const rawToolArgs = request.toolArgs ?? ''
  const boundedToolArgs = truncateReviewText(rawToolArgs, shape.toolArgsChars, 'head-and-tail')

  const permissionIsStringified = shape.permissionChars !== null
  const stringifiedPermission = reviewablePermission
    ? JSON.stringify(reviewablePermission.permission)
    : null
  const permission =
    shape.permissionChars === null || stringifiedPermission === null
      ? (reviewablePermission?.permission ?? null)
      : truncateReviewText(stringifiedPermission, shape.permissionChars, 'head-and-tail')

  /**
   * Whether the reviewer is being shown less of the action than will actually run.
   *
   * A truncated `toolArgs` is the dangerous case: the action still executes in full, so a reviewer
   * that saw only the first `toolArgsChars` characters is not judging the action that runs. A bounded
   * executable field inside the permission payload is the same problem.
   *
   * Both comparisons are against the content, not the shape. Re-encoding the permission as JSON in a
   * tighter shape is not truncation, and treating it as such would refuse `auto_allow` for every
   * action that has a permission payload at all.
   */
  const actionTruncated =
    boundedToolArgs !== rawToolArgs ||
    (reviewablePermission?.truncated ?? false) ||
    (permissionIsStringified &&
      stringifiedPermission !== null &&
      permission !== stringifiedPermission)

  return {
    state: {
      reviewTask: 'deepchat_judgment_tool_action',
      proposedAction: {
        toolName: request.toolName,
        toolArgs: boundedToolArgs,
        toolSource: request.toolSource,
        serverName: request.serverName,
        reason: request.reason,
        permission
      },
      recentConversation
    },
    actionTruncated
  }
}

export type FittedJevReviewState = {
  state: Record<string, unknown>
  estimatedTokens: number
  shape: string
  /**
   * `true` when the state shows less of the action than will run. The caller must not `auto_allow`
   * on it: the judgement is about a partial view.
   */
  actionTruncated: boolean
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
    const built = buildStateForShape(params.request, params.recentMessages, shape)
    const estimatedTokens = estimateJevTokens(JSON.stringify(built.state))

    if (estimatedTokens <= budget) {
      return {
        state: built.state,
        estimatedTokens,
        shape: shape.label,
        actionTruncated: built.actionTruncated
      }
    }
  }

  return null
}
