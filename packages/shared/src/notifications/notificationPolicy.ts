export const NOTIFICATION_PRIORITIES = Object.freeze({
  success: 10,
  info: 20,
  progress: 25,
  warning: 30,
  error: 40,
  actionable: Object.freeze({
    normal: 50,
    high: 60,
    critical: 70,
    untilResolved: 80
  })
})

export const NOTIFICATION_POLICY_DEFAULTS = Object.freeze({
  displayBudgetMs: Object.freeze({
    success: 2_400,
    info: 4_000,
    warning: 6_000,
    error: 8_000
  }),
  maxLifetimeMs: Object.freeze({
    success: 15_000,
    info: 30_000,
    warning: 45_000,
    error: 60_000
  }),
  inlineSuccessDisplayBudgetMs: 2_000,
  surfaceHandoffGraceMs: 200,
  transientCandidateFreshnessMs: 8_000,
  actionableQueueCapacity: 3,
  actionableQueueTtlMs: 10 * 60_000,
  mainPendingActionableCapacity: 16,
  mainPendingActionableTtlMs: 10 * 60_000,
  inferredRecoveryQuietTtlMs: 30_000
})
