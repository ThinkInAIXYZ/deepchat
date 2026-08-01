import {
  workflowCancelRoute,
  workflowGetCapabilityRoute,
  workflowInspectRoute,
  workflowLaunchRoute,
  workflowListRoute,
  workflowPrepareLaunchRoute,
  workflowResumeRoute,
  workflowRetryRoute,
  workflowSavedListRoute,
  workflowSavedPrepareLaunchRoute,
  workflowSavedReadRoute,
  workflowSavedSaveRoute,
  workflowSetModeRoute,
  workflowSynthesizeRoute
} from '@shared/contracts/routes'
import type { WorkflowRun } from '@shared/workflow/domain'
import type { WorkflowWaitingInteractionProjection } from '@shared/workflow/projection'
import type { WorkflowSavedCatalog, WorkflowSavedDocument } from '@shared/workflow/savedWorkflow'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import type { WorkflowService } from './service'
import { projectWorkflowRunDetail, projectWorkflowRunSummaryWithCounts } from './projection'
import { parseWorkflowSavedArgs } from './savedWorkflowArgs'
import type {
  SessionOrchestrationMode,
  WorkflowCapability
} from '@shared/workflow/orchestrationMode'

export interface WorkflowSavedRoutePort {
  list(workspacePath: string | null): Promise<WorkflowSavedCatalog>
  read(workspacePath: string | null, name: string): Promise<WorkflowSavedDocument>
  save(input: {
    workspacePath: string | null
    name: string
    source: string
    expectedSourceHash: string | null
  }): Promise<WorkflowSavedDocument>
}

export interface WorkflowRouteOptions {
  resolveWaitingInteractions?: (
    childSessionId: string
  ) => readonly WorkflowWaitingInteractionProjection[]
  savedWorkflows?: {
    store: WorkflowSavedRoutePort
    resolveContext(parentSessionId: string): Promise<{
      workspacePath: string | null
      defaultAgentId: string
    }>
  }
  sessionMode?: {
    resolveCapability(
      target: { parentSessionId: string } | { agentId: string }
    ): Promise<WorkflowCapability>
    get(parentSessionId: string): Promise<SessionOrchestrationMode>
    update(
      parentSessionId: string,
      mode: SessionOrchestrationMode
    ): Promise<SessionOrchestrationMode>
  }
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

  const requireSavedWorkflows = () => {
    if (!options.savedWorkflows) {
      throw new Error('Saved workflows are unavailable.')
    }
    return options.savedWorkflows
  }

  const requireSessionMode = () => {
    if (!options.sessionMode) {
      throw new Error('Workflow session mode is unavailable.')
    }
    return options.sessionMode
  }

  return createRouteMap([
    [
      workflowGetCapabilityRoute.name,
      async (rawInput) => {
        const input = workflowGetCapabilityRoute.input.parse(rawInput)
        const mode = requireSessionMode()
        return workflowGetCapabilityRoute.output.parse({
          capability: await mode.resolveCapability(input)
        })
      }
    ],
    [
      workflowSetModeRoute.name,
      async (rawInput) => {
        const input = workflowSetModeRoute.input.parse(rawInput)
        const mode = requireSessionMode()
        const capability = await mode.resolveCapability({ parentSessionId: input.parentSessionId })
        if (input.mode === 'workflow' && !capability.available) {
          return workflowSetModeRoute.output.parse({
            applied: false,
            mode: await mode.get(input.parentSessionId),
            capability
          })
        }
        return workflowSetModeRoute.output.parse({
          applied: true,
          mode: await mode.update(input.parentSessionId, input.mode),
          capability
        })
      }
    ],
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
    ],
    [
      workflowSavedListRoute.name,
      async (rawInput) => {
        const input = workflowSavedListRoute.input.parse(rawInput)
        const saved = requireSavedWorkflows()
        const context = await saved.resolveContext(input.parentSessionId)
        return workflowSavedListRoute.output.parse(await saved.store.list(context.workspacePath))
      }
    ],
    [
      workflowSavedReadRoute.name,
      async (rawInput) => {
        const input = workflowSavedReadRoute.input.parse(rawInput)
        const saved = requireSavedWorkflows()
        const context = await saved.resolveContext(input.parentSessionId)
        return workflowSavedReadRoute.output.parse({
          workflow: await saved.store.read(context.workspacePath, input.name)
        })
      }
    ],
    [
      workflowSavedSaveRoute.name,
      async (rawInput) => {
        const input = workflowSavedSaveRoute.input.parse(rawInput)
        const saved = requireSavedWorkflows()
        const context = await saved.resolveContext(input.parentSessionId)
        return workflowSavedSaveRoute.output.parse({
          workflow: await saved.store.save({
            workspacePath: context.workspacePath,
            name: input.name,
            source: input.source,
            expectedSourceHash: input.expectedSourceHash
          })
        })
      }
    ],
    [
      workflowSavedPrepareLaunchRoute.name,
      async (rawInput) => {
        const input = workflowSavedPrepareLaunchRoute.input.parse(rawInput)
        const saved = requireSavedWorkflows()
        const context = await saved.resolveContext(input.parentSessionId)
        const workflow = await saved.store.read(context.workspacePath, input.name)
        if (workflow.sourceHash !== input.expectedSourceHash) {
          throw new Error('The saved workflow changed since it was loaded.')
        }
        return workflowSavedPrepareLaunchRoute.output.parse({
          approval: await service.prepareLaunch(
            {
              parentSessionId: input.parentSessionId,
              namedWorkflowPath: workflow.absolutePath,
              scriptSource: workflow.source,
              input: parseWorkflowSavedArgs(input.argsText),
              allowedAgentIds: input.allowedAgentIds ?? [context.defaultAgentId]
            },
            {
              expectedWorkspacePath: context.workspacePath
            }
          )
        })
      }
    ]
  ])
}
