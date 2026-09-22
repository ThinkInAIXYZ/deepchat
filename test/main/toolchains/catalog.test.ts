import { afterEach, describe, expect, it, vi } from 'vitest'
import runtimeVersions from '../../../resources/runtime-versions.json'

import {
  defaultNodeMirrorUrl,
  NODE_PIN,
  resolveToolchainArtifact,
  UV_PIN
} from '../../../src/main/toolchains/catalog'

const NODE_TARGETS = [
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['linux', 'arm64'],
  ['linux', 'x64'],
  ['win32', 'arm64'],
  ['win32', 'x64']
] as const

describe('toolchain catalog', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(['node', 'uv'] as const)('rejects %s metadata belonging to another release', (kind) => {
    vi.spyOn(runtimeVersions.artifactVersions, kind, 'get').mockReturnValue('0.0.0')
    expect(() => resolveToolchainArtifact(kind, 'win32', 'arm64')).toThrow(
      /has no official artifact/
    )
  })

  it('uses the Windows ARM64 archive hash, not the installed executable hash', () => {
    expect(resolveToolchainArtifact('node', 'win32', 'arm64')).toEqual({
      kind: 'node',
      version: 'v24.18.0',
      platform: 'win32',
      arch: 'arm64',
      filename: 'node-v24.18.0-win-arm64.zip',
      officialUrl: 'https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-arm64.zip',
      sha256: 'f274669adb93b1fd0fbf8f21fd078609e9dcc84333d4f2718d2dde3f9a161a01'
    })
  })

  it.each(['node', 'uv'] as const)('rejects unsupported %s targets', (kind) => {
    for (const [platform, arch] of [
      ['freebsd', 'x64'],
      ['linux', 'ia32']
    ] as const) {
      expect(() => resolveToolchainArtifact(kind, platform, arch)).toThrow(
        /has no official artifact/
      )
    }
  })

  it.each(['', 'not-a-checksum'])('rejects incomplete archive metadata (%s)', (checksum) => {
    vi.spyOn(runtimeVersions.nodeArtifacts, 'win32-arm64', 'get').mockReturnValue({
      ...runtimeVersions.nodeArtifacts['win32-arm64'],
      archiveSha256: checksum
    })
    expect(() => resolveToolchainArtifact('node', 'win32', 'arm64')).toThrow(
      /has no official artifact/
    )
  })

  it('embeds NODE_PIN in every official Node filename and URL', () => {
    for (const [platform, arch] of NODE_TARGETS) {
      const artifact = resolveToolchainArtifact('node', platform, arch)
      expect(artifact.version).toBe(NODE_PIN)
      expect(artifact.filename).toContain(NODE_PIN)
      expect(artifact.officialUrl).toContain(`${NODE_PIN}/${artifact.filename}`)
    }
  })

  it('maps official Node dist URLs onto the default mirror', () => {
    const artifact = resolveToolchainArtifact('node', 'darwin', 'arm64')
    expect(defaultNodeMirrorUrl(artifact.officialUrl)).toBe(
      `https://npmmirror.com/mirrors/node/${NODE_PIN}/${artifact.filename}`
    )
    expect(defaultNodeMirrorUrl('https://github.com/astral-sh/uv/releases/download/x/y')).toBe(
      undefined
    )
  })

  it('keeps uv artifacts on the catalog pin', () => {
    for (const [platform, arch] of NODE_TARGETS) {
      const artifact = resolveToolchainArtifact('uv', platform, arch)
      expect(artifact.version).toBe(UV_PIN)
      expect(artifact.officialUrl).toContain(`/${UV_PIN}/`)
    }
  })

  it('resolves a unique sha256 for every current pin target', () => {
    const hashes = new Set<string>()
    for (const kind of ['node', 'uv'] as const) {
      for (const [platform, arch] of NODE_TARGETS) {
        const artifact = resolveToolchainArtifact(kind, platform, arch)
        expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(hashes.has(artifact.sha256)).toBe(false)
        hashes.add(artifact.sha256)
      }
    }
  })
})
