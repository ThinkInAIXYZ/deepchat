export type MaintenanceBudgetStep = 'challenge' | 'merge' | 'reflection' | 'persona'

export const MAINTENANCE_CHALLENGE_MAX_LLM_CALLS = 4
export const MAINTENANCE_MERGE_MAX_LLM_CALLS = 2
export const MAINTENANCE_REFLECTION_MAX_LLM_CALLS = 1
export const MAINTENANCE_PERSONA_MAX_LLM_CALLS = 1
export const MAINTENANCE_TOTAL_MAX_LLM_CALLS = 8
export const MAINTENANCE_MAX_INPUT_TOKENS = 24_000

const STEP_CALL_LIMITS: Record<MaintenanceBudgetStep, number> = {
  challenge: MAINTENANCE_CHALLENGE_MAX_LLM_CALLS,
  merge: MAINTENANCE_MERGE_MAX_LLM_CALLS,
  reflection: MAINTENANCE_REFLECTION_MAX_LLM_CALLS,
  persona: MAINTENANCE_PERSONA_MAX_LLM_CALLS
}

export interface MaintenanceBudgetSnapshot {
  calls: number
  inputTokens: number
  callsByStep: Record<MaintenanceBudgetStep, number>
  deniedByStep: Record<MaintenanceBudgetStep, number>
}

export function selectMaintenanceRowsWithinTokenBudget<T>(
  rows: readonly T[],
  availableTokens: number,
  estimateRowTokens: (row: T) => number
): T[] {
  const selected: T[] = []
  let selectedTokens = 0
  for (const row of rows) {
    const rowTokens = Math.max(0, Math.ceil(estimateRowTokens(row)))
    if (selectedTokens + rowTokens > availableTokens) continue
    selected.push(row)
    selectedTokens += rowTokens
  }
  return selected
}

export class MaintenanceBudget {
  private calls = 0
  private inputTokens = 0
  private readonly callsByStep: Record<MaintenanceBudgetStep, number> = {
    challenge: 0,
    merge: 0,
    reflection: 0,
    persona: 0
  }
  private readonly deniedByStep: Record<MaintenanceBudgetStep, number> = {
    challenge: 0,
    merge: 0,
    reflection: 0,
    persona: 0
  }

  reserve(step: MaintenanceBudgetStep, estimatedInputTokens: number): boolean {
    const tokens = Math.max(0, Math.ceil(estimatedInputTokens))
    if (
      this.calls >= MAINTENANCE_TOTAL_MAX_LLM_CALLS ||
      this.callsByStep[step] >= STEP_CALL_LIMITS[step] ||
      this.inputTokens + tokens > MAINTENANCE_MAX_INPUT_TOKENS
    ) {
      this.deniedByStep[step] += 1
      return false
    }
    this.calls += 1
    this.callsByStep[step] += 1
    this.inputTokens += tokens
    return true
  }

  snapshot(): MaintenanceBudgetSnapshot {
    return {
      calls: this.calls,
      inputTokens: this.inputTokens,
      callsByStep: { ...this.callsByStep },
      deniedByStep: { ...this.deniedByStep }
    }
  }
}
