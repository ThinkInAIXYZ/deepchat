/**
 * In-process feedback for tool-result pruning.
 *
 * The pruning pass runs on an assumption: that Jev's judgment about whether a result is still needed
 * is good enough to act on. `keepThreshold` came from `fast-jev-compaction` and has never been
 * calibrated against this app's own data.
 *
 * The obvious way to test that assumption is to log decisions and analyse them later. For a
 * local-first app that does not work — there is no aggregate collection, so a field written to a log
 * is a field nobody reads. Worse, it is the wrong shape: `fast-jev-compaction` exposes its
 * `reductionRatio` as a *return value for the caller to act on*, not as a log line, and that is the
 * pattern that survives without telemetry.
 *
 * So the falsifier here is in-process and needs no collection. It comes from the pruning question
 * itself, which asks whether "re-running the tool would not recover" the contents. If the agent then
 * re-runs that same tool with the same arguments, the judgment was wrong **by its own stated
 * criterion** — and the app can see that happen and react, on the spot.
 *
 * The reaction is deliberately blunt and one-directional: a miss tightens the threshold, and enough
 * misses stop pruning for the rest of the session. Every step points away from deleting, because the
 * cost of pruning too little is a little wasted context, while the cost of pruning too much is silent
 * — the model does not know what it cannot see.
 */

/** A miss lowers the bar for deleting: one wrong judgment should not be ignored. */
export const JEV_PRUNING_TIGHTENED_DROP_BELOW = 0.05

/** After this many misses, stop pruning for the session. */
export const JEV_PRUNING_MAX_MISSES = 3

/**
 * Identifies a tool invocation by what it asked for, not by its call id. A re-run is a new call with a
 * new id, so matching on the id would never fire; the name and arguments are what make it the same
 * piece of work.
 */
export function pruningInvocationSignature(toolName: string | undefined, toolArgs: string): string {
  return `${toolName ?? ''}\u0000${toolArgs}`
}

export type JevPruningMissRecord = {
  toolName: string | undefined
  /** The call whose result was pruned and has now been re-run. */
  prunedToolCallId: string
  /** The new call that re-ran it. */
  repeatedToolCallId: string
}

export class JevPruningFeedback {
  /** Signature -> the pruned call that produced it, per session. */
  private readonly pruned = new Map<string, Map<string, string>>()
  private readonly misses = new Map<string, JevPruningMissRecord[]>()

  /** Records the results pruned this pass, so a later re-run can be recognised. */
  recordPruned(
    sessionId: string,
    entries: readonly { toolCallId: string; toolName?: string; toolArgs: string }[]
  ): void {
    if (entries.length === 0) return

    let signatures = this.pruned.get(sessionId)
    if (!signatures) {
      signatures = new Map()
      this.pruned.set(sessionId, signatures)
    }

    for (const entry of entries) {
      const signature = pruningInvocationSignature(entry.toolName, entry.toolArgs)
      // First writer wins: the oldest pruned call is the one whose removal the agent is reacting to.
      if (!signatures.has(signature)) signatures.set(signature, entry.toolCallId)
    }
  }

  /**
   * Observes a tool invocation and reports whether it re-runs something whose result was pruned.
   *
   * Called for every tool result, so it must stay cheap — a string build and two map lookups.
   */
  observeToolCall(params: {
    sessionId: string
    toolCallId: string
    toolName?: string
    toolArgs: string
  }): boolean {
    const prunedToolCallId = this.pruned
      .get(params.sessionId)
      ?.get(pruningInvocationSignature(params.toolName, params.toolArgs))

    if (!prunedToolCallId || prunedToolCallId === params.toolCallId) return false

    const record: JevPruningMissRecord = {
      toolName: params.toolName,
      prunedToolCallId,
      repeatedToolCallId: params.toolCallId
    }
    const existing = this.misses.get(params.sessionId)
    if (existing) existing.push(record)
    else this.misses.set(params.sessionId, [record])

    return true
  }

  missCount(sessionId: string): number {
    return this.misses.get(sessionId)?.length ?? 0
  }

  missesFor(sessionId: string): readonly JevPruningMissRecord[] {
    return this.misses.get(sessionId) ?? []
  }

  /**
   * Whether pruning may still run for this session, and at what thresholds.
   *
   * Returns `null` once enough misses have accumulated. An empty object means the caller's defaults
   * apply; a `dropBelow` narrows the band in which anything is deleted at all.
   */
  policyFor(sessionId: string): { dropBelow?: number } | null {
    const misses = this.missCount(sessionId)
    if (misses >= JEV_PRUNING_MAX_MISSES) return null
    if (misses > 0) return { dropBelow: JEV_PRUNING_TIGHTENED_DROP_BELOW }
    return {}
  }

  /** Drops a session's state once its run ends, so the maps do not grow with session count. */
  clear(sessionId: string): void {
    this.pruned.delete(sessionId)
    this.misses.delete(sessionId)
  }
}
