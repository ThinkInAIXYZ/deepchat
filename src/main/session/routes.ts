import {
  chatCancelSubmissionRoute,
  chatRespondToolInteractionRoute,
  chatSendMessageRoute,
  chatSteerActiveTurnRoute,
  chatStopStreamRoute,
  sessionsActivateRoute,
  sessionsClearMessagesRoute,
  sessionsCompactRoute,
  sessionsConvertPendingInputToSteerRoute,
  sessionsCreateRoute,
  sessionsDeleteAgentSessionsRoute,
  sessionsDeleteMessageRoute,
  sessionsDeletePendingInputRoute,
  sessionsDeleteRoute,
  sessionsDeactivateRoute,
  sessionsEditUserMessageRoute,
  sessionsEnsureAcpDraftRoute,
  sessionsExportMessageTapeReplaySliceRoute,
  sessionsExportRoute,
  sessionsForkRoute,
  sessionsGetAcpSessionCommandsRoute,
  sessionsGetAcpSessionConfigOptionsRoute,
  sessionsGetActiveRoute,
  sessionsGetAgentsRoute,
  sessionsGetAgentTransferImpactRoute,
  sessionsGetDisabledAgentToolsRoute,
  sessionsGetGenerationSettingsRoute,
  sessionsGetLightweightByIdsRoute,
  sessionsGetPermissionModeRoute,
  sessionsGetSearchResultsRoute,
  sessionsGetTapeContextRoute,
  sessionsGetUsageDashboardRoute,
  sessionsListLightweightRoute,
  sessionsListMessagesPageRoute,
  sessionsListMessageTracesRoute,
  sessionsListPendingInputsRoute,
  sessionsListRoute,
  sessionsMoveAgentSessionsRoute,
  sessionsMoveQueuedInputRoute,
  sessionsMoveToAgentRoute,
  sessionsQueuePendingInputRoute,
  sessionsRenameRoute,
  sessionsRestoreRoute,
  sessionsResolveBlockedPendingInputRoute,
  sessionsRetryMessageRoute,
  sessionsRetryRtkHealthCheckRoute,
  sessionsSearchHistoryRoute,
  sessionsSetAcpSessionConfigOptionRoute,
  sessionsSetModelRoute,
  sessionsSetPermissionModeRoute,
  sessionsSetProjectDirRoute,
  sessionsSteerPendingInputRoute,
  sessionsTogglePinnedRoute,
  sessionsTranslateTextRoute,
  sessionsUpdateDisabledAgentToolsRoute,
  sessionsUpdateGenerationSettingsRoute,
  sessionsUpdateQueuedInputRoute
} from '@shared/contracts/routes'
import type { SessionPermissionPort } from '@/session/contracts'
import type { UsageStatsService } from '@/session/usageStatsService'
import type { AgentSessionExportService } from '@/exporter/agentSessionExporter'
import { listAvailableAgents } from '@/agent/shared/availableAgentCatalog'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import type { Scheduler } from '@/routes/scheduler'
import type { SessionAgentAssignmentPort, SessionLifecyclePort, SessionTurnPort } from './contracts'
import type { SessionQuery } from './query'
import {
  SessionService,
  type SessionServiceDesktopPort,
  type SessionServiceProjectionPort
} from './sessionService'
import { ChatService, type ChatServiceProjectionPort } from './chatService'
import type { SessionHistorySearch } from './sessionHistorySearch'
import type { SessionTranslation } from './sessionTranslation'
import type { AgentSettingsPort } from '@/agent/settings'
import { SubmissionCancellationRegistry } from './submissionCancellationRegistry'

export type SessionRouteProjectionPort = SessionServiceProjectionPort &
  ChatServiceProjectionPort &
  Pick<
    SessionQuery,
    | 'listLightweight'
    | 'getLightweightByIds'
    | 'getSearchResults'
    | 'getTapeContext'
    | 'listMessageTraces'
    | 'listMessageViewManifests'
    | 'exportMessageTapeReplaySlice'
    | 'renameSession'
    | 'toggleSessionPinned'
  >

export function createSessionRoutes(deps: {
  lifecycle: SessionLifecyclePort
  projection: SessionRouteProjectionPort
  desktop: SessionServiceDesktopPort
  turn: SessionTurnPort
  assignment: SessionAgentAssignmentPort
  permission: Pick<SessionPermissionPort, 'clearSessionPermissions'>
  agentSettings: Pick<AgentSettingsPort, 'listAgents' | 'getAcpEnabled'>
  scheduler: Scheduler
  historySearch: Pick<SessionHistorySearch, 'search'>
  exportService: Pick<AgentSessionExportService, 'export'>
  translation: Pick<SessionTranslation, 'translate'>
  usageStats: Pick<UsageStatsService, 'getDashboard'>
  rtkRuntime: { retryHealthCheck(): Promise<unknown> }
}): DeepchatRouteMap {
  const submissionCancellations = new SubmissionCancellationRegistry()
  const sessionService = new SessionService({
    lifecycle: deps.lifecycle,
    projection: deps.projection,
    desktop: deps.desktop,
    scheduler: deps.scheduler
  })
  const chatService = new ChatService({
    turn: deps.turn,
    projection: deps.projection,
    sessionPermissionPort: deps.permission,
    scheduler: deps.scheduler
  })

  async function withSubmissionCancellation<T>(
    webContentsId: number,
    submissionId: string | undefined,
    task: (signal?: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (!submissionId) return await task()
    const registration = submissionCancellations.register(webContentsId, submissionId)
    try {
      return await task(registration.signal)
    } finally {
      registration.unregister()
    }
  }

  return createRouteMap([
    [
      sessionsCreateRoute.name,
      async (rawInput, context) => {
        const input = sessionsCreateRoute.input.parse(rawInput)
        const { submissionId, ...createInput } = input
        const created = await withSubmissionCancellation(
          context.webContentsId,
          submissionId,
          async (signal) =>
            signal
              ? await sessionService.createSession(createInput, context, { signal })
              : await sessionService.createSession(createInput, context)
        )
        const { initialTurn, ...session } = created
        return sessionsCreateRoute.output.parse({
          session,
          ...(initialTurn ? { initialTurn } : {})
        })
      }
    ],
    [
      sessionsRestoreRoute.name,
      async (rawInput) => {
        const input = sessionsRestoreRoute.input.parse(rawInput)
        return sessionsRestoreRoute.output.parse(
          await sessionService.restoreSession(input.sessionId, input.limit)
        )
      }
    ],
    [
      sessionsListMessagesPageRoute.name,
      async (rawInput) => {
        const input = sessionsListMessagesPageRoute.input.parse(rawInput)
        const page = await sessionService.listMessagesPage(input.sessionId, {
          cursor: input.cursor ?? null,
          limit: input.limit
        })
        return sessionsListMessagesPageRoute.output.parse(page)
      }
    ],
    [
      sessionsListRoute.name,
      async (rawInput) => {
        const input = sessionsListRoute.input.parse(rawInput)
        return sessionsListRoute.output.parse({
          sessions: await sessionService.listSessions(input)
        })
      }
    ],
    [
      sessionsListLightweightRoute.name,
      async (rawInput) => {
        const input = sessionsListLightweightRoute.input.parse(rawInput)
        return sessionsListLightweightRoute.output.parse(
          await deps.projection.listLightweight(input)
        )
      }
    ],
    [
      sessionsGetLightweightByIdsRoute.name,
      async (rawInput) => {
        const input = sessionsGetLightweightByIdsRoute.input.parse(rawInput)
        return sessionsGetLightweightByIdsRoute.output.parse({
          items: await deps.projection.getLightweightByIds(input.sessionIds)
        })
      }
    ],
    [
      sessionsActivateRoute.name,
      async (rawInput, context) => {
        const input = sessionsActivateRoute.input.parse(rawInput)
        await sessionService.activateSession(context, input.sessionId)
        return sessionsActivateRoute.output.parse({ activated: true })
      }
    ],
    [
      sessionsDeactivateRoute.name,
      async (rawInput, context) => {
        sessionsDeactivateRoute.input.parse(rawInput)
        await sessionService.deactivateSession(context)
        return sessionsDeactivateRoute.output.parse({ deactivated: true })
      }
    ],
    [
      sessionsGetActiveRoute.name,
      async (rawInput, context) => {
        sessionsGetActiveRoute.input.parse(rawInput)
        return sessionsGetActiveRoute.output.parse({
          session: await sessionService.getActiveSession(context)
        })
      }
    ],
    [
      sessionsEnsureAcpDraftRoute.name,
      async (rawInput) => {
        const input = sessionsEnsureAcpDraftRoute.input.parse(rawInput)
        return sessionsEnsureAcpDraftRoute.output.parse({
          session: await deps.lifecycle.ensureAcpDraftSession(input)
        })
      }
    ],
    [
      sessionsListPendingInputsRoute.name,
      async (rawInput) => {
        const input = sessionsListPendingInputsRoute.input.parse(rawInput)
        return sessionsListPendingInputsRoute.output.parse({
          items: await deps.turn.listPendingInputs(input.sessionId)
        })
      }
    ],
    [
      sessionsQueuePendingInputRoute.name,
      async (rawInput) => {
        const input = sessionsQueuePendingInputRoute.input.parse(rawInput)
        return sessionsQueuePendingInputRoute.output.parse({
          item: await deps.turn.queuePendingInput(input.sessionId, input.content)
        })
      }
    ],
    [
      sessionsUpdateQueuedInputRoute.name,
      async (rawInput) => {
        const input = sessionsUpdateQueuedInputRoute.input.parse(rawInput)
        return sessionsUpdateQueuedInputRoute.output.parse({
          item: await deps.turn.updateQueuedInput(input.sessionId, input.itemId, input.content)
        })
      }
    ],
    [
      sessionsMoveQueuedInputRoute.name,
      async (rawInput) => {
        const input = sessionsMoveQueuedInputRoute.input.parse(rawInput)
        return sessionsMoveQueuedInputRoute.output.parse({
          items: await deps.turn.moveQueuedInput(input.sessionId, input.itemId, input.toIndex)
        })
      }
    ],
    [
      sessionsConvertPendingInputToSteerRoute.name,
      async (rawInput) => {
        const input = sessionsConvertPendingInputToSteerRoute.input.parse(rawInput)
        return sessionsConvertPendingInputToSteerRoute.output.parse({
          item: await deps.turn.convertPendingInputToSteer(input.sessionId, input.itemId)
        })
      }
    ],
    [
      sessionsSteerPendingInputRoute.name,
      async (rawInput) => {
        const input = sessionsSteerPendingInputRoute.input.parse(rawInput)
        return sessionsSteerPendingInputRoute.output.parse({
          item: await deps.turn.steerPendingInput(input.sessionId, input.itemId)
        })
      }
    ],
    [
      sessionsDeletePendingInputRoute.name,
      async (rawInput) => {
        const input = sessionsDeletePendingInputRoute.input.parse(rawInput)
        await deps.turn.deletePendingInput(input.sessionId, input.itemId)
        return sessionsDeletePendingInputRoute.output.parse({ deleted: true })
      }
    ],
    [
      sessionsResolveBlockedPendingInputRoute.name,
      async (rawInput) => {
        const input = sessionsResolveBlockedPendingInputRoute.input.parse(rawInput)
        return sessionsResolveBlockedPendingInputRoute.output.parse({
          item: await deps.turn.resolveBlockedPendingInput(
            input.sessionId,
            input.itemId,
            input.action
          )
        })
      }
    ],
    [
      sessionsRetryMessageRoute.name,
      async (rawInput) => {
        const input = sessionsRetryMessageRoute.input.parse(rawInput)
        const result = input.attachmentFallbackPolicy
          ? await deps.turn.retryMessage(input.sessionId, input.messageId, {
              attachmentFallbackPolicy: input.attachmentFallbackPolicy
            })
          : await deps.turn.retryMessage(input.sessionId, input.messageId)
        const accepted = result.attachmentPreparation?.status !== 'needs_user_action'
        return sessionsRetryMessageRoute.output.parse({
          retried: accepted,
          accepted,
          ...(result.attachmentPreparation
            ? { attachmentPreparation: result.attachmentPreparation }
            : {})
        })
      }
    ],
    [
      sessionsDeleteMessageRoute.name,
      async (rawInput) => {
        const input = sessionsDeleteMessageRoute.input.parse(rawInput)
        await deps.turn.deleteMessage(input.sessionId, input.messageId)
        return sessionsDeleteMessageRoute.output.parse({ deleted: true })
      }
    ],
    [
      sessionsEditUserMessageRoute.name,
      async (rawInput) => {
        const input = sessionsEditUserMessageRoute.input.parse(rawInput)
        return sessionsEditUserMessageRoute.output.parse({
          message: await deps.turn.editUserMessage(input.sessionId, input.messageId, input.text)
        })
      }
    ],
    [
      sessionsForkRoute.name,
      async (rawInput) => {
        const input = sessionsForkRoute.input.parse(rawInput)
        return sessionsForkRoute.output.parse({
          session: await deps.lifecycle.forkSession(
            input.sourceSessionId,
            input.targetMessageId,
            input.newTitle
          )
        })
      }
    ],
    [
      sessionsSearchHistoryRoute.name,
      async (rawInput) => {
        const input = sessionsSearchHistoryRoute.input.parse(rawInput)
        return sessionsSearchHistoryRoute.output.parse({
          hits: await deps.historySearch.search(input.query, input.options)
        })
      }
    ],
    [
      sessionsGetSearchResultsRoute.name,
      async (rawInput) => {
        const input = sessionsGetSearchResultsRoute.input.parse(rawInput)
        return sessionsGetSearchResultsRoute.output.parse({
          results: await deps.projection.getSearchResults(input.messageId, input.searchId)
        })
      }
    ],
    [
      sessionsGetTapeContextRoute.name,
      async (rawInput) => {
        const input = sessionsGetTapeContextRoute.input.parse(rawInput)
        return sessionsGetTapeContextRoute.output.parse({
          context: await deps.projection.getTapeContext(
            input.sessionId,
            input.entryIds,
            input.options
          )
        })
      }
    ],
    [
      sessionsListMessageTracesRoute.name,
      async (rawInput) => {
        const input = sessionsListMessageTracesRoute.input.parse(rawInput)
        const traces = await deps.projection.listMessageTraces(input.messageId)
        const manifests = await deps.projection.listMessageViewManifests(input.messageId)
        return sessionsListMessageTracesRoute.output.parse({ traces, manifests })
      }
    ],
    [
      sessionsExportMessageTapeReplaySliceRoute.name,
      async (rawInput) => {
        const input = sessionsExportMessageTapeReplaySliceRoute.input.parse(rawInput)
        return sessionsExportMessageTapeReplaySliceRoute.output.parse({
          slice: await deps.projection.exportMessageTapeReplaySlice(input.messageId, input.options)
        })
      }
    ],
    [
      sessionsTranslateTextRoute.name,
      async (rawInput) => {
        const input = sessionsTranslateTextRoute.input.parse(rawInput)
        return sessionsTranslateTextRoute.output.parse({
          text: await deps.translation.translate(input.text, input.locale, input.agentId)
        })
      }
    ],
    [
      sessionsGetAgentsRoute.name,
      async (rawInput) => {
        sessionsGetAgentsRoute.input.parse(rawInput)
        return sessionsGetAgentsRoute.output.parse({
          agents: await listAvailableAgents(deps.agentSettings)
        })
      }
    ],
    [
      sessionsGetUsageDashboardRoute.name,
      async (rawInput) => {
        sessionsGetUsageDashboardRoute.input.parse(rawInput)
        return sessionsGetUsageDashboardRoute.output.parse({
          dashboard: await deps.usageStats.getDashboard()
        })
      }
    ],
    [
      sessionsRetryRtkHealthCheckRoute.name,
      async (rawInput) => {
        sessionsRetryRtkHealthCheckRoute.input.parse(rawInput)
        await deps.rtkRuntime.retryHealthCheck()
        return sessionsRetryRtkHealthCheckRoute.output.parse({ retried: true })
      }
    ],
    [
      sessionsRenameRoute.name,
      async (rawInput) => {
        const input = sessionsRenameRoute.input.parse(rawInput)
        return sessionsRenameRoute.output.parse({
          session: await deps.projection.renameSession(input.sessionId, input.title)
        })
      }
    ],
    [
      sessionsTogglePinnedRoute.name,
      async (rawInput) => {
        const input = sessionsTogglePinnedRoute.input.parse(rawInput)
        return sessionsTogglePinnedRoute.output.parse({
          session: await deps.projection.toggleSessionPinned(input.sessionId, input.pinned)
        })
      }
    ],
    [
      sessionsClearMessagesRoute.name,
      async (rawInput) => {
        const input = sessionsClearMessagesRoute.input.parse(rawInput)
        await deps.turn.clearSessionMessages(input.sessionId)
        return sessionsClearMessagesRoute.output.parse({ cleared: true })
      }
    ],
    [
      sessionsCompactRoute.name,
      async (rawInput) => {
        const input = sessionsCompactRoute.input.parse(rawInput)
        return sessionsCompactRoute.output.parse(await deps.turn.compactSession(input.sessionId))
      }
    ],
    [
      sessionsExportRoute.name,
      async (rawInput) => {
        const input = sessionsExportRoute.input.parse(rawInput)
        return sessionsExportRoute.output.parse(
          await deps.exportService.export(input.sessionId, input.format)
        )
      }
    ],
    [
      sessionsDeleteRoute.name,
      async (rawInput) => {
        const input = sessionsDeleteRoute.input.parse(rawInput)
        await deps.lifecycle.deleteSession(input.sessionId)
        return sessionsDeleteRoute.output.parse({ deleted: true })
      }
    ],
    [
      sessionsGetAgentTransferImpactRoute.name,
      async (rawInput) => {
        const input = sessionsGetAgentTransferImpactRoute.input.parse(rawInput)
        return sessionsGetAgentTransferImpactRoute.output.parse({
          impact: await deps.assignment.getAgentTransferImpact(input.agentId)
        })
      }
    ],
    [
      sessionsMoveAgentSessionsRoute.name,
      async (rawInput) => {
        const input = sessionsMoveAgentSessionsRoute.input.parse(rawInput)
        return sessionsMoveAgentSessionsRoute.output.parse(
          await deps.assignment.moveAgentSessions(input.fromAgentId, input.toAgentId)
        )
      }
    ],
    [
      sessionsDeleteAgentSessionsRoute.name,
      async (rawInput) => {
        const input = sessionsDeleteAgentSessionsRoute.input.parse(rawInput)
        return sessionsDeleteAgentSessionsRoute.output.parse({
          deletedSessionIds: await deps.assignment.deleteAgentSessions(input.agentId)
        })
      }
    ],
    [
      sessionsMoveToAgentRoute.name,
      async (rawInput) => {
        const input = sessionsMoveToAgentRoute.input.parse(rawInput)
        return sessionsMoveToAgentRoute.output.parse({
          session: await deps.assignment.moveSessionToAgent(input.sessionId, input.toAgentId)
        })
      }
    ],
    [
      sessionsGetAcpSessionCommandsRoute.name,
      async (rawInput) => {
        const input = sessionsGetAcpSessionCommandsRoute.input.parse(rawInput)
        return sessionsGetAcpSessionCommandsRoute.output.parse({
          commands: await deps.assignment.getAcpSessionCommands(input.sessionId)
        })
      }
    ],
    [
      sessionsGetAcpSessionConfigOptionsRoute.name,
      async (rawInput) => {
        const input = sessionsGetAcpSessionConfigOptionsRoute.input.parse(rawInput)
        return sessionsGetAcpSessionConfigOptionsRoute.output.parse({
          state: await deps.assignment.getAcpSessionConfigOptions(input.sessionId)
        })
      }
    ],
    [
      sessionsSetAcpSessionConfigOptionRoute.name,
      async (rawInput) => {
        const input = sessionsSetAcpSessionConfigOptionRoute.input.parse(rawInput)
        return sessionsSetAcpSessionConfigOptionRoute.output.parse({
          state: await deps.assignment.setAcpSessionConfigOption(
            input.sessionId,
            input.configId,
            input.value
          )
        })
      }
    ],
    [
      sessionsGetPermissionModeRoute.name,
      async (rawInput) => {
        const input = sessionsGetPermissionModeRoute.input.parse(rawInput)
        return sessionsGetPermissionModeRoute.output.parse({
          mode: await deps.assignment.getPermissionMode(input.sessionId)
        })
      }
    ],
    [
      sessionsSetPermissionModeRoute.name,
      async (rawInput) => {
        const input = sessionsSetPermissionModeRoute.input.parse(rawInput)
        await deps.assignment.setPermissionMode(input.sessionId, input.mode)
        return sessionsSetPermissionModeRoute.output.parse({ updated: true })
      }
    ],
    [
      sessionsSetModelRoute.name,
      async (rawInput) => {
        const input = sessionsSetModelRoute.input.parse(rawInput)
        return sessionsSetModelRoute.output.parse({
          session: await deps.assignment.setSessionModel(
            input.sessionId,
            input.providerId,
            input.modelId
          )
        })
      }
    ],
    [
      sessionsSetProjectDirRoute.name,
      async (rawInput) => {
        const input = sessionsSetProjectDirRoute.input.parse(rawInput)
        return sessionsSetProjectDirRoute.output.parse({
          session: await deps.assignment.setSessionProjectDir(input.sessionId, input.projectDir)
        })
      }
    ],
    [
      sessionsGetGenerationSettingsRoute.name,
      async (rawInput) => {
        const input = sessionsGetGenerationSettingsRoute.input.parse(rawInput)
        return sessionsGetGenerationSettingsRoute.output.parse({
          settings: await deps.assignment.getSessionGenerationSettings(input.sessionId)
        })
      }
    ],
    [
      sessionsGetDisabledAgentToolsRoute.name,
      async (rawInput) => {
        const input = sessionsGetDisabledAgentToolsRoute.input.parse(rawInput)
        return sessionsGetDisabledAgentToolsRoute.output.parse({
          disabledAgentTools: await deps.assignment.getSessionDisabledAgentTools(input.sessionId)
        })
      }
    ],
    [
      sessionsUpdateDisabledAgentToolsRoute.name,
      async (rawInput) => {
        const input = sessionsUpdateDisabledAgentToolsRoute.input.parse(rawInput)
        return sessionsUpdateDisabledAgentToolsRoute.output.parse({
          disabledAgentTools: await deps.assignment.updateSessionDisabledAgentTools(
            input.sessionId,
            input.disabledAgentTools
          )
        })
      }
    ],
    [
      sessionsUpdateGenerationSettingsRoute.name,
      async (rawInput) => {
        const input = sessionsUpdateGenerationSettingsRoute.input.parse(rawInput)
        return sessionsUpdateGenerationSettingsRoute.output.parse({
          settings: await deps.assignment.updateSessionGenerationSettings(
            input.sessionId,
            input.settings
          )
        })
      }
    ],
    [
      chatSendMessageRoute.name,
      async (rawInput, context) => {
        const input = chatSendMessageRoute.input.parse(rawInput)
        return chatSendMessageRoute.output.parse(
          await withSubmissionCancellation(
            context.webContentsId,
            input.submissionId,
            async (signal) =>
              signal
                ? await chatService.sendMessage(input.sessionId, input.content, { signal })
                : await chatService.sendMessage(input.sessionId, input.content)
          )
        )
      }
    ],
    [
      chatSteerActiveTurnRoute.name,
      async (rawInput, context) => {
        const input = chatSteerActiveTurnRoute.input.parse(rawInput)
        return chatSteerActiveTurnRoute.output.parse(
          await withSubmissionCancellation(
            context.webContentsId,
            input.submissionId,
            async (signal) =>
              signal
                ? await chatService.steerActiveTurn(input.sessionId, input.content, { signal })
                : await chatService.steerActiveTurn(input.sessionId, input.content)
          )
        )
      }
    ],
    [
      chatCancelSubmissionRoute.name,
      async (rawInput, context) => {
        const input = chatCancelSubmissionRoute.input.parse(rawInput)
        return chatCancelSubmissionRoute.output.parse({
          cancelled: submissionCancellations.cancel(context.webContentsId, input.submissionId)
        })
      }
    ],
    [
      chatStopStreamRoute.name,
      async (rawInput) => {
        const input = chatStopStreamRoute.input.parse(rawInput)
        return chatStopStreamRoute.output.parse(await chatService.stopStream(input))
      }
    ],
    [
      chatRespondToolInteractionRoute.name,
      async (rawInput) => {
        const input = chatRespondToolInteractionRoute.input.parse(rawInput)
        return chatRespondToolInteractionRoute.output.parse(
          await chatService.respondToolInteraction(input)
        )
      }
    ]
  ])
}
