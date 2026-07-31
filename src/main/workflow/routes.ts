import {
  workflowCancelRoute,
  workflowInspectRoute,
  workflowLaunchRoute,
  workflowListRoute,
  workflowPrepareLaunchRoute,
  workflowResumeRoute,
  workflowRetryRoute,
  workflowSynthesizeRoute
} from '@shared/contracts/routes'
import type { WorkflowRun } from '@shared/workflow/domain'
import type { WorkflowWaitingInteractionProjection } from '@shared/workflow/projection'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import type { WorkflowService } from './service'
import { projectWorkflowRunDetail, projectWorkflowRunSummaryWithCounts } from './projection'

export interface WorkflowRouteOptions {
  resolveWaitingInteractions?: (
    childSessionId: string
  ) => readonly WorkflowWaitingInteractionProjection[]
}

export function createWorkflowRoutes(
  service: WorkflowService,
  options: WorkflowRouteOptions = {}
): DeepchatRouteMap {
  const summarize = (run: WorkflowRun) => {
    const counts = service.getInvocationCounts([run.id]).get(run.id)
    if (!counts) {
      throw new Error(`Workflow invocation counts are unavailable for run ${run.id}.`)
    }
    return projectWorkflowRunSummaryWithCounts(run, counts)
  }

  const requireOwnedRun = (parentSessionId: string, runId: string): WorkflowRun => {
    const run = service.getRun(runId)
    if (run.parentSessionId !== parentSessionId) {
      throw new Error(`Workflow run ${runId} does not belong to session ${parentSessionId}.`)
    }
    return run
  }

  return createRouteMap([
    [
      workflowPrepareLaunchRoute.name,
      async (rawInput) => {
        const input = workflowPrepareLaunchRoute.input.parse(rawInput)
        return workflowPrepareLaunchRoute.output.parse({
          approval: await service.prepareLaunch(input)
        })
      }
    ],
    [
      workflowLaunchRoute.name,
      async (rawInput) => {
        const input = workflowLaunchRoute.input.parse(rawInput)
        const run = await service.launch(input.approvalId, input.parentSessionId)
        return workflowLaunchRoute.output.parse({ run: summarize(run) })
      }
    ],
    [
      workflowListRoute.name,
      async (rawInput) => {
        const input = workflowListRoute.input.parse(rawInput)
        const runs = service.listRuns(input.parentSessionId, input.limit)
        const counts = service.getInvocationCounts(runs.map((run) => run.id))
        return workflowListRoute.output.parse({
          runs: runs.map((run) => {
            const runCounts = counts.get(run.id)
            if (!runCounts) {
              throw new Error(`Workflow invocation counts are unavailable for run ${run.id}.`)
            }
            return projectWorkflowRunSummaryWithCounts(run, runCounts)
          })
        })
      }
    ],
    [
      workflowInspectRoute.name,
      async (rawInput) => {
        const input = workflowInspectRoute.input.parse(rawInput)
        const run = requireOwnedRun(input.parentSessionId, input.runId)
        const invocations = service.listInvocations(run.id)
        const waitingInteractions = new Map<
          string,
          readonly WorkflowWaitingInteractionProjection[]
        >()
        for (const invocation of invocations) {
          if (invocation.status !== 'waiting_interaction' || !invocation.childSessionId) {
            continue
          }
          waitingInteractions.set(
            invocation.id,
            options.resolveWaitingInteractions?.(invocation.childSessionId) ?? []
          )
        }
        return workflowInspectRoute.output.parse({
          run: projectWorkflowRunDetail(run, invocations, waitingInteractions)
        })
      }
    ],
    [
      workflowCancelRoute.name,
      async (rawInput) => {
        const input = workflowCancelRoute.input.parse(rawInput)
        requireOwnedRun(input.parentSessionId, input.runId)
        return workflowCancelRoute.output.parse({
          run: summarize(service.cancel(input.runId, input.reason))
        })
      }
    ],
    [
      workflowResumeRoute.name,
      async (rawInput) => {
        const input = workflowResumeRoute.input.parse(rawInput)
        requireOwnedRun(input.parentSessionId, input.runId)
        return workflowResumeRoute.output.parse({
          run: summarize(service.resume(input.runId))
        })
      }
    ],
    [
      workflowRetryRoute.name,
      async (rawInput) => {
        const input = workflowRetryRoute.input.parse(rawInput)
        requireOwnedRun(input.parentSessionId, input.runId)
        return workflowRetryRoute.output.parse({
          run: summarize(
            service.retryInvocation({
              runId: input.runId,
              invocationId: input.invocationId,
              fromHere: input.fromHere,
              confirmEffects: input.confirmEffects
            })
          )
        })
      }
    ],
    [
      workflowSynthesizeRoute.name,
      async (rawInput) => {
        const input = workflowSynthesizeRoute.input.parse(rawInput)
        requireOwnedRun(input.parentSessionId, input.runId)
        return workflowSynthesizeRoute.output.parse({
          receipt: await service.synthesize(input.runId)
        })
      }
    ]
  ])
}
