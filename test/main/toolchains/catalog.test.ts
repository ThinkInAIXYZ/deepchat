import { describe, expect, it } from 'vitest'

import { NODE_PIN, resolveToolchainArtifact, UV_PIN } from '../../../src/main/toolchains/catalog'

const NODE_TARGETS = [
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['linux', 'arm64'],
  ['linux', 'x64'],
  ['win32', 'arm64'],
  ['win32', 'x64']
] as const

describe('toolchain catalog', () => {
  it('embeds NODE_PIN in every official Node filename and URL', () => {
    for (const [platform, arch] of NODE_TARGETS) {
      const artifact = resolveToolchainArtifact('node', platform, arch)
      expect(artifact.version).toBe(NODE_PIN)
      expect(artifact.filename).toContain(NODE_PIN)
      expect(artifact.officialUrl).toContain(`${NODE_PIN}/${artifact.filename}`)
    }
  })

  it('keeps uv artifacts on the catalog pin', () => {
    for (const [platform, arch] of NODE_TARGETS) {
      const artifact = resolveToolchainArtifact('uv', platform, arch)
      expect(artifact.version).toBe(UV_PIN)
      expect(artifact.officialUrl).toContain(`/${UV_PIN}/`)
    }
  })
})
