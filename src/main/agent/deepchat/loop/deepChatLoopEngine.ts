import { enterProviderRound, type LoopRun } from './loopRun'

export const MAX_TOOL_CALLS = 128

export type ProviderRoundOutcome<TToolBatch, THalted> =
  | { type: 'terminal' }
  | { type: 'tool_batch'; batch: TToolBatch; toolCallCount: number }
  | { type: 'halted'; result: THalted }

export type LoopToolBatchOutcome<THalted> =
  | { type: 'continue'; executedToolCount: number }
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
  consumeProviderRound(input: {
    run: LoopRun<TStreamState>
    providerRound: number
  }): Promise<ProviderRoundOutcome<TToolBatch, THalted>>
  executeToolBatch(input: {
    run: LoopRun<TStreamState>
    providerRound: number
    batch: TToolBatch
  }): Promise<LoopToolBatchOutcome<THalted>>
}

export interface DeepChatLoopCommitCallbacks<TStreamState, THalted, TResult> {
  updateOutput(input: {
    run: LoopRun<TStreamState>
    providerRound: number
    outcome: ProviderRoundOutcome<unknown, unknown>['type']
  }): Promise<void> | void
  afterRoundPersisted(input: {
    run: LoopRun<TStreamState>
    providerRound: number
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
      Number.isInteger(dependencies.maxProviderRounds) && dependencies.maxProviderRounds! > 0
        ? dependencies.maxProviderRounds!
        : Number.POSITIVE_INFINITY
    let executedToolCount =
      Number.isInteger(dependencies.initialExecutedToolCount) &&
      dependencies.initialExecutedToolCount! > 0
        ? dependencies.initialExecutedToolCount!
        : 0

    while (true) {
      const providerRound = enterProviderRound(run)
      if (providerRound > maxProviderRounds) {
        return { type: 'max_provider_rounds', limit: maxProviderRounds }
      }

      const providerOutcome = await dependencies.consumeProviderRound({ run, providerRound })
      await commits.updateOutput({
        run,
        providerRound,
        outcome: providerOutcome.type
      })
      if (providerOutcome.type === 'terminal') {
        return { type: 'terminal' }
      }
      if (providerOutcome.type === 'halted') {
        return providerOutcome
      }

      const attemptedToolCount = executedToolCount + providerOutcome.toolCallCount
      if (attemptedToolCount > MAX_TOOL_CALLS) {
        return {
          type: 'max_tool_calls',
          attemptedToolCount,
          limit: MAX_TOOL_CALLS
        }
      }

      const toolOutcome = await dependencies.executeToolBatch({
        run,
        providerRound,
        batch: providerOutcome.batch
      })
      await commits.afterRoundPersisted({
        run,
        providerRound,
        outcome: toolOutcome.type
      })
      if (toolOutcome.type === 'halted') {
        return toolOutcome
      }
      executedToolCount += toolOutcome.executedToolCount
    }
  }
}
