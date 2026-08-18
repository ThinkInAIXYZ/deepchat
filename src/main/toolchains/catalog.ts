import runtimeVersions from '../../../resources/runtime-versions.json'

export const NODE_PIN = runtimeVersions.node
export const NODE_MODULE_VERSION = 137
export const NODE_COMPAT_MIN_INCLUSIVE = '24.18.0'
export const NODE_COMPAT_MAX_EXCLUSIVE = '25.0.0'

export function normalizeNodeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

export function compareNodeVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left)
  const rightParts = parseVersionParts(right)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index]
    }
  }
  return 0
}

export function isNodeVersionInCompatRange(version: string): boolean {
  return (
    compareNodeVersions(version, NODE_COMPAT_MIN_INCLUSIVE) >= 0 &&
    compareNodeVersions(version, NODE_COMPAT_MAX_EXCLUSIVE) < 0
  )
}

function parseVersionParts(version: string): [number, number, number] {
  const normalized = normalizeNodeVersion(version)
  const [major, minor, patch] = normalized.split('.')
  return [toVersionNumber(major), toVersionNumber(minor), toVersionNumber(patch)]
}

function toVersionNumber(value: string | undefined): number {
  if (!value) return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}
