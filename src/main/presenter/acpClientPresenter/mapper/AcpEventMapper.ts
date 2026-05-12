import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import { AcpContentMapper } from '@/presenter/llmProviderPresenter/acp'
import type { DeepChatAgentEvent } from '../types'

export class AcpEventMapper {
  private readonly contentMapper = new AcpContentMapper()

  mapSessionUpdate(
    conversationId: string,
    notification: schema.SessionNotification
  ): DeepChatAgentEvent[] {
    const mapped = this.contentMapper.map(notification)
    const events: DeepChatAgentEvent[] = []

    for (const event of mapped.events) {
      if (event.type === 'text' && event.content) {
        events.push({ type: 'message.delta', conversationId, text: event.content })
      }
    }

    for (const block of mapped.blocks) {
      events.push({ type: 'content.block', conversationId, block })
    }

    if (mapped.planEntries) {
      events.push({ type: 'plan.updated', conversationId, entries: mapped.planEntries })
    }
    if (mapped.configState) {
      events.push({ type: 'config.updated', conversationId, configState: mapped.configState })
    }

    return events
  }
}
