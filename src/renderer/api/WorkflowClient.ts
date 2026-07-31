import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  workflowLogEvent,
  workflowRunChangedEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import {
  workflowCancelRoute,
  workflowInspectRoute,
  workflowListRoute,
  workflowResumeRoute,
  workflowRetryRoute,
  workflowSynthesizeRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createWorkflowClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function list(parentSessionId: string, limit = 100) {
    return workflowListRoute.output.parse(
      await bridge.invoke(workflowListRoute.name, {
        parentSessionId,
        limit
      })
    ).runs
  }

  async function inspect(parentSessionId: string, runId: string) {
    return workflowInspectRoute.output.parse(
      await bridge.invoke(workflowInspectRoute.name, {
        parentSessionId,
        runId
      })
    ).run
  }

  async function cancel(parentSessionId: string, runId: string, reason?: string) {
    return workflowCancelRoute.output.parse(
      await bridge.invoke(workflowCancelRoute.name, {
        parentSessionId,
        runId,
        reason
      })
    ).run
  }

  async function resume(parentSessionId: string, runId: string) {
    return workflowResumeRoute.output.parse(
      await bridge.invoke(workflowResumeRoute.name, {
        parentSessionId,
        runId
      })
    ).run
  }

  async function retry(
    parentSessionId: string,
    runId: string,
    invocationId: string,
    options?: {
      fromHere?: boolean
      confirmEffects?: boolean
    }
  ) {
    return workflowRetryRoute.output.parse(
      await bridge.invoke(workflowRetryRoute.name, {
        parentSessionId,
        runId,
        invocationId,
        fromHere: options?.fromHere ?? false,
        confirmEffects: options?.confirmEffects ?? false
      })
    ).run
  }

  async function synthesize(parentSessionId: string, runId: string) {
    return workflowSynthesizeRoute.output.parse(
      await bridge.invoke(workflowSynthesizeRoute.name, {
        parentSessionId,
        runId
      })
    ).receipt
  }

  function onRunChanged(
    listener: (payload: DeepchatEventPayload<typeof workflowRunChangedEvent.name>) => void
  ) {
    return bridge.on(workflowRunChangedEvent.name, listener)
  }

  function onLog(listener: (payload: DeepchatEventPayload<typeof workflowLogEvent.name>) => void) {
    return bridge.on(workflowLogEvent.name, listener)
  }

  return {
    list,
    inspect,
    cancel,
    resume,
    retry,
    synthesize,
    onRunChanged,
    onLog
  }
}

export type WorkflowClient = ReturnType<typeof createWorkflowClient>
