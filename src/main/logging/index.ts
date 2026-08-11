import { randomUUID } from 'node:crypto'
import { is } from '@electron-toolkit/utils'
import { app } from 'electron'
import { originalConsole } from '@shared/logger'
import { MainJsonlPersistence } from './mainJsonlPersistence'
import { MainLogger, type MainLogInternalWarning } from './mainLogger'
import type {
  MainLogEventInputMap,
  MainLogStartupComponent,
  MainLogStartupComponentFailureCategory
} from './mainLogEvents'

const INTERNAL_WARNING_TEXT: Record<MainLogInternalWarning, string> = {
  event_rejected: '[main] structured log event rejected\n',
  record_oversized: '[main] structured log record exceeded size limit\n',
  record_rejected: '[main] structured log record rejected by persistence contract\n',
  persistence_failed: '[main] structured log persistence disabled after failure\n'
}

const persistence = new MainJsonlPersistence({
  getUserDataPath: () => app.getPath('userData')
})

export const mainLogger = new MainLogger({
  persistence,
  appVersion: app.getVersion(),
  processInstanceId: randomUUID(),
  writeConsole: is.dev
    ? (_level, text) => {
        process.stdout.write(`${text}\n`)
      }
    : undefined,
  warn: (warning) => {
    process.stderr.write(INTERNAL_WARNING_TEXT[warning])
  }
})

export function setMainLoggingEnabled(enabled: boolean): void {
  mainLogger.setPersistenceEnabled(enabled)
}

export function reportNativeMainError(message: string, error: unknown): void {
  try {
    originalConsole.error(message, error)
  } catch {
    // Native diagnostics must not affect Main lifecycle or recovery behavior.
  }
}

export function reportMainStartupComponentFailure(
  startupRunId: string,
  component: MainLogStartupComponent,
  category: MainLogStartupComponentFailureCategory
): void {
  mainLogger.emit('app.startup.component.failed', {
    startupRunId,
    component,
    error: { category }
  })
}

export function reportMainProcessFatal(
  event: 'process.uncaught_exception' | 'process.unhandled_rejection',
  error: unknown
): void {
  reportNativeMainError(`[main] ${event}`, error)
  mainLogger.emit(event, { error } satisfies MainLogEventInputMap[typeof event])
}
