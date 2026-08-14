export interface InputPreparationCheckpoints {
  assertCurrent(): void
}

export interface ExistingInputPreparationCheckpoints extends InputPreparationCheckpoints {
  beforeHistoryRefresh?(): void
}

export interface InitialInputPreparation<TIntent, TSummary, THistory, TProjection> {
  ensureHistory(): THistory
  prepareIntent(history: THistory): Promise<TIntent | null>
  createCompactionProjection(intent: TIntent): TProjection
  appendUserFact(): string
  beginCompaction(intent: TIntent, projection: TProjection): void
  applyCompaction(intent: TIntent, projection: TProjection): Promise<TSummary>
  readSummary(): TSummary
  afterCompactionApplyReturned(intent: TIntent, summary: TSummary): void
  checkpoints: InputPreparationCheckpoints
}

export interface InitialInputPreparationResult<TIntent, TSummary, THistory> {
  history: THistory
  intent: TIntent | null
  summary: TSummary
  userMessageId: string
}

export interface ExistingInputPreparation<TIntent, TSummary, THistory> {
  ensureHistory(): THistory
  refreshHistory?(): THistory
  prepareIntent(history: THistory): Promise<TIntent | null>
  applyCompaction(intent: TIntent): Promise<TSummary>
  readSummary(): TSummary
  afterCompactionApplyReturned?(intent: TIntent, summary: TSummary): void
  checkpoints: ExistingInputPreparationCheckpoints
}

export interface ExistingInputPreparationResult<TIntent, TSummary, THistory> {
  history: THistory
  intent: TIntent | null
  summary: TSummary
}

export class InputPreparationCoordinator {
  async prepareInitial<TIntent, TSummary, THistory, TProjection>(
    input: InitialInputPreparation<TIntent, TSummary, THistory, TProjection>
  ): Promise<InitialInputPreparationResult<TIntent, TSummary, THistory>> {
    input.checkpoints.assertCurrent()
    const history = input.ensureHistory()
    const intent = await input.prepareIntent(history)
    input.checkpoints.assertCurrent()

    if (!intent) {
      const summary = input.readSummary()
      const userMessageId = input.appendUserFact()
      return { history, intent, summary, userMessageId }
    }

    const projection = input.createCompactionProjection(intent)
    const userMessageId = input.appendUserFact()
    input.beginCompaction(intent, projection)
    const summary = await input.applyCompaction(intent, projection)
    input.checkpoints.assertCurrent()
    input.afterCompactionApplyReturned(intent, summary)

    return { history, intent, summary, userMessageId }
  }

  async prepareExisting<TIntent, TSummary, THistory>(
    input: ExistingInputPreparation<TIntent, TSummary, THistory>
  ): Promise<ExistingInputPreparationResult<TIntent, TSummary, THistory>> {
    input.checkpoints.assertCurrent()
    const history = input.ensureHistory()
    const intent = await input.prepareIntent(history)
    input.checkpoints.assertCurrent()

    if (!intent) {
      const summary = input.readSummary()
      const refreshedHistory = this.refreshExistingHistory(input, history)
      return {
        history: refreshedHistory,
        intent,
        summary
      }
    }

    const summary = await input.applyCompaction(intent)
    input.checkpoints.assertCurrent()
    input.afterCompactionApplyReturned?.(intent, summary)

    return {
      history: this.refreshExistingHistory(input, history),
      intent,
      summary
    }
  }

  private refreshExistingHistory<TIntent, TSummary, THistory>(
    input: ExistingInputPreparation<TIntent, TSummary, THistory>,
    history: THistory
  ): THistory {
    if (!input.refreshHistory) {
      return history
    }
    input.checkpoints.beforeHistoryRefresh?.()
    return input.refreshHistory()
  }
}
