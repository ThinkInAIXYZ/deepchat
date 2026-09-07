import fs from 'fs'
import os from 'os'
import path from 'path'

export function resolveWorkspacePath(workspaceRoot: string, inputPath: string): string | null {
  const trimmed = inputPath.trim()
  if (!trimmed) return null

  const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir())
  const absolute = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(workspaceRoot, expanded)
  const normalized = path.normalize(absolute)

  let realPath: string
  let workspaceReal: string

  try {
    realPath = fs.realpathSync(normalized)
    workspaceReal = fs.realpathSync(workspaceRoot)
  } catch {
    return null
  }

  const workspaceWithSep = workspaceReal.endsWith(path.sep)
    ? workspaceReal
    : `${workspaceReal}${path.sep}`

  if (realPath === workspaceReal || realPath.startsWith(workspaceWithSep)) {
    return realPath
  }

  return null
}
