import { enterLogicalRound, type LoopRun } from './loopRun'

export const MAX_TOOL_CALLS = 128

export type LogicalRoundOutcome<TToolBatch, THalted> =
  | { type: 'terminal' }
  | { type: 'tool_batch'; batch: TToolBatch; requestedToolExecutionCount: number }
  | { type: 'halted'; result: THalted }

export type LoopToolBatchOutcome<THalted> =
  | { type: 'continue'; executedToolCount: number }
  | { type: 'terminal'; executedToolCount: number }
  | { type: 'halted'; result: THalted }

export type DeepChatLoopOutcome<THalted> =
  | { type: 'terminal' }
  | { type: 'max_provider_rounds'; limit: number }
  | { type: 'max_tool_calls'; attemptedToolCount: number; limit: number }
  | { type: 'halted'; result: THalted }
  | { type: 'thrown'; error: unknown }

export interface DeepChatLoopDependencies<TStreamState, TToolBatch, THalted> {
  maxProviderRounds?: number
  initialExecutedToolCount?: number
  consumeLogicalRound(input: {
    run: LoopRun<TStreamState>
    logicalRound: number
  }): Promise<LogicalRoundOutcome<TToolBatch, THalted>>
  settleToolBatch(input: {
    run: LoopRun<TStreamState>
    logicalRound: number
    batch: TToolBatch
  }): Promise<LoopToolBatchOutcome<THalted>>
}

export interface DeepChatLoopCommitCallbacks<TStreamState, THalted, TResult> {
  updateOutput(input: {
    run: LoopRun<TStreamState>
    logicalRound: number
    outcome: LogicalRoundOutcome<unknown, unknown>['type']
  }): Promise<void> | void
  afterRoundPersisted(input: {
    run: LoopRun<TStreamState>
    logicalRound: number
    outcome: LoopToolBatchOutcome<unknown>['type']
  }): Promise<void> | void
  settleTurn(input: {
    run: LoopRun<TStreamState>
    outcome: DeepChatLoopOutcome<THalted>
  }): Promise<TResult> | TResult
}

export class DeepChatLoopEngine {
  async run<TStreamState, TToolBatch, THalted, TResult>(
    run: LoopRun<TStreamState>,
    dependencies: DeepChatLoopDependencies<TStreamState, TToolBatch, THalted>,
    commits: DeepChatLoopCommitCallbacks<TStreamState, THalted, TResult>
  ): Promise<TResult> {
    let outcome: DeepChatLoopOutcome<THalted>

    try {
      outcome = await this.runRounds(run, dependencies, commits)
    } catch (error) {
      outcome = { type: 'thrown', error }
    }

    return await commits.settleTurn({ run, outcome })
  }

  private async runRounds<TStreamState, TToolBatch, THalted, TResult>(
    run: LoopRun<TStreamState>,
    dependencies: DeepChatLoopDependencies<TStreamState, TToolBatch, THalted>,
    commits: DeepChatLoopCommitCallbacks<TStreamState, THalted, TResult>
  ): Promise<DeepChatLoopOutcome<THalted>> {
    const maxProviderRounds =
      Number.isSafeInteger(dependencies.maxProviderRounds) && dependencies.maxProviderRounds! > 0
        ? dependencies.maxProviderRounds!
        : Number.POSITIVE_INFINITY
    let executedToolCount =
      Number.isSafeInteger(dependencies.initialExecutedToolCount) &&
      dependencies.initialExecutedToolCount! > 0
        ? dependencies.initialExecutedToolCount!
        : 0

    while (true) {
      if (run.logicalRound >= maxProviderRounds) {
        return { type: 'max_provider_rounds', limit: maxProviderRounds }
      }
      const logicalRound = enterLogicalRound(run)

      const providerOutcome = await dependencies.consumeLogicalRound({ run, logicalRound })
      await commits.updateOutput({
        run,
        logicalRound,
        outcome: providerOutcome.type
      })
      if (providerOutcome.type === 'terminal') {
        return { type: 'terminal' }
      }
      if (providerOutcome.type === 'halted') {
        return providerOutcome
      }

      const attemptedToolCount = executedToolCount + providerOutcome.requestedToolExecutionCount
      if (attemptedToolCount > MAX_TOOL_CALLS) {
        return {
          type: 'max_tool_calls',
          attemptedToolCount,
          limit: MAX_TOOL_CALLS
        }
      }

      const toolOutcome = await dependencies.settleToolBatch({
        run,
        logicalRound,
        batch: providerOutcome.batch
      })
      await commits.afterRoundPersisted({
        run,
        logicalRound,
        outcome: toolOutcome.type
      })
      if (toolOutcome.type === 'halted') {
        return toolOutcome
      }
      executedToolCount += toolOutcome.executedToolCount
      if (toolOutcome.type === 'terminal') {
        return { type: 'terminal' }
      }
    }
  }
}
