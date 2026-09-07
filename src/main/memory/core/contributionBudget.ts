export const MEMORY_CONTRIBUTION_BUDGET_POLICY_VERSION = 1

// At the default 1,200-token total, even a full directive lane leaves enough capacity for every
// memory guarantee plus container overhead. Persona and working may grow only to their ceilings;
// query recall receives the remaining borrowed capacity because it is turn-specific.
export const DIRECTIVE_TOKEN_CEILING = 512
export const PERSONA_TOKEN_FLOOR = 128
export const PERSONA_TOKEN_CEILING = 320
export const WORKING_TOKEN_FLOOR = 192
export const WORKING_TOKEN_CEILING = 480
export const QUERY_RECALL_TOKEN_RESERVATION = 256

export type MemoryContributionBudgetLane = 'directive' | 'persona' | 'working' | 'queryRecall'

export type MemoryContributionTokenMap = Record<MemoryContributionBudgetLane, number>

export interface MemoryContributionBudgetDecision {
  policyVersion: typeof MEMORY_CONTRIBUTION_BUDGET_POLICY_VERSION
  totalTokenBudget: number
  overheadTokens: number
  demand: MemoryContributionTokenMap
  allocated: MemoryContributionTokenMap
  borrowed: MemoryContributionTokenMap
  unallocatedTokens: number
  constrained: boolean
}

export interface MemoryContributionBudgetManifest extends MemoryContributionBudgetDecision {
  used: MemoryContributionTokenMap
  estimatedTotalTokens: number
  unusedTokens: number
}

interface MemoryContributionBudgetInput {
  totalTokenBudget: number
  overheadTokens: number
  demand: MemoryContributionTokenMap
  minimumViable?: Partial<MemoryContributionTokenMap>
}

const MEMORY_LANES = ['persona', 'working', 'queryRecall'] as const
const CONSTRAINED_LANE_PRIORITY = ['queryRecall', 'persona', 'working'] as const

function toNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function emptyTokenMap(): MemoryContributionTokenMap {
  return {
    directive: 0,
    persona: 0,
    working: 0,
    queryRecall: 0
  }
}

function allocateFairly(
  allocated: MemoryContributionTokenMap,
  targets: MemoryContributionTokenMap,
  admitted: ReadonlySet<(typeof MEMORY_LANES)[number]>,
  availableTokens: number
): number {
  let remaining = availableTokens
  while (remaining > 0) {
    let progressed = false
    for (const lane of MEMORY_LANES) {
      if (remaining === 0) break
      if (!admitted.has(lane)) continue
      if (allocated[lane] >= targets[lane]) continue
      allocated[lane] += 1
      remaining -= 1
      progressed = true
    }
    if (!progressed) break
  }
  return remaining
}

function growLane(
  lane: (typeof MEMORY_LANES)[number],
  ceiling: number,
  demand: MemoryContributionTokenMap,
  allocated: MemoryContributionTokenMap,
  admitted: ReadonlySet<(typeof MEMORY_LANES)[number]>,
  availableTokens: number
): number {
  if (!admitted.has(lane)) return availableTokens
  const growth = Math.min(
    availableTokens,
    Math.max(0, Math.min(demand[lane], ceiling) - allocated[lane])
  )
  allocated[lane] += growth
  return availableTokens - growth
}

export function allocateMemoryContributionBudget(
  input: MemoryContributionBudgetInput
): MemoryContributionBudgetDecision {
  const totalTokenBudget = toNonNegativeInteger(input.totalTokenBudget)
  const requestedOverhead = toNonNegativeInteger(input.overheadTokens)
  const demand: MemoryContributionTokenMap = {
    directive: toNonNegativeInteger(input.demand.directive),
    persona: toNonNegativeInteger(input.demand.persona),
    working: toNonNegativeInteger(input.demand.working),
    queryRecall: toNonNegativeInteger(input.demand.queryRecall)
  }
  const allocated = emptyTokenMap()
  const minimumViable = emptyTokenMap()
  for (const lane of MEMORY_LANES) {
    minimumViable[lane] = Math.min(
      demand[lane],
      toNonNegativeInteger(input.minimumViable?.[lane] ?? 0)
    )
  }

  allocated.directive = Math.min(demand.directive, DIRECTIVE_TOKEN_CEILING, totalTokenBudget)
  let remaining = totalTokenBudget - allocated.directive

  const hasMemoryDemand = MEMORY_LANES.some((lane) => demand[lane] > 0)
  const canReserveOverhead =
    hasMemoryDemand && (requestedOverhead === 0 || remaining > requestedOverhead)
  let overheadTokens = canReserveOverhead ? requestedOverhead : 0
  remaining -= overheadTokens

  const activeLanes = canReserveOverhead ? MEMORY_LANES.filter((lane) => demand[lane] > 0) : []
  const admitted = new Set<(typeof MEMORY_LANES)[number]>()
  const allMinimumsFit =
    activeLanes.reduce((sum, lane) => sum + minimumViable[lane], 0) <= remaining
  const admissionOrder = allMinimumsFit ? activeLanes : CONSTRAINED_LANE_PRIORITY
  for (const lane of admissionOrder) {
    if (demand[lane] <= 0 || remaining < minimumViable[lane]) continue
    allocated[lane] = minimumViable[lane]
    remaining -= minimumViable[lane]
    admitted.add(lane)
  }
  if (admitted.size === 0) {
    remaining += overheadTokens
    overheadTokens = 0
  }

  const guaranteedTargets: MemoryContributionTokenMap = {
    directive: allocated.directive,
    persona: admitted.has('persona') ? Math.min(demand.persona, PERSONA_TOKEN_FLOOR) : 0,
    working: admitted.has('working') ? Math.min(demand.working, WORKING_TOKEN_FLOOR) : 0,
    queryRecall: admitted.has('queryRecall')
      ? Math.min(demand.queryRecall, QUERY_RECALL_TOKEN_RESERVATION)
      : 0
  }
  remaining = allocateFairly(allocated, guaranteedTargets, admitted, remaining)

  remaining = growLane('persona', PERSONA_TOKEN_CEILING, demand, allocated, admitted, remaining)
  remaining = growLane('working', WORKING_TOKEN_CEILING, demand, allocated, admitted, remaining)
  remaining = growLane(
    'queryRecall',
    Number.MAX_SAFE_INTEGER,
    demand,
    allocated,
    admitted,
    remaining
  )

  const borrowed: MemoryContributionTokenMap = {
    directive: 0,
    persona: Math.max(0, allocated.persona - guaranteedTargets.persona),
    working: Math.max(0, allocated.working - guaranteedTargets.working),
    queryRecall: Math.max(0, allocated.queryRecall - guaranteedTargets.queryRecall)
  }
  const constrained =
    requestedOverhead !== overheadTokens ||
    MEMORY_LANES.some((lane) => allocated[lane] < demand[lane]) ||
    allocated.directive < demand.directive

  return {
    policyVersion: MEMORY_CONTRIBUTION_BUDGET_POLICY_VERSION,
    totalTokenBudget,
    overheadTokens,
    demand,
    allocated,
    borrowed,
    unallocatedTokens: remaining,
    constrained
  }
}
