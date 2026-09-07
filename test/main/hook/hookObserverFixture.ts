import { vi } from 'vitest'
import type { HookEvent } from '@/hook/events'
import type { HookObserver } from '@/hook/observer'

export const createHookObserver = (dispatcher: {
  dispatchEvent: ReturnType<typeof vi.fn>
}): HookObserver => ({
  isObserved: () => true,
  notify(event: HookEvent) {
    dispatcher.dispatchEvent(event.event, {
      conversationId: event.session.sessionId,
      agentId: event.session.agentId,
      workdir: event.session.projectDir,
      messageId: event.session.messageId,
      providerId: event.session.providerId,
      modelId: event.session.modelId,
      promptPreview: 'promptPreview' in event ? event.promptPreview : undefined,
      tool: 'tool' in event ? event.tool : undefined,
      permission: 'permission' in event ? event.permission : undefined,
      stop: 'stop' in event ? event.stop : undefined,
      usage: 'usage' in event ? event.usage : undefined,
      error: 'error' in event ? event.error : undefined
    })
  }
})

export const noopHookObserver: HookObserver = { isObserved: () => true, notify: vi.fn() }
