const HARDLINK_UNAVAILABLE_CODES = new Set([
  'EACCES',
  'EINVAL',
  'EMLINK',
  'ENOSYS',
  'ENOTSUP',
  'EOPNOTSUPP',
  'EPERM',
  'EXDEV'
])

export function normalizeWorkspacePath(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return ''

  if (/^[\\/]+$/.test(trimmed)) {
    return trimmed[0]
  }

  const driveRoot = /^([A-Za-z]:)([\\/]+)$/.exec(trimmed)
  if (driveRoot) {
    return `${driveRoot[1]}${driveRoot[2][0]}`
  }

  return trimmed.replace(/[\\/]+$/, '')
}

export function isHardlinkUnavailableError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as NodeJS.ErrnoException).code
  return typeof code === 'string' && HARDLINK_UNAVAILABLE_CODES.has(code)
}
