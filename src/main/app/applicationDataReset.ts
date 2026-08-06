import type { CliLauncherReason, CliLauncherStatus } from '@/cli/launcherService'

export type ApplicationDataResetType = 'chat' | 'knowledge' | 'config' | 'all'

type CliLauncherResetPort = Readonly<{
  getStatus(): Promise<CliLauncherStatus>
  removeOwnedLauncher(): Promise<CliLauncherStatus>
}>

type ApplicationDataResetLogger = Readonly<{
  warn(message: string, context: Readonly<Record<string, unknown>>): void
}>

export type ApplicationDataResetDependencies = Readonly<{
  cliLauncher: CliLauncherResetPort
  logger: ApplicationDataResetLogger
  stop(): Promise<void>
  resetDataByType(resetType: ApplicationDataResetType): Promise<void>
}>

type LauncherCleanupReason =
  | CliLauncherReason
  | 'launcher-conflict'
  | 'status-inspection-failed'
  | 'launcher-removal-failed'

function safeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^[a-z0-9_-]{1,64}$/i.test(code) ? code : undefined
}

function warnLauncherCleanupIncomplete(
  logger: ApplicationDataResetLogger,
  reason: LauncherCleanupReason,
  error?: unknown
): void {
  const errorCode = safeErrorCode(error)
  try {
    logger.warn('[CLI] Launcher cleanup did not complete during full data reset', {
      reason,
      ...(errorCode ? { errorCode } : {})
    })
  } catch {
    // Diagnostics are best-effort and must never block the data reset they describe.
  }
}

async function removeOwnedLauncherForReset(
  cliLauncher: CliLauncherResetPort,
  logger: ApplicationDataResetLogger
): Promise<void> {
  let status: CliLauncherStatus
  try {
    status = await cliLauncher.getStatus()
  } catch (error) {
    warnLauncherCleanupIncomplete(logger, 'status-inspection-failed', error)
    return
  }

  if (status.state === 'conflict') {
    warnLauncherCleanupIncomplete(logger, status.reason ?? 'launcher-conflict')
    return
  }

  try {
    await cliLauncher.removeOwnedLauncher()
  } catch (error) {
    warnLauncherCleanupIncomplete(logger, 'launcher-removal-failed', error)
  }
}

export async function coordinateApplicationDataReset(
  resetType: ApplicationDataResetType,
  dependencies: ApplicationDataResetDependencies
): Promise<void> {
  await dependencies.stop()
  if (resetType === 'all') {
    await removeOwnedLauncherForReset(dependencies.cliLauncher, dependencies.logger)
  }
  await dependencies.resetDataByType(resetType)
}
