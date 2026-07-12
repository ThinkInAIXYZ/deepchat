import { enterProviderRound, type LoopRun } from './loopRun'

const MAX_TOOL_CALLS = 128

export type ProviderRoundOutcome<TToolBatch, THalted> =
  | { type: 'terminal' }
  | { type: 'tool_batch'; batch: TToolBatch; toolCallCount: number }
  | { type: 'halted'; result: THalted }

export type ToolBatchOutcome<THalted> =
  | { type: 'continue'; executedToolCount: number }
  | { type: 'halted'; result: THalted }

export type DeepChatLoopOutcome<THalted> =
  | { type: 'terminal' }
  | { type: 'max_provider_rounds'; limit: number }
  | { type: 'max_tool_calls'; attemptedToolCount: number; limit: number }
  | { type: 'halted'; result: THalted }

export interface DeepChatLoopDependencies<TStreamState, TToolBatch, THalted> {
  maxProviderRounds?: number
  consumeProviderRound(input: {
    run: LoopRun<TStreamState>
    providerRound: number
  }): Promise<ProviderRoundOutcome<TToolBatch, THalted>>
  executeToolBatch(input: {
    run: LoopRun<TStreamState>
    providerRound: number
    batch: TToolBatch
  }): Promise<ToolBatchOutcome<THalted>>
}

export class DeepChatLoopEngine {
  async run<TStreamState, TToolBatch, THalted>(
    run: LoopRun<TStreamState>,
    dependencies: DeepChatLoopDependencies<TStreamState, TToolBatch, THalted>
  ): Promise<DeepChatLoopOutcome<THalted>> {
    const maxProviderRounds =
      Number.isInteger(dependencies.maxProviderRounds) && dependencies.maxProviderRounds! > 0
        ? dependencies.maxProviderRounds!
        : Number.POSITIVE_INFINITY
    let executedToolCount = 0

    while (true) {
      const providerRound = enterProviderRound(run)
      if (providerRound > maxProviderRounds) {
        return { type: 'max_provider_rounds', limit: maxProviderRounds }
      }

      const providerOutcome = await dependencies.consumeProviderRound({ run, providerRound })
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
      if (toolOutcome.type === 'halted') {
        return toolOutcome
      }
      executedToolCount += toolOutcome.executedToolCount
    }
  }
}
