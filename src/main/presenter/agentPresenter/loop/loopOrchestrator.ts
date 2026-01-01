import type { LLMAgentEvent, LLMAgentEventData } from '@shared/presenter'

type LLMEventConsumer = {
  handleLLMAgentResponse: (msg: LLMAgentEventData) => Promise<void>
  handleLLMAgentError: (msg: LLMAgentEventData) => Promise<void>
  handleLLMAgentEnd: (msg: LLMAgentEventData) => Promise<void>
}

export class LoopOrchestrator {
  constructor(private readonly consumer: LLMEventConsumer) {}

  async consume(stream: AsyncGenerator<LLMAgentEvent, void, unknown>): Promise<void> {
    for await (const event of stream) {
      const msg = event.data
      if (event.type === 'response') {
        await this.consumer.handleLLMAgentResponse(msg)
      } else if (event.type === 'error') {
        await this.consumer.handleLLMAgentError(msg)
      } else if (event.type === 'end') {
        await this.consumer.handleLLMAgentEnd(msg)
      }
    }
  }
}
