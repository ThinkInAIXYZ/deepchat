import runtimeVersions from '../../../resources/runtime-versions.json'
import type { ToolchainKind } from '@shared/types/toolchains'

export const NODE_PIN = runtimeVersions.node
export const UV_PIN = runtimeVersions.uv
export const NODE_MODULE_VERSION = 137
export const NODE_COMPAT_MIN_INCLUSIVE = '24.18.0'
export const NODE_COMPAT_MAX_EXCLUSIVE = '25.0.0'

export type ToolchainTargetArch = 'arm64' | 'x64'

export type ToolchainArtifact = {
  kind: ToolchainKind
  version: string
  platform: NodeJS.Platform
  arch: ToolchainTargetArch
  filename: string
  officialUrl: string
  sha256: string
}

const NODE_OFFICIAL_DIST = 'https://nodejs.org/dist/'
const NODE_DEFAULT_MIRROR_DIST = 'https://npmmirror.com/mirrors/node/'

export function defaultNodeMirrorUrl(officialUrl: string): string | undefined {
  if (!officialUrl.startsWith(NODE_OFFICIAL_DIST)) return undefined
  return `${NODE_DEFAULT_MIRROR_DIST}${officialUrl.slice(NODE_OFFICIAL_DIST.length)}`
}

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

export function catalogVersionFor(kind: ToolchainKind): string {
  return kind === 'node' ? NODE_PIN : kind === 'uv' ? UV_PIN : runtimeVersions.cloudflared
}

export function resolveToolchainArtifact(
  kind: ToolchainKind,
  platform: NodeJS.Platform,
  arch: string
): ToolchainArtifact {
  if (arch !== 'arm64' && arch !== 'x64') {
    throw unsupportedPlatform(kind, platform, arch)
  }
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    throw unsupportedPlatform(kind, platform, arch)
  }

  const target = `${platform}-${arch}`
  const artifacts: Record<string, { filename: string; archiveSha256: string }> =
    kind === 'node'
      ? runtimeVersions.nodeArtifacts
      : kind === 'uv'
        ? runtimeVersions.uvArtifacts
        : runtimeVersions.cloudflaredArtifacts
  const archive = artifacts[target]
  const version = catalogVersionFor(kind)
  if (
    runtimeVersions.artifactVersions[kind] !== version ||
    !archive?.filename ||
    !/^[a-f0-9]{64}$/.test(archive.archiveSha256)
  ) {
    throw unsupportedPlatform(kind, platform, arch)
  }

  const officialUrl =
    kind === 'cloudflared'
      ? `https://github.com/cloudflare/cloudflared/releases/download/${version}/${archive.filename}`
      : kind === 'node'
        ? `${NODE_OFFICIAL_DIST}${NODE_PIN}/${archive.filename}`
        : `https://github.com/astral-sh/uv/releases/download/${UV_PIN}/${archive.filename}`

  return {
    kind,
    version,
    platform,
    arch,
    filename: archive.filename,
    officialUrl,
    sha256: archive.archiveSha256
  }
}

function unsupportedPlatform(kind: ToolchainKind, platform: NodeJS.Platform, arch: string): Error {
  return Object.assign(new Error(`${kind} has no official artifact for ${platform}-${arch}`), {
    unsupportedPlatform: true
  })
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
