import path from 'node:path'

export interface NormalizedAbsoluteWorkspacePath {
  readonly flavor: 'posix' | 'win32'
  readonly path: string
}

export function normalizeAbsoluteWorkspacePath(
  value: string
): NormalizedAbsoluteWorkspacePath | null {
  if (path.posix.isAbsolute(value)) {
    return { flavor: 'posix', path: path.posix.normalize(value) }
  }
  if (path.win32.isAbsolute(value)) {
    return { flavor: 'win32', path: path.win32.normalize(value) }
  }
  return null
}

export function workspacePathsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeAbsoluteWorkspacePath(left)
  const normalizedRight = normalizeAbsoluteWorkspacePath(right)
  if (
    normalizedLeft === null ||
    normalizedRight === null ||
    normalizedLeft.flavor !== normalizedRight.flavor
  ) {
    return false
  }

  const pathApi = normalizedLeft.flavor === 'posix' ? path.posix : path.win32
  return pathApi.relative(normalizedLeft.path, normalizedRight.path) === ''
}

export function isWorkspacePathWithin(candidate: string, ceiling: string): boolean {
  const normalizedCandidate = normalizeAbsoluteWorkspacePath(candidate)
  const normalizedCeiling = normalizeAbsoluteWorkspacePath(ceiling)
  if (
    normalizedCandidate === null ||
    normalizedCeiling === null ||
    normalizedCandidate.flavor !== normalizedCeiling.flavor
  ) {
    return false
  }

  const pathApi = normalizedCandidate.flavor === 'posix' ? path.posix : path.win32
  const relative = pathApi.relative(normalizedCeiling.path, normalizedCandidate.path)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative))
  )
}
