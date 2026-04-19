import { eventBus } from '@/eventbus'
import { NOTIFICATION_EVENTS } from '@/events'
import { buildDatabaseRepairSuggestedPayload } from './sqlitePresenter/schemaErrorClassifier'

interface PresenterCallErrorContext {
  webContentsId: number
  presenterName: string
  methodName: string
}

const runtimeSchemaRepairSuggestionKeys = new Set<string>()

const isPromiseLike = <T>(value: unknown): value is Promise<T> =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Promise<T>).then === 'function' &&
  typeof (value as Promise<T>).catch === 'function'

const formatPresenterCallError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '')
  }

  return String(error)
}

const reportPresenterCallError = (
  error: unknown,
  { webContentsId, presenterName, methodName }: PresenterCallErrorContext
): { error: string } => {
  const repairSuggestion = buildDatabaseRepairSuggestedPayload(error)
  const suggestionKey = repairSuggestion ? `${webContentsId}:${repairSuggestion.dedupeKey}` : null

  console.error(`[IPC Error] WebContents:${webContentsId} ${presenterName}.${methodName}:`, error)

  if (repairSuggestion && suggestionKey && !runtimeSchemaRepairSuggestionKeys.has(suggestionKey)) {
    runtimeSchemaRepairSuggestionKeys.add(suggestionKey)
    eventBus.sendToWebContents(
      webContentsId,
      NOTIFICATION_EVENTS.DATABASE_REPAIR_SUGGESTED,
      repairSuggestion
    )
  }

  return { error: formatPresenterCallError(error) }
}

export const handlePresenterCallError = (
  error: unknown,
  context: PresenterCallErrorContext
): { error: string } => reportPresenterCallError(error, context)

export const handlePresenterCallResult = <T>(
  result: T | Promise<T>,
  context: PresenterCallErrorContext
): T | Promise<T> => {
  if (!isPromiseLike<T>(result)) {
    return result
  }

  return result.catch((error) => {
    reportPresenterCallError(error, context)
    throw error
  })
}

export const resetPresenterCallErrorStateForTests = (): void => {
  runtimeSchemaRepairSuggestionKeys.clear()
}
