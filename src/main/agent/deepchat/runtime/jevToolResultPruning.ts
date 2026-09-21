import type { ChatMessage } from '@shared/types/core/chat-message'
import { isJevNoulAnswer, type JevAnswer, type JevQuestion } from '@shared/jevProtocol'
import { getProviderProjectionIdentities } from '@/agent/deepchat/loop/providerProjectionIdentity'
import { chatMessageContentToReviewText, truncateReviewText } from './reviewText'
import { estimateJevTokens } from './jevReviewState'

/**
 * Jev-judged pruning of closed tool results.
 *
 * `compactClosedToolResultsForContext` already trims closed tool results, but its only criterion is
 * size: anything over `TOOL_OUTPUT_VIEW_COMPACTION_THRESHOLD` is cut to head + tail, and anything
 * under it is left untouched forever. Measured against this machine's Session Tape, 886 of 903 tool
 * results (98.1%) sit under that threshold and are never touched, while the 17 that are touched
 * account for only 6.9% of all tool-result characters. Size is therefore the wrong lever — the bulk
 * lives in the long tail of small results that nobody ever asks whether they are still needed.
 *
 * So this runs *before* truncation and asks a different question: is this result still needed at
 * all? A result judged stale is replaced by a short note, which means the truncation pass that
 * follows skips it (its content is now well under the threshold). A result judged necessary is left
 * verbatim — which is strictly better than truncating it.
 *
 * ## Two boundaries this module must not cross
 *
 * 1. **It never writes to the Session Tape.** The tape is an append-only execution journal and the
 *    durable evidence store; this is a projection over what the model is shown this turn. Everything
 *    here is a pure function over `ChatMessage[]` that returns a new array. The recovery path the
 *    placeholder points at only works because the tape is untouched.
 *
 * 2. **It never tells Jev how big or how old a result is.** The permission review shipped a bug where
 *    the app's own pre-assessment was fed to the reviewer, which both primed the answer and tripped
 *    the injection question. The same rule applies here: the state carries what the result says, not
 *    any hint about what the caller already suspects.
 *
 * ## The assumption this rests on
 *
 * `keepThreshold` is carried over from the `fast-jev-compaction` plugin and is **not calibrated**.
 * The working assumption is that Jev's judgment is good enough to try; the falsifier is the
 * prune-then-recall rate, which is why every decision is reported back to the caller for logging.
 */

/**
 * Drop a result only when the composed probability that it is still needed falls below this.
 *
 * TypeSafe's guidance on thresholds is that they depend on the cost of being wrong: "Use 0.5 when yes
 * and no are equally easy to act on. Raise it when acting on a false yes is expensive... Values in the
 * middle can go to a person rather than either code path."
 *
 * The two outcomes here are not symmetric, so 0.5 is the wrong cut. Keeping a stale result costs some
 * context. Dropping a needed one is silent — the model does not know what it cannot see — and costs
 * whatever it was going to do with that information. So the middle band is treated as "keep" and only
 * a clear no is acted on.
 *
 * Uncalibrated, like every other threshold in this path. The evaluation harness measures it.
 */
export const JEV_PRUNING_DROP_BELOW = 0.2

/**
 * Above this probability that the work still depends on a result, it is kept without asking anything
 * further.
 */
export const JEV_PRUNING_KEEP_ABOVE = 0.5

/**
 * In the band between `JEV_PRUNING_DROP_BELOW` and `JEV_PRUNING_KEEP_ABOVE` the relevance answer is not
 * decisive, so the recoverability answer decides: contents that a re-run would bring back can be
 * dropped, contents that would not are kept.
 *
 * This middle band is the structure `fast-jev-compaction` has and this pass was missing. Its
 * `keepThreshold` of 0.5 governs a three-way split — keep both, keep the call and truncate the result,
 * remove both — and removal requires two answers to fail, not one. Read as a two-way cut, the same 0.5
 * deletes on a single uncertain answer, which is what the evaluation measured.
 *
 * The middle band here resolves to a second judgement rather than to truncation, because this pass
 * cannot truncate: the existing size-based stages already do that for large results, and the soft
 * delete this pass applies is an information loss that truncation is not.
 */
export const JEV_PRUNING_RECOVERABLE_ABOVE = 0.5

/**
 * Estimated ceiling for the serialized state, well under Jev's 32k state-plus-question limit so the
 * questions' own text and the estimate's error cannot push a request over. Same reasoning, and the
 * same estimator, as the permission-review state.
 */
export const JEV_PRUNING_MAX_STATE_TOKENS = 20_000

/**
 * Below this much candidate content, pruning is not attempted at all.
 *
 * The counterpart to `fast-jev-compaction`'s `reductionRatio` check, moved to where it can still save
 * something: that check runs after the request and only tells the caller the result was not worth
 * using, whereas the cost that matters here is the Jev call itself. If the closed results together
 * are small, no judgment can free enough context to pay for asking.
 */
export const JEV_PRUNING_MIN_CANDIDATE_CHARS = 2_000

/**
 * Fraction of candidate content that must actually be freed for the pass to count as worthwhile.
 * Reported rather than enforced, because by the time it is known the request has already been made;
 * it is the signal that says whether `keepThreshold` is set anywhere near right.
 */
export const JEV_PRUNING_MIN_REDUCTION_RATIO = 0.25

type JevPruningStateShape = {
  /** Recorded in logs so an evaluation can see how often fitting was needed and how hard. */
  label: string
  maxCandidates: number
  candidateChars: number
  taskChars: number
  assistantChars: number
  maxAssistantMessages: number
}

/**
 * Staged fitting, tightening only as far as needed. Adapted from `fast-jev-compaction`, which fits
 * its state the same way and for the same reason: an oversized request comes back as a failure, and a
 * failure here would mean silently skipping the pass.
 *
 * The candidate count shrinks alongside the per-candidate bound. That is deliberate — the fitted
 * candidate list is the list the questions are built from, so a shape that drops candidates also
 * drops their questions, rather than asking about content it did not send.
 */
const JEV_PRUNING_STATE_SHAPES: readonly JevPruningStateShape[] = [
  {
    label: 'full',
    maxCandidates: 24,
    candidateChars: 1_200,
    taskChars: 1_500,
    assistantChars: 800,
    maxAssistantMessages: 3
  },
  {
    label: 'tight',
    maxCandidates: 12,
    candidateChars: 600,
    taskChars: 1_000,
    assistantChars: 400,
    maxAssistantMessages: 2
  },
  {
    label: 'tighter',
    maxCandidates: 6,
    candidateChars: 300,
    taskChars: 600,
    assistantChars: 200,
    maxAssistantMessages: 1
  },
  {
    label: 'minimal',
    maxCandidates: 3,
    candidateChars: 150,
    taskChars: 300,
    assistantChars: 120,
    maxAssistantMessages: 1
  }
]

/** The candidate ceiling in the widest shape. */
export const JEV_PRUNING_MAX_CANDIDATES = JEV_PRUNING_STATE_SHAPES[0].maxCandidates

export const JEV_TOOL_RESULT_PRUNED_MARKER = '[Tool result pruned by judgment]'

export type JevPruningCandidate = {
  toolCallId: string
  /** Absent when the declaring call could not be matched back to the result. */
  toolName?: string
  /** The arguments the call was made with, used to recognise a re-run of the same work. */
  toolArgs: string
  content: string
  /** Index into the original `messages` array. */
  resultIndex: number
}

export type JevPruningAsker = (params: {
  state: unknown
  questions: Record<string, JevQuestion>
}) => Promise<Record<string, JevAnswer>>

export type JevPruningDecision = {
  toolCallId: string
  toolName?: string
  /** The arguments the pruned call was made with, so a re-run of it can be recognised. */
  toolArgs: string
  originalChars: number
  /** The two judgements the decision was made from, kept so a wrong one can be attributed. */
  relevance: number | null
  recoverable: number | null
  kept: boolean
}

/**
 * Collects the closed tool results eligible for a judgment.
 *
 * Pairing follows `compactClosedToolResultsForContext` exactly, including its requirement that every
 * declared call have a matching result: a half-paired unit is one whose shape is not understood, and
 * pruning on a misunderstood shape is how a call ends up separated from its result.
 *
 * Results that are protected, replayed, carrying provider projection identities, already pruned, or
 * non-string are skipped. Those are the same exclusions the truncation pass makes, for the same
 * reasons — a replay or projection is reconstructed by the provider and must not be rewritten.
 */
export function collectJevPruningCandidates(
  messages: ChatMessage[],
  protectedToolCallIds: ReadonlySet<string>,
  maxCandidates: number = JEV_PRUNING_STATE_SHAPES[0].maxCandidates
): JevPruningCandidate[] {
  const activeTurnStart = messages.findLastIndex((message) => message.role === 'user')
  if (activeTurnStart < 0) return []

  const candidates: JevPruningCandidate[] = []

  for (let index = activeTurnStart + 1; index < messages.length; index += 1) {
    const assistant = messages[index]
    if (
      assistant.role !== 'assistant' ||
      assistant.provider_replay ||
      !assistant.tool_calls?.length
    ) {
      continue
    }

    const expectedCallIds = new Set(assistant.tool_calls.map((toolCall) => toolCall.id))
    const resultIndexes = new Map<string, number>()
    let cursor = index + 1
    while (cursor < messages.length && messages[cursor].role === 'tool') {
      const toolCallId = messages[cursor].tool_call_id
      if (!toolCallId || !expectedCallIds.has(toolCallId) || resultIndexes.has(toolCallId)) {
        resultIndexes.clear()
        break
      }
      resultIndexes.set(toolCallId, cursor)
      cursor += 1
    }
    if (resultIndexes.size !== expectedCallIds.size) continue

    for (const [toolCallId, resultIndex] of resultIndexes) {
      const toolMessage = messages[resultIndex]
      if (
        protectedToolCallIds.has(toolCallId) ||
        toolMessage.provider_replay ||
        getProviderProjectionIdentities(toolMessage).length > 0 ||
        typeof toolMessage.content !== 'string' ||
        toolMessage.content.length === 0 ||
        toolMessage.content.startsWith(JEV_TOOL_RESULT_PRUNED_MARKER)
      ) {
        continue
      }

      candidates.push({
        toolCallId,
        toolName: assistant.tool_calls.find((toolCall) => toolCall.id === toolCallId)?.function
          .name,
        toolArgs:
          assistant.tool_calls.find((toolCall) => toolCall.id === toolCallId)?.function
            .arguments ?? '',
        content: toolMessage.content,
        resultIndex
      })
    }

    index = Math.max(index, cursor - 1)
  }

  // Oldest first, capped. `slice(0, max)` rather than a tail slice: the oldest results are the ones
  // that have been costing context the longest and the ones least likely to still be needed.
  return candidates.slice(0, maxCandidates)
}

export type FittedJevPruningState = {
  state: Record<string, unknown>
  /** The candidates that actually travelled in the state — and therefore the ones to ask about. */
  candidates: JevPruningCandidate[]
  estimatedTokens: number
  shape: string
}

/**
 * Fits the state into the token budget, tightening in stages only as far as needed.
 *
 * Returns `null` when even the tightest shape does not fit. The caller must then skip the pass rather
 * than send an oversized request: an unfittable state is one whose judgment could not be had, and the
 * safe answer is to keep everything.
 */
export function fitJevPruningState(params: {
  messages: ChatMessage[]
  protectedToolCallIds?: ReadonlySet<string>
  maxStateTokens?: number
}): FittedJevPruningState | null {
  const budget = params.maxStateTokens ?? JEV_PRUNING_MAX_STATE_TOKENS
  const protectedIds = params.protectedToolCallIds ?? new Set<string>()

  for (const shape of JEV_PRUNING_STATE_SHAPES) {
    const candidates = collectJevPruningCandidates(params.messages, protectedIds, shape.maxCandidates)
    if (candidates.length === 0) return null

    const state = buildJevPruningState(params.messages, candidates, shape)
    const estimatedTokens = estimateJevTokens(JSON.stringify(state))

    if (estimatedTokens <= budget) {
      return { state, candidates, estimatedTokens, shape: shape.label }
    }
  }

  return null
}

/**
 * Two Nouls per candidate, not one, and keyed by tool call id so an answer can be attributed without
 * relying on the model echoing anything back in order.
 *
 * The single question this replaces asked for two judgements at once — whether the contents still
 * matter AND whether re-running would not recover them. TypeSafe's own guidance is explicit that this
 * is the mistake to avoid: "If a question has two conditions ... the model has to judge both at once
 * and the value means less. Ask two Nouls and combine them in code." Measured against real sessions it
 * behaved exactly as described, answering in the 0.21–0.45 band — low confidence dressed as a number —
 * while being wrong about a third of the time.
 *
 * Splitting costs nothing in latency. Questions are evaluated in parallel in one request.
 *
 * Both are phrased so a high value means yes, which the guidance also asks for: an inverted question
 * is one whose answer code later reads backwards.
 */
export function buildJevPruningQuestions(
  candidates: readonly JevPruningCandidate[]
): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {}

  for (const candidate of candidates) {
    questions[relevanceQuestionId(candidate.toolCallId)] = {
      type: 'noul',
      instructions:
        'The state carries a work in progress under `task` and earlier tool results under ' +
        '`candidateResults`. One of those results has `toolCallId` ' +
        `\`${candidate.toolCallId}\`. Is that result still load-bearing for the work in progress?`,
      criteria: {
        true: 'It carries something the work still has to refer back to: a path or symbol still being edited, the error that explains the current failure, a value that was measured or discovered, an identifier, or a constraint that still applies.',
        false:
          'The step it served is finished and nothing downstream refers back to it; or it only confirmed that an action succeeded; or it is an intermediate listing or search result that has already been acted on.'
      }
    }

    questions[recoverabilityQuestionId(candidate.toolCallId)] = {
      type: 'noul',
      instructions:
        'One of the results under `candidateResults` has `toolCallId` ' +
        `\`${candidate.toolCallId}\`. If that result were discarded, would re-running the tool that ` +
        'produced it bring these contents back?',
      criteria: {
        true: 'The tool reads state that has not changed since and is cheap to run again: listing a directory, reading a file, checking status, repeating a search over static sources.',
        false:
          'The contents came from something that will not repeat: a timestamped listing, a one-off measurement, output that depends on the moment it ran, a search over data that changes, or output whose ordering or values are not reproducible.'
      }
    }
  }

  return questions
}

/**
 * The state a pruning judgment is made against.
 *
 * Three parts, and deliberately only three:
 *
 * 1. `task` — the user request that opened the active turn. The judgment is "is this still needed
 *    *for the work*", so it needs the work. `fast-jev-compaction` solves the same problem with a
 *    `goal` option (its last three user prompts), but that is the right shape only because it spans
 *    the whole conversation: it has to guess which prompt is current. This pass is scoped to the
 *    active turn, so the current request is known exactly and the two before it describe different
 *    tasks. Including them would add budget and noise rather than context.
 *
 * 2. `recentAssistantText` — what the agent has said it is doing, if anything. Assistant messages in
 *    a tool-heavy turn are usually empty tool-call carriers, so this is filtered rather than sliced
 *    blindly.
 *
 * 3. `candidateResults` — the contents under judgment.
 *
 * It does not carry a result's size or age. Both are hints toward the answer the caller is fishing
 * for, and the size-based heuristic is the thing being replaced.
 */
export function buildJevPruningState(
  messages: ChatMessage[],
  candidates: readonly JevPruningCandidate[],
  shape: JevPruningStateShape = JEV_PRUNING_STATE_SHAPES[0]
): Record<string, unknown> {
  const activeTurnStart = messages.findLastIndex((message) => message.role === 'user')

  const task =
    activeTurnStart >= 0
      ? chatMessageContentToReviewText(
          messages[activeTurnStart].content,
          shape.taskChars,
          'head-and-tail'
        )
      : ''

  const recentAssistantText = messages
    .slice(activeTurnStart + 1)
    .filter((message) => message.role === 'assistant')
    .map((message) =>
      chatMessageContentToReviewText(message.content, shape.assistantChars, 'head-and-tail')
    )
    .filter((text) => text.trim().length > 0)
    .slice(-shape.maxAssistantMessages)

  return {
    reviewTask: 'deepchat_tool_result_pruning',
    task,
    recentAssistantText,
    candidateResults: candidates.map((candidate) => ({
      toolCallId: candidate.toolCallId,
      toolName: candidate.toolName,
      content: truncateReviewText(candidate.content, shape.candidateChars, 'head-and-tail')
    }))
  }
}

export type JevPruningSignals = {
  /** Probability that the work still depends on the contents. `null` when unreadable. */
  relevance: number | null
  /** Probability that re-running the tool would reproduce the contents. `null` when unreadable. */
  recoverable: number | null
}

export type JevPruningDecisionInput = {
  relevance: number | null
  recoverable: number | null
}

/**
 * Reads the two answers per candidate. They are combined later, in code, as the guidance asks.
 *
 * A missing or wrong-typed answer yields `null` rather than 0. Defaulting an unreadable answer to
 * "drop" would let a malformed response silently delete context, which is the one failure mode this
 * whole design is built to avoid; the decision treats `null` as "keep".
 */
export function readJevPruningSignals(
  answers: Record<string, JevAnswer>,
  candidates: readonly JevPruningCandidate[]
): Map<string, JevPruningSignals> {
  const signals = new Map<string, JevPruningSignals>()

  for (const candidate of candidates) {
    signals.set(candidate.toolCallId, {
      relevance: readNoul(answers[relevanceQuestionId(candidate.toolCallId)]),
      recoverable: readNoul(answers[recoverabilityQuestionId(candidate.toolCallId)])
    })
  }

  return signals
}

/**
 * The three-way decision, in code where it is visible and testable.
 *
 *   relevance >= KEEP_ABOVE                  -> keep
 *   relevance <  DROP_BELOW                  -> drop
 *   in between                               -> drop only if a re-run would bring the contents back
 *
 * Any unreadable answer keeps. So does an undecided middle band whose contents are not recoverable.
 */
export function decideJevPruningDrop(
  signals: JevPruningDecisionInput,
  thresholds: { dropBelow?: number; keepAbove?: number; recoverableAbove?: number } = {}
): boolean {
  const { relevance, recoverable } = signals
  if (relevance === null) return false

  const dropBelow = thresholds.dropBelow ?? JEV_PRUNING_DROP_BELOW
  const keepAbove = thresholds.keepAbove ?? JEV_PRUNING_KEEP_ABOVE
  const recoverableAbove = thresholds.recoverableAbove ?? JEV_PRUNING_RECOVERABLE_ABOVE

  if (relevance >= keepAbove) return false
  if (relevance < dropBelow) return true

  // Undecided: the contents are not clearly needed, but they are not clearly irrelevant either. Drop
  // only if getting them back is cheap, which is the one case where being wrong costs a round-trip
  // rather than a fact.
  return recoverable !== null && recoverable >= recoverableAbove
}

function readNoul(answer: JevAnswer | undefined): number | null {
  return answer && isJevNoulAnswer(answer) ? answer.noul : null
}

/**
 * The soft-delete placeholder.
 *
 * Deliberately shaped like the truncation marker it sits next to, so the recovery path the model is
 * told about is the same one in both cases. The point of a placeholder rather than removal is that a
 * removal leaves no trace at all: the model would neither know something had been there nor think to
 * recall it, so a wrong judgment would be invisible.
 */
export function buildJevPrunedResultContent(params: {
  toolCallId: string
  originalChars: number
}): string {
  return [
    JEV_TOOL_RESULT_PRUNED_MARKER,
    `Tool call ID: ${params.toolCallId}`,
    `Original characters: ${params.originalChars}`,
    'The complete result remains in Session Tape. Use tape_search and tape_context to recall persisted evidence if needed.'
  ].join('\n')
}

/**
 * Applies the decisions as a new message array. Pure: the input array and its messages are not
 * mutated, and nothing outside the returned array is touched.
 */
export function applyJevPruningDecisions(params: {
  messages: ChatMessage[]
  candidates: readonly JevPruningCandidate[]
  signals: ReadonlyMap<string, JevPruningSignals>
  thresholds?: { dropBelow?: number; keepAbove?: number; recoverableAbove?: number }
}): { messages: ChatMessage[]; decisions: JevPruningDecision[] } {
  const decisions: JevPruningDecision[] = []
  let pruned: ChatMessage[] | null = null

  for (const candidate of params.candidates) {
    const signals = params.signals.get(candidate.toolCallId) ?? {
      relevance: null,
      recoverable: null
    }
    const kept = !decideJevPruningDrop(signals, params.thresholds)

    decisions.push({
      toolCallId: candidate.toolCallId,
      toolName: candidate.toolName,
      toolArgs: candidate.toolArgs,
      originalChars: candidate.content.length,
      relevance: signals.relevance,
      recoverable: signals.recoverable,
      kept
    })

    if (kept) continue

    const original = params.messages[candidate.resultIndex]
    pruned ??= [...params.messages]
    pruned[candidate.resultIndex] = {
      ...original,
      content: buildJevPrunedResultContent({
        toolCallId: candidate.toolCallId,
        originalChars: candidate.content.length
      })
    }
  }

  return { messages: pruned ?? params.messages, decisions }
}

export type JevPruningOutcome = {
  messages: ChatMessage[]
  decisions: JevPruningDecision[]
  /** `true` when the pass ran; `false` when it was skipped, with `skipReason` saying why. */
  attempted: boolean
  skipReason?: 'nothing-to-judge' | 'below-minimum-payload' | 'state-did-not-fit'
  /** Fraction of candidate content actually freed. `NaN` when the pass did not run. */
  reductionRatio: number
  shape?: string
  stateTokens?: number
}

/**
 * Runs the pass: fit the state, ask once, apply the answers.
 *
 * Every exit that is not a successful judgment returns the messages untouched. Skipping is always
 * available and always safe — the only way this can go wrong is by deleting something that was still
 * needed, so all the failure paths point away from deleting.
 */
export async function pruneClosedToolResultsForContext(params: {
  messages: ChatMessage[]
  protectedToolCallIds?: ReadonlySet<string>
  ask: JevPruningAsker
  thresholds?: { dropBelow?: number; keepAbove?: number; recoverableAbove?: number }
  maxStateTokens?: number
}): Promise<JevPruningOutcome> {
  const skipped = (skipReason: JevPruningOutcome['skipReason']): JevPruningOutcome => ({
    messages: params.messages,
    decisions: [],
    attempted: false,
    skipReason,
    reductionRatio: Number.NaN
  })

  const fitted = fitJevPruningState({
    messages: params.messages,
    protectedToolCallIds: params.protectedToolCallIds,
    maxStateTokens: params.maxStateTokens
  })
  if (!fitted) return skipped('nothing-to-judge')

  // The cheap gate, before the call rather than after: `fast-jev-compaction` checks the reduction
  // ratio once the answers are in, which is too late to save the request. If the closed results
  // together are small, no judgment can free enough to pay for asking.
  const totalCandidateChars = fitted.candidates.reduce(
    (total, candidate) => total + candidate.content.length,
    0
  )
  if (totalCandidateChars < JEV_PRUNING_MIN_CANDIDATE_CHARS) return skipped('below-minimum-payload')

  const answers = await params.ask({
    state: fitted.state,
    questions: buildJevPruningQuestions(fitted.candidates)
  })

  const applied = applyJevPruningDecisions({
    messages: params.messages,
    candidates: fitted.candidates,
    signals: readJevPruningSignals(answers, fitted.candidates),
    ...(params.thresholds ? { thresholds: params.thresholds } : {})
  })

  const freedChars = applied.decisions.reduce(
    (total, decision) => (decision.kept ? total : total + decision.originalChars),
    0
  )

  return {
    messages: applied.messages,
    decisions: applied.decisions,
    attempted: true,
    reductionRatio: totalCandidateChars > 0 ? freedChars / totalCandidateChars : 0,
    shape: fitted.shape,
    stateTokens: fitted.estimatedTokens
  }
}

function relevanceQuestionId(toolCallId: string): string {
  return `relevant_${toolCallId}`
}

function recoverabilityQuestionId(toolCallId: string): string {
  return `recoverable_${toolCallId}`
}
