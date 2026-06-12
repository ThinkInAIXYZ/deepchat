import fs from 'fs'
import path from 'path'

const cwdErrorHint =
  'Update the session workspace to an existing folder before running shell tools. Node may report this as "spawn <shell> ENOENT" even when the shell exists.'

export function resolveUsableSpawnCwd(cwd: string): string {
  const normalizedCwd = path.resolve(cwd.trim() || process.cwd())

  if (!fs.existsSync(normalizedCwd)) {
    throw new Error(
      `Working directory does not exist or is not accessible: ${normalizedCwd}. ${cwdErrorHint}`
    )
  }

  const statSync = fs.statSync as ((targetPath: fs.PathLike) => fs.Stats) | undefined
  if (typeof statSync !== 'function') {
    return normalizedCwd
  }

  try {
    if (!statSync(normalizedCwd).isDirectory()) {
      throw new Error(`Working directory is not a directory: ${normalizedCwd}. ${cwdErrorHint}`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes(cwdErrorHint)) {
      throw error
    }
    throw new Error(
      `Working directory is not accessible: ${normalizedCwd}. ${cwdErrorHint}`,
      error instanceof Error ? { cause: error } : undefined
    )
  }

  return normalizedCwd
}

export function describeSpawnFailure(
  error: Error,
  context: {
    shell: string
    cwd: string
  }
): string {
  const code =
    typeof (error as NodeJS.ErrnoException).code === 'string'
      ? ` ${(error as NodeJS.ErrnoException).code}`
      : ''
  const message = `Failed to spawn shell${code}: ${context.shell} (cwd: ${context.cwd}). ${error.message}`

  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return `${message}. If the shell path exists, the working directory may be missing or inaccessible.`
  }

  return message
}
