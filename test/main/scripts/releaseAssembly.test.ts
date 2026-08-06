import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse, stringify } from 'yaml'

import { assembleRelease } from '../../../scripts/ci/assemble-release.mjs'
import {
  getMeasuredRoles,
  getUpdaterPayloadRole,
  PACKAGE_MANIFEST_SCHEMA_VERSION,
  RELEASE_INDEX_SCHEMA_VERSION,
  TARGET_DEFINITIONS
} from '../../../scripts/ci/package-contract.mjs'
import { inspectRegularFile } from '../../../scripts/ci/package-files.mjs'
import {
  verifyGitHubDraftRelease,
  verifyReleaseAssets
} from '../../../scripts/ci/verify-release-assets.mjs'
import {
  loadElectronUpdaterMetadataParser,
  parseElectronUpdaterMetadata
} from '../../../scripts/ci/updater-metadata-consumer.mjs'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('fs/promises')
vi.unmock('node:fs/promises')
vi.unmock('path')
vi.unmock('node:path')

const sourceSha = 'b'.repeat(40)
const version = '1.2.3-beta.1'
const workflowRunId = '42'
const workflowRunAttempt = '3'
const generatedAt = '2026-07-23T00:00:00.000Z'

interface PackageManifest {
  schemaVersion: number
  target: { id: string; platform: string; arch: string }
  source: { commit: string; version: string }
  build: Record<string, string>
  checks: Record<string, string>
  files: Array<{
    role: string
    name: string
    storagePath: string
    bytes: number
    sha256: string
  }>
  reports: Array<{ name: string; bytes: number; sha256: string }>
}

interface FinalUpdaterMetadata {
  releaseDate: unknown
  files: Array<{ url: string; blockMapSize?: number }>
  path: string
}

describe('fail-closed release assembly', () => {
  let tempDirectory: string
  let artifactsDirectory: string
  let outputDirectory: string

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-release-assembly-'))
    artifactsDirectory = path.join(tempDirectory, 'artifacts')
    outputDirectory = path.join(tempDirectory, 'release')
    await mkdir(artifactsDirectory, { recursive: true })
    await createPackageArtifacts(artifactsDirectory)
  })

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true })
  })

  const assemble = () =>
    assembleRelease({
      artifactsDirectory,
      outputDirectory,
      sourceSha,
      version,
      workflowRunId,
      workflowRunAttempt,
      generatedAt
    })

  const artifactRoot = (targetId: string) => {
    const definition = TARGET_DEFINITIONS.find(({ id }) => id === targetId)
    if (!definition) throw new Error(`Unknown fixture target: ${targetId}`)
    return path.join(artifactsDirectory, definition.artifactName)
  }

  async function resetFixtures() {
    await Promise.all([
      rm(outputDirectory, { recursive: true, force: true }),
      rm(artifactsDirectory, { recursive: true, force: true })
    ])
    await mkdir(artifactsDirectory)
    await createPackageArtifacts(artifactsDirectory)
  }

  async function updateManifest(
    targetId: string,
    mutate: (manifest: PackageManifest) => void
  ) {
    const manifestPath = path.join(artifactRoot(targetId), 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest
    mutate(manifest)
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  async function updateRawMetadata(
    targetId: string,
    mutate: (metadata: Record<string, unknown>) => void
  ) {
    const definition = TARGET_DEFINITIONS.find(({ id }) => id === targetId)
    if (!definition) throw new Error(`Unknown fixture target: ${targetId}`)
    const root = artifactRoot(targetId)
    const metadataPath = path.join(root, 'metadata', definition.metadataName)
    const metadata = parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>
    mutate(metadata)
    await writeFile(metadataPath, stringify(metadata))
    const inspected = await inspectRegularFile(metadataPath, root)
    await updateManifest(targetId, (manifest) => {
      const record = manifest.files.find(({ role }) => role === 'update-metadata')
      if (!record) throw new Error('Missing fixture metadata record')
      record.bytes = inspected.bytes
      record.sha256 = inspected.sha256
    })
  }

  async function readFinalMetadata(name: string): Promise<FinalUpdaterMetadata> {
    const metadataPath = path.join(outputDirectory, name)
    return parseElectronUpdaterMetadata(
      await readFile(metadataPath, 'utf8'),
      name,
      pathToFileURL(metadataPath)
    ) as FinalUpdaterMetadata
  }

  it('assembles six manifests into exactly 19 public release assets', async () => {
    const releaseIndex = await assemble()
    const entries = (await readdir(outputDirectory)).sort()
    expect(entries).toHaveLength(19)
    expect(entries).toContain('release-index.json')
    expect(releaseIndex.assets).toHaveLength(18)
    expect(releaseIndex).toMatchObject({
      version,
      sourceCommit: sourceSha,
      workflowRunId,
      workflowRunAttempt
    })
    expect(releaseIndex.assets.every((asset) => !('sha512' in asset))).toBe(true)

    const [windows, macOS, linuxX64, linuxArm64] = await Promise.all([
      readFinalMetadata('latest.yml'),
      readFinalMetadata('latest-mac.yml'),
      readFinalMetadata('latest-linux.yml'),
      readFinalMetadata('latest-linux-arm64.yml')
    ])
    for (const metadata of [windows, macOS, linuxX64, linuxArm64]) {
      expect(typeof metadata.releaseDate).toBe('string')
      expect(metadata.releaseDate).toBe(generatedAt)
    }

    expect(windows.files.map(({ url }) => url)).toEqual([
      `DeepChat-${version}-windows-x64.exe`,
      `DeepChat-${version}-windows-arm64.exe`
    ])
    expect(windows.path).toBe(windows.files[0].url)

    expect(macOS.files.map(({ url }) => url)).toEqual([
      `DeepChat-${version}-mac-x64.zip`,
      `DeepChat-${version}-mac-arm64.zip`
    ])
    expect(macOS.files.every(({ url }) => !url.endsWith('.dmg'))).toBe(true)
    expect(macOS.path).toBe(macOS.files[0].url)

    expect(linuxX64.files).toHaveLength(1)
    expect(linuxX64.files[0].url).toMatch(/-linux-x64\.AppImage$/)
    expect(linuxX64.files[0]).toHaveProperty('blockMapSize')
    expect(linuxArm64.files).toHaveLength(1)
    expect(linuxArm64.files[0].url).toMatch(/-linux-arm64\.AppImage$/)
    expect(linuxArm64.files[0]).toHaveProperty('blockMapSize')

    const windowsTarget = releaseIndex.targets.find(({ id }) => id === 'win32-x64')
    const macTarget = releaseIndex.targets.find(({ id }) => id === 'darwin-x64')
    expect(releaseIndex.schemaVersion).toBe(RELEASE_INDEX_SCHEMA_VERSION)
    expect(windowsTarget?.checks).not.toHaveProperty('signed')
    expect(windowsTarget?.checks).not.toHaveProperty('macAppDistribution')
    expect(macTarget?.checks).toMatchObject({
      cuaMacHelperDistribution: 'passed',
      macAppDistribution: 'passed',
      macZipDistribution: 'passed',
      macDmgDistribution: 'passed'
    })
  })

  it('rejects string fields whose type changes under the updater consumer', async () => {
    await Promise.all(
      TARGET_DEFINITIONS.map(({ id }) =>
        updateRawMetadata(id, (metadata) => {
          metadata.releaseName = '2026-07-25'
        })
      )
    )

    await expect(assemble()).rejects.toThrow(
      /must preserve its semantic values and types when parsed by electron-updater/
    )
  })

  it(
    'fails clearly when the installed updater consumer parser is unavailable or incompatible',
    () => {
      expect(() =>
        loadElectronUpdaterMetadataParser({
          resolvePackage: () => {
            throw new Error('electron-updater is unavailable')
          }
        })
      ).toThrow(
        /Release metadata validation requires the installed electron-updater package/
      )
      expect(() =>
        loadElectronUpdaterMetadataParser({
          resolvePackage: () => '/tmp/node_modules/electron-updater/package.json',
          loadProvider: () => ({})
        })
      ).toThrow(
        /Release metadata validation requires the installed electron-updater package/
      )
    }
  )

  it('rejects a consumer result that is not an updater metadata mapping', () => {
    expect(() =>
      parseElectronUpdaterMetadata(
        generatedAt,
        'latest.yml',
        new URL('https://example.com/latest.yml')
      )
    ).toThrow(/latest.yml must contain an updater metadata object/)
  })

  it('revalidates the complete release directory before publication', async () => {
    await assemble()
    const verified = await verifyReleaseAssets({
      directory: outputDirectory,
      sourceSha,
      version,
      workflowRunId,
      workflowRunAttempt
    })
    expect(verified.files).toHaveLength(19)

    const releaseIndexPath = path.join(outputDirectory, 'release-index.json')
    const originalReleaseIndex = await readFile(releaseIndexPath, 'utf8')
    const releaseIndex = JSON.parse(originalReleaseIndex)
    const macTarget = releaseIndex.targets.find(
      ({ id }: { id: string }) => id === 'darwin-arm64'
    )
    delete macTarget.checks.cuaMacHelperDistribution
    await writeFile(releaseIndexPath, JSON.stringify(releaseIndex))
    try {
      await expect(
        verifyReleaseAssets({
          directory: outputDirectory,
          sourceSha,
          version,
          workflowRunId,
          workflowRunAttempt
        })
      ).rejects.toThrow(/cuaMacHelperDistribution/)
    } finally {
      await writeFile(releaseIndexPath, originalReleaseIndex)
    }

    const packageAsset = verified.files.find(
      ({ name }) => name !== 'release-index.json'
    )!
    await writeFile(path.join(outputDirectory, packageAsset.name), 'tampered')
    await expect(
      verifyReleaseAssets({
        directory: outputDirectory,
        sourceSha,
        version,
        workflowRunId,
        workflowRunAttempt
      })
    ).rejects.toThrow(/does not match the release index/)
  })

  it('rejects unknown draft assets and verifies remote upload digests', async () => {
    await assemble()
    const verified = await verifyReleaseAssets({
      directory: outputDirectory,
      sourceSha,
      version,
      workflowRunId,
      workflowRunAttempt
    })
    const createRelease = (files = verified.files) => ({
      tag_name: `v${version}`,
      draft: true,
      prerelease: true,
      assets: files.map((file) => ({
        name: file.name,
        state: 'uploaded',
        size: file.bytes,
        digest: `sha256:${file.sha256}`
      }))
    })

    expect(() =>
      verifyGitHubDraftRelease({
        release: createRelease(),
        expectedFiles: verified.files,
        tag: `v${version}`,
        prerelease: true
      })
    ).not.toThrow()
    expect(() =>
      verifyGitHubDraftRelease({
        release: createRelease(verified.files.slice(0, 1)),
        expectedFiles: verified.files,
        tag: `v${version}`,
        prerelease: true,
        allowPartialAssets: true
      })
    ).not.toThrow()

    const releaseWithUnknownAsset = createRelease()
    releaseWithUnknownAsset.assets.push({
      name: 'unexpected.deb',
      state: 'uploaded',
      size: 1,
      digest: `sha256:${'0'.repeat(64)}`
    })
    expect(() =>
      verifyGitHubDraftRelease({
        release: releaseWithUnknownAsset,
        expectedFiles: verified.files,
        tag: `v${version}`,
        prerelease: true,
        allowPartialAssets: true
      })
    ).toThrow(/unknown or duplicate/)

    const releaseWithBadDigest = createRelease()
    releaseWithBadDigest.assets[0].digest = `sha256:${'0'.repeat(64)}`
    expect(() =>
      verifyGitHubDraftRelease({
        release: releaseWithBadDigest,
        expectedFiles: verified.files,
        tag: `v${version}`,
        prerelease: true
      })
    ).toThrow(/digest or size mismatch/)
  })

  it('rejects a missing target or an unexpected artifact', async () => {
    await rm(artifactRoot('linux-arm64'), { recursive: true })
    await expect(assemble()).rejects.toThrow(/exactly the six package artifacts/)

    await createOnePackageArtifact(
      artifactsDirectory,
      TARGET_DEFINITIONS.find(({ id }) => id === 'linux-arm64')!
    )
    await mkdir(path.join(artifactsDirectory, 'unexpected-artifact'))
    await expect(assemble()).rejects.toThrow(/exactly the six package artifacts/)
  })

  it('rejects missing, unknown, symlinked, and path-escaping package files', async () => {
    const windowsRoot = artifactRoot('win32-x64')
    const manifest = JSON.parse(
      await readFile(path.join(windowsRoot, 'manifest.json'), 'utf8')
    ) as PackageManifest
    const installer = manifest.files.find(({ role }) => role === 'installer')!
    await rm(path.join(windowsRoot, installer.storagePath))
    await expect(assemble()).rejects.toThrow()

    await resetFixtures()
    await writeFile(path.join(artifactRoot('win32-x64'), 'files', 'unexpected.msi'), 'msi')
    await expect(assemble()).rejects.toThrow(/unexpected files entries/)

    await resetFixtures()
    const refreshedRoot = artifactRoot('win32-x64')
    const refreshedManifest = JSON.parse(
      await readFile(path.join(refreshedRoot, 'manifest.json'), 'utf8')
    ) as PackageManifest
    const refreshedInstaller = refreshedManifest.files.find(
      ({ role }) => role === 'installer'
    )!
    const installerPath = path.join(refreshedRoot, refreshedInstaller.storagePath)
    await rm(installerPath)
    await symlink(path.join(refreshedRoot, 'manifest.json'), installerPath)
    await expect(assemble()).rejects.toThrow(/regular non-symlink file/)

    await resetFixtures()
    await updateManifest('win32-x64', (candidate) => {
      candidate.files.find(({ role }) => role === 'installer')!.storagePath =
        '../outside.exe'
    })
    await expect(assemble()).rejects.toThrow(/storage path mismatch/)
  })

  it('rejects duplicate names, unknown fields, and verification manifests', async () => {
    await updateManifest('win32-x64', (manifest) => {
      manifest.reports.push({ ...manifest.reports[0] })
    })
    await expect(assemble()).rejects.toThrow(/invalid or duplicated/)

    await resetFixtures()
    await updateManifest('win32-x64', (manifest) => {
      manifest.build.signed = 'true'
    })
    await expect(assemble()).rejects.toThrow(/unexpected fields: signed/)

    await resetFixtures()
    await updateManifest('linux-x64', (manifest) => {
      manifest.build.purpose = 'verification'
    })
    await expect(assemble()).rejects.toThrow(/requires a distribution manifest/)
  })

  it('recomputes package and updater digests', async () => {
    const root = artifactRoot('linux-x64')
    const manifest = JSON.parse(
      await readFile(path.join(root, 'manifest.json'), 'utf8')
    ) as PackageManifest
    const installer = manifest.files.find(({ role }) => role === 'installer')!
    await writeFile(path.join(root, installer.storagePath), 'tampered')
    await expect(assemble()).rejects.toThrow(/manifest digest or size mismatch/)

    await resetFixtures()
    await updateRawMetadata('win32-x64', (metadata) => {
      const files = metadata.files as Array<Record<string, unknown>>
      files[0].sha512 = Buffer.alloc(64, 1).toString('base64')
    })
    await expect(assemble()).rejects.toThrow(/SHA-512 mismatch/)
  })

  it('rejects incomplete updater metadata and invalid macOS evidence', async () => {
    await updateRawMetadata('darwin-x64', (metadata) => {
      const files = metadata.files as Array<Record<string, unknown>>
      files[0].url = `DeepChat-${version}-mac-x64.dmg`
      metadata.path = files[0].url
    })
    await expect(assemble()).rejects.toThrow(/URL mismatch|must not contain a DMG/)

    await resetFixtures()
    await updateRawMetadata('linux-x64', (metadata) => {
      const files = metadata.files as Array<Record<string, unknown>>
      delete files[0].blockMapSize
    })
    await expect(assemble()).rejects.toThrow(/missing blockMapSize/)

    await resetFixtures()
    await updateRawMetadata('linux-arm64', (metadata) => {
      const files = metadata.files as Array<Record<string, unknown>>
      metadata.files = [files[0], { ...files[0] }]
    })
    await expect(assemble()).rejects.toThrow(/exactly one updater file/)

    await resetFixtures()
    await updateManifest('darwin-arm64', (manifest) => {
      delete manifest.checks.cuaMacHelperDistribution
    })
    await expect(assemble()).rejects.toThrow(/cuaMacHelperDistribution did not pass/)

    await resetFixtures()
    await updateManifest('darwin-arm64', (manifest) => {
      delete manifest.checks.macZipDistribution
    })
    await expect(assemble()).rejects.toThrow(/macZipDistribution did not pass/)

    await resetFixtures()
    await updateManifest('darwin-arm64', (manifest) => {
      delete manifest.checks.macDmgDistribution
    })
    await expect(assemble()).rejects.toThrow(/macDmgDistribution did not pass/)
  })

  it('rejects a size report that does not describe the staged installer', async () => {
    const root = artifactRoot('win32-x64')
    const reportPath = path.join(root, 'reports', 'package-size-win32-x64.json')
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
      comparisons: Array<{ candidate: { sha256: string } }>
    }
    report.comparisons[0].candidate.sha256 = 'f'.repeat(64)
    await writeFile(reportPath, JSON.stringify(report))
    const inspected = await inspectRegularFile(reportPath, root)
    await updateManifest('win32-x64', (manifest) => {
      const record = manifest.reports.find(
        ({ name }) => name === 'package-size-win32-x64.json'
      )!
      record.bytes = inspected.bytes
      record.sha256 = inspected.sha256
    })
    await expect(assemble()).rejects.toThrow(/does not match the package manifest/)
  })
})

async function createPackageArtifacts(artifactsDirectory: string) {
  for (const definition of TARGET_DEFINITIONS) {
    await createOnePackageArtifact(artifactsDirectory, definition)
  }
}

async function createOnePackageArtifact(
  artifactsDirectory: string,
  definition: (typeof TARGET_DEFINITIONS)[number]
) {
  const root = path.join(artifactsDirectory, definition.artifactName)
  const filesDirectory = path.join(root, 'files')
  const metadataDirectory = path.join(root, 'metadata')
  const reportsDirectory = path.join(root, 'reports')
  await Promise.all([
    mkdir(filesDirectory, { recursive: true }),
    mkdir(metadataDirectory, { recursive: true }),
    mkdir(reportsDirectory, { recursive: true })
  ])

  const fileRecords: PackageManifest['files'] = []
  for (const role of definition.roles.filter(({ name }) => name !== 'update-metadata')) {
    const suffix = role.suffixes[0]
    const name = `DeepChat-${version}${suffix}`
    const storagePath = `${role.directory}/${name}`
    const filePath = path.join(root, storagePath)
    await writeFile(filePath, `${definition.id}/${role.name}`)
    const inspected = await inspectRegularFile(filePath, root)
    fileRecords.push({
      role: role.name,
      name,
      storagePath,
      bytes: inspected.bytes,
      sha256: inspected.sha256
    })
  }

  const updaterRole = getUpdaterPayloadRole(definition)
  const updaterPayload = fileRecords.find(({ role }) => role === updaterRole.name)!
  const updaterInspected = await inspectRegularFile(
    path.join(root, updaterPayload.storagePath),
    root
  )
  const metadataPath = path.join(metadataDirectory, definition.metadataName)
  await writeFile(
    metadataPath,
    stringify({
      version,
      files: [
        {
          url: updaterPayload.name,
          sha512: updaterInspected.sha512,
          size: updaterInspected.bytes,
          ...(definition.platform === 'linux'
            ? { blockMapSize: Math.max(1, updaterInspected.bytes - 1) }
            : {})
        }
      ],
      path: updaterPayload.name,
      sha512: updaterInspected.sha512,
      releaseDate: generatedAt
    })
  )
  const metadataInspected = await inspectRegularFile(metadataPath, root)
  fileRecords.push({
    role: 'update-metadata',
    name: definition.metadataName,
    storagePath: `metadata/${definition.metadataName}`,
    bytes: metadataInspected.bytes,
    sha256: metadataInspected.sha256
  })

  const smokeName = `light-ocr-smoke-${definition.id}.json`
  const smokePath = path.join(reportsDirectory, smokeName)
  await writeFile(
    smokePath,
    JSON.stringify({
      schemaVersion: 2,
      target: { platform: definition.platform, arch: definition.arch },
      executed: true,
      componentMetrics: { ocrAssets: {}, nodeRuntime: {}, otherRuntime: {} }
    })
  )

  const sizeName = `package-size-${definition.id}.json`
  const sizePath = path.join(reportsDirectory, sizeName)
  await writeFile(
    sizePath,
    JSON.stringify({
      schemaVersion: 1,
      target: definition.id,
      candidateCommit: sourceSha,
      comparisons: getMeasuredRoles(definition).map(({ name: role }) => {
        const file = fileRecords.find((candidate) => candidate.role === role)!
        return {
          role,
          baseline: {
            name: `baseline-${file.name}`,
            bytes: file.bytes,
            sha256: '0'.repeat(64)
          },
          candidate: {
            name: file.name,
            bytes: file.bytes,
            sha256: file.sha256
          },
          deltaBytes: 0,
          maxGrowthBytes: 1,
          maxShrinkBytes: 1,
          withinPolicy: true
        }
      }),
      withinPolicy: true
    })
  )

  const reports: PackageManifest['reports'] = []
  for (const [name, reportPath] of [
    [smokeName, smokePath],
    [sizeName, sizePath]
  ] as const) {
    const inspected = await inspectRegularFile(reportPath, root)
    reports.push({ name, bytes: inspected.bytes, sha256: inspected.sha256 })
  }

  const checks: Record<string, string> = {
    packageSmoke: 'passed',
    componentSize: 'passed',
    installerSize: 'passed'
  }
  if (definition.platform === 'darwin') {
    checks.cuaMacHelperDistribution = 'passed'
    checks.macAppDistribution = 'passed'
    checks.macZipDistribution = 'passed'
    checks.macDmgDistribution = 'passed'
  }
  const manifest: PackageManifest = {
    schemaVersion: PACKAGE_MANIFEST_SCHEMA_VERSION,
    target: {
      id: definition.id,
      platform: definition.platform,
      arch: definition.arch
    },
    source: { commit: sourceSha, version },
    build: {
      purpose: 'distribution',
      electron: '41.10.4',
      electronBuilder: '26.15.3',
      workflowRunId,
      workflowRunAttempt
    },
    checks,
    files: fileRecords,
    reports
  }
  await writeFile(
    path.join(root, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  )
}
