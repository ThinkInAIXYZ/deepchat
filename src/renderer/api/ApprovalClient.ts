import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  approvalClosedEvent,
  approvalRequestedEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import { approvalsResolveRoute } from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createApprovalClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  return {
    onRequested(
      listener: (payload: DeepchatEventPayload<typeof approvalRequestedEvent.name>) => void
    ) {
      return bridge.on(approvalRequestedEvent.name, listener)
    },
    onClosed(listener: (payload: DeepchatEventPayload<typeof approvalClosedEvent.name>) => void) {
      return bridge.on(approvalClosedEvent.name, listener)
    },
    async resolve(requestId: string, decision: 'approved' | 'denied'): Promise<boolean> {
      const result = await bridge.invoke(approvalsResolveRoute.name, { requestId, decision })
      return result.accepted
    }
  }
}

export type ApprovalClient = ReturnType<typeof createApprovalClient>
