import path from 'node:path'
import type { CommandShellPathStyle } from '@shared/commandShell'

export class UnsupportedCommandShellPathError extends Error {
  constructor(readonly requestedPath: string) {
    super(`Unsupported MSYS path: ${requestedPath}`)
    this.name = 'UnsupportedCommandShellPathError'
  }
}

export function normalizeCommandShellFilePath(
  requestedPath: string,
  pathStyle: CommandShellPathStyle
): string {
  if (pathStyle !== 'msys' || !requestedPath.startsWith('/')) return requestedPath

  const match = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(requestedPath)
  if (!match || match[2]?.includes('\\')) {
    throw new UnsupportedCommandShellPathError(requestedPath)
  }

  const drive = match[1].toUpperCase()
  const remainder = match[2] ?? ''
  return path.win32.normalize(`${drive}:\\${remainder.replaceAll('/', '\\')}`)
}
