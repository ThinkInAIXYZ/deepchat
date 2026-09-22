import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import runtimeVersions from '../../../resources/runtime-versions.json'
import { buildRuntimeInstallPlan } from '../../../scripts/install-runtime.mjs'
import { TARGET_DEFINITIONS, TARGET_IDS } from '../../../scripts/ci/package-contract.mjs'
import { resolveToolchainArtifact } from '../../../src/main/toolchains/catalog'

vi.unmock('node:fs')
vi.unmock('node:fs/promises')
vi.unmock('node:path')

describe('runtime delivery contract', () => {
  it('covers the package targets with Node, uv and OCR artifacts', () => {
    const targets = [...TARGET_IDS].sort()
    expect(Object.keys(runtimeVersions.nodeArtifacts).sort()).toEqual(targets)
    expect(Object.keys(runtimeVersions.uvArtifacts).sort()).toEqual(targets)
    expect(Object.keys(runtimeVersions.lightOcr.nativePackages).sort()).toEqual(targets)

    for (const { platform, arch } of TARGET_DEFINITIONS) {
      for (const kind of ['node', 'uv'] as const) {
        const artifact = resolveToolchainArtifact(kind, platform, arch)
        expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
        expect(artifact.filename).toMatch(/^[a-zA-Z0-9._-]+\.(zip|tar\.gz)$/)
        expect(artifact.filename.endsWith('.zip')).toBe(platform === 'win32')
      }
      const nodePlan = buildRuntimeInstallPlan({ platform, arch, types: ['node'] })
      const nodeArtifact = runtimeVersions.nodeArtifacts[
        `${platform}-${arch}` as keyof typeof runtimeVersions.nodeArtifacts
      ]
      expect(nodePlan).toHaveLength(1)
      expect(nodePlan[0].expectedExecutableSha256).toBe(nodeArtifact.executableSha256)
      expect(nodePlan[0].expectedExecutableSha256).not.toBe(nodeArtifact.archiveSha256)
      expect(buildRuntimeInstallPlan({ platform, arch }).map(({ type }) => type)).toEqual(
        platform === 'win32' && arch === 'arm64' ? ['uv'] : ['uv', 'rtk']
      )
    }
  })

  it.each(['build', 'package-check', 'package-regression', 'release'])(
    '%s workflow covers exactly the runtime/package targets',
    async (name) => {
      const workflow = parse(await readFile(`.github/workflows/${name}.yml`, 'utf8'))
      const platforms = {
        './.github/workflows/_package-windows.yml': 'win32',
        './.github/workflows/_package-linux.yml': 'linux',
        './.github/workflows/_package-macos.yml': 'darwin'
      }
      const jobs = Object.values(workflow.jobs) as {
        uses?: string
        strategy?: { matrix?: { arch?: string[] } }
        with?: { arch?: string }
      }[]
      const targets = jobs
        .filter(({ uses }) => uses?.startsWith('./.github/workflows/_package-'))
        .flatMap((job) => {
          const platform = platforms[job.uses as keyof typeof platforms]
          expect(platform).toBeDefined()
          const matrix = job.strategy?.matrix
          // Fail closed if include/exclude or expressions change the matrix semantics.
          expect(Object.keys(matrix ?? {})).toEqual(['arch'])
          expect(Array.isArray(matrix?.arch)).toBe(true)
          expect(job.with?.arch).toBe('${{ matrix.arch }}')
          return matrix!.arch!.map((arch) => `${platform}-${arch}`)
        })
      expect(targets.sort()).toEqual([...TARGET_IDS].sort())
    }
  )
})
