import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  workflowLogEvent,
  workflowRunChangedEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import {
  workflowCancelRoute,
  workflowInspectRoute,
  workflowLaunchRoute,
  workflowListRoute,
  workflowResumeRoute,
  workflowRetryRoute,
  workflowSavedListRoute,
  workflowSavedPrepareLaunchRoute,
  workflowSavedReadRoute,
  workflowSavedSaveRoute,
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

  async function launch(parentSessionId: string, approvalId: string) {
    return workflowLaunchRoute.output.parse(
      await bridge.invoke(workflowLaunchRoute.name, {
        parentSessionId,
        approvalId
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

  async function listSaved(parentSessionId: string) {
    return workflowSavedListRoute.output.parse(
      await bridge.invoke(workflowSavedListRoute.name, {
        parentSessionId
      })
    )
  }

  async function readSaved(parentSessionId: string, name: string) {
    return workflowSavedReadRoute.output.parse(
      await bridge.invoke(workflowSavedReadRoute.name, {
        parentSessionId,
        name
      })
    ).workflow
  }

  async function saveSaved(
    parentSessionId: string,
    input: {
      name: string
      source: string
      expectedSourceHash: string | null
    }
  ) {
    return workflowSavedSaveRoute.output.parse(
      await bridge.invoke(workflowSavedSaveRoute.name, {
        parentSessionId,
        ...input
      })
    ).workflow
  }

  async function prepareSavedLaunch(
    parentSessionId: string,
    input: {
      name: string
      argsText: string
      expectedSourceHash: string
      allowedAgentIds?: string[]
    }
  ) {
    return workflowSavedPrepareLaunchRoute.output.parse(
      await bridge.invoke(workflowSavedPrepareLaunchRoute.name, {
        parentSessionId,
        ...input
      })
    ).approval
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
    launch,
    cancel,
    resume,
    retry,
    synthesize,
    listSaved,
    readSaved,
    saveSaved,
    prepareSavedLaunch,
    onRunChanged,
    onLog
  }
}

export type WorkflowClient = ReturnType<typeof createWorkflowClient>
