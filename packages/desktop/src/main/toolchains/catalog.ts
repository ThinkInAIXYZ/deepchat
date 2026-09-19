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

const NODE_ARCHIVES: Record<string, Record<string, { filename: string; sha256: string }>> = {
  'v24.18.0': {
    'darwin-arm64': {
      filename: 'node-v24.18.0-darwin-arm64.tar.gz',
      sha256: 'e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1'
    },
    'darwin-x64': {
      filename: 'node-v24.18.0-darwin-x64.tar.gz',
      sha256: 'dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080'
    },
    'linux-arm64': {
      filename: 'node-v24.18.0-linux-arm64.tar.gz',
      sha256: '6b4484c2190274175df9aa8f28e2d758a819cb1c1fe6ab481e2f95b463ab8508'
    },
    'linux-x64': {
      filename: 'node-v24.18.0-linux-x64.tar.gz',
      sha256: '783130984963db7ba9cbd01089eaf2c2efb055c7c1693c943174b967b3050cb8'
    },
    'win32-arm64': {
      filename: 'node-v24.18.0-win-arm64.zip',
      sha256: 'f274669adb93b1fd0fbf8f21fd078609e9dcc84333d4f2718d2dde3f9a161a01'
    },
    'win32-x64': {
      filename: 'node-v24.18.0-win-x64.zip',
      sha256: '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'
    }
  }
}

const UV_ARCHIVES: Record<string, Record<string, { filename: string; sha256: string }>> = {
  '0.9.18': {
    'darwin-arm64': {
      filename: 'uv-aarch64-apple-darwin.tar.gz',
      sha256: 'dc3bee4abbb3bac267a3985a23ea7617d19d41ff381dbaf560ba415ad65af68f'
    },
    'darwin-x64': {
      filename: 'uv-x86_64-apple-darwin.tar.gz',
      sha256: 'f86836c637333c65bbc7902acc9c49888eef9fbd15dccbc1946b10e30b041073'
    },
    'linux-arm64': {
      filename: 'uv-aarch64-unknown-linux-gnu.tar.gz',
      sha256: 'f8e23ec786b18660ade6b033b6191b7e9c283c872eeb8c4531d56a873decf160'
    },
    'linux-x64': {
      filename: 'uv-x86_64-unknown-linux-gnu.tar.gz',
      sha256: 'c2def3db178ade63933fa15ffc96e882c196ce53e06173dcee05b36c5f6f68f5'
    },
    'win32-arm64': {
      filename: 'uv-aarch64-pc-windows-msvc.zip',
      sha256: 'fadb43ba13091f44e1786fc3967e65c7786d86192aa205d718307c649927cfc2'
    },
    'win32-x64': {
      filename: 'uv-x86_64-pc-windows-msvc.zip',
      sha256: '28cbe5d30907a774bfe27a517a39b494ec6f7d3816bda8bbf6f9645490449182'
    }
  }
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
  return kind === 'node' ? NODE_PIN : UV_PIN
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
  const pin = catalogVersionFor(kind)
  const archive = (kind === 'node' ? NODE_ARCHIVES[pin] : UV_ARCHIVES[pin])?.[target]
  if (!archive) throw unsupportedPlatform(kind, platform, arch)

  const version = catalogVersionFor(kind)
  const officialUrl =
    kind === 'node'
      ? `${NODE_OFFICIAL_DIST}${NODE_PIN}/${archive.filename}`
      : `https://github.com/astral-sh/uv/releases/download/${UV_PIN}/${archive.filename}`

  return {
    kind,
    version,
    platform,
    arch,
    filename: archive.filename,
    officialUrl,
    sha256: archive.sha256
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
