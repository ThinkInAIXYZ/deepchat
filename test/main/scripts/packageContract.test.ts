import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stringify } from 'yaml'

import {
  comparePackageSize,
  main as packageSizeMain,
  validatePackageSizeBaseline,
  validatePackageSizePolicy
} from '../../../scripts/ci/check-package-size.mjs'
import {
  classifyPackageImpact,
  classifyPackageJsonImpact,
  isPackageImpactPath,
  main as classifyPackageImpactMain,
  normalizeChangedPath
} from '../../../scripts/ci/classify-package-impact.mjs'
import {
  createDefaultPackageSizePolicy,
  expectedReleaseAssetCount,
  getMeasuredRoles,
  getTargetDefinition,
  PACKAGE_MANIFEST_SCHEMA_VERSION,
  RELEASE_INDEX_SCHEMA_VERSION,
  SHA512_BASE64_PATTERN,
  TARGET_DEFINITIONS
} from '../../../scripts/ci/package-contract.mjs'
import {
  createPackageManifest,
  validateMacZipEntries,
  verifyMacAppDistribution,
  verifyMacZipDistribution
} from '../../../scripts/ci/package-manifest.mjs'
import { prepareReleaseContext } from '../../../scripts/ci/release-preflight.mjs'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('fs/promises')
vi.unmock('node:fs/promises')
vi.unmock('path')
vi.unmock('node:path')

const sourceSha = 'a'.repeat(40)
const version = '1.2.3-beta.1'
const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex')
const sha512 = (value: string | Buffer) =>
  createHash('sha512').update(value).digest('base64')

describe('CI package contract', () => {
  it('defines the six targets and the 19-file release surface', () => {
    expect(TARGET_DEFINITIONS.map(({ id }) => id)).toEqual([
      'win32-x64',
      'win32-arm64',
      'linux-x64',
      'linux-arm64',
      'darwin-x64',
      'darwin-arm64'
    ])
    expect(expectedReleaseAssetCount()).toBe(19)
    expect(PACKAGE_MANIFEST_SCHEMA_VERSION).toBe(2)
    expect(RELEASE_INDEX_SCHEMA_VERSION).toBe(2)
    expect(SHA512_BASE64_PATTERN.test(Buffer.alloc(64).toString('base64'))).toBe(true)
  })

  it('classifies shared and platform-owned package inputs with rule evidence', () => {
    expect(classifyPackageImpact(['electron-builder.yml'])).toEqual({
      required: true,
      windows: true,
      linux: true,
      macos: true,
      matchedPaths: ['electron-builder.yml'],
      matches: [
        {
          path: 'electron-builder.yml',
          rule: 'shared-package-contract',
          platforms: ['windows', 'linux', 'macos']
        }
      ]
    })
    expect(classifyPackageImpact(['.github/workflows/_package-windows.yml'])).toMatchObject({
      required: true,
      windows: true,
      linux: false,
      macos: false
    })
    expect(classifyPackageImpact(['build/icon.png'])).toMatchObject({
      required: true,
      windows: false,
      linux: true,
      macos: false
    })
    expect(classifyPackageImpact(['scripts/notarize.js'])).toMatchObject({
      required: true,
      windows: false,
      linux: false,
      macos: true
    })
    for (const cuaMacosPath of [
      'scripts/cua-macos-contract.mjs',
      'scripts/ci/verify-cua-macos-helper.mjs',
      'scripts/macos-release-contract.mjs',
      'scripts/sign-cua-helper.mjs'
    ]) {
      expect(classifyPackageImpact([cuaMacosPath])).toMatchObject({
        required: true,
        windows: false,
        linux: false,
        macos: true
      })
    }
    for (const backgroundPath of [
      'build/dmg-background.png',
      'build/dmg-background@2x.png'
    ]) {
      expect(classifyPackageImpact([backgroundPath])).toEqual({
        required: true,
        windows: false,
        linux: false,
        macos: true,
        matchedPaths: [backgroundPath],
        matches: [
          {
            path: backgroundPath,
            rule: 'macos-package-input',
            platforms: ['macos']
          }
        ]
      })
    }
    expect(classifyPackageImpact(['resources/icon.png'])).toMatchObject({
      required: true,
      windows: false,
      linux: true,
      macos: true
    })
  })

  it('ignores release-only tooling, generated data, ordinary source, and unrelated workflows', () => {
    expect(
      classifyPackageImpact([
        '.github/workflows/build.yml',
        '.github/workflows/prcheck.yml',
        '.github/workflows/release.yml',
        '.github/workflows/package-regression.yml',
        'docs/architecture/example/spec.md',
        'resources/acp-registry/registry.json',
        'resources/model-db/providers.json',
        'scripts/ci/assemble-release.mjs',
        'scripts/ci/release-preflight.mjs',
        'scripts/ci/verify-release-assets.mjs',
        'scripts/fetch-acp-registry.mjs',
        'scripts/fetch-provider-db.mjs',
        'src/main/ocr/imageTextExtractionService.ts',
        'src/renderer/src/components/Example.vue'
      ])
    ).toEqual({
      required: false,
      windows: false,
      linux: false,
      macos: false,
      matchedPaths: [],
      matches: []
    })
    expect(() => normalizeChangedPath('../electron-builder.yml')).toThrow(
      /escapes the repository/
    )
    expect(() => normalizeChangedPath('scripts//afterPack.js')).toThrow(/not canonical/)
    expect(() => normalizeChangedPath('scripts/./afterPack.js')).toThrow(/not canonical/)
  })

  it('classifies package.json by packaging semantics instead of path alone', () => {
    const base = {
      name: 'deepchat',
      dependencies: { sharp: '1.0.0' },
      devDependencies: {
        electron: '40.0.0',
        'markstream-vue': '1.0.0'
      },
      scripts: {
        build: 'electron-vite build',
        test: 'vitest'
      }
    }
    expect(isPackageImpactPath('package.json')).toBe(true)
    const testOnly = structuredClone(base)
    testOnly.scripts.test = 'vitest run'
    testOnly.devDependencies['markstream-vue'] = '1.1.0'
    expect(classifyPackageJsonImpact(base, testOnly)).toEqual({
      required: false,
      changedFields: [],
      changedScripts: [],
      changedDevDependencies: []
    })
    expect(
      classifyPackageImpact(['package.json'], {
        basePackageJson: base,
        headPackageJson: testOnly
      })
    ).toMatchObject({
      required: false,
      windows: false,
      linux: false,
      macos: false
    })

    const buildScript = structuredClone(base)
    buildScript.scripts.build = 'electron-vite build --mode production'
    expect(classifyPackageJsonImpact(base, buildScript)).toMatchObject({
      required: true,
      changedScripts: ['build']
    })

    const productionDependency = structuredClone(base)
    productionDependency.dependencies.sharp = '2.0.0'
    expect(classifyPackageJsonImpact(base, productionDependency)).toMatchObject({
      required: true,
      changedFields: ['dependencies']
    })

    const electronToolchain = structuredClone(base)
    electronToolchain.devDependencies.electron = '41.0.0'
    expect(classifyPackageJsonImpact(base, electronToolchain)).toMatchObject({
      required: true,
      changedDevDependencies: ['electron']
    })
    expect(() => classifyPackageImpact(['package.json'])).toThrow(/requires base and head/)
  })

  it('requires lossless NUL-delimited diff input and writes compatible GitHub outputs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'package-impact-'))
    const outputPath = path.join(outputDirectory, 'github-output')
    try {
      const result = await classifyPackageImpactMain(
        ['--github-output', outputPath],
        Readable.from([Buffer.from('electron-builder.yml\0docs/readme.md\0')])
      )
      expect(result).toMatchObject({
        required: true,
        windows: true,
        linux: true,
        macos: true,
        matchedPaths: ['electron-builder.yml'],
        matches: [{ rule: 'shared-package-contract' }]
      })
      const output = await readFile(outputPath, 'utf8')
      expect(output).toContain('required=true\n')
      expect(output).toContain('windows=true\n')
      expect(output).toContain('linux=true\n')
      expect(output).toContain('macos=true\n')
      expect(output).toContain('matched=["electron-builder.yml"]\n')

      await expect(
        classifyPackageImpactMain(
          [],
          Readable.from([Buffer.from('electron-builder.yml\n')])
        )
      ).rejects.toThrow(/NUL-delimited/)
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })

  it('loads package.json snapshots for CLI semantic classification', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'package-json-impact-'))
    const basePath = path.join(outputDirectory, 'base.json')
    const headPath = path.join(outputDirectory, 'head.json')
    try {
      await writeFile(
        basePath,
        JSON.stringify({ scripts: { test: 'vitest', build: 'electron-vite build' } })
      )
      await writeFile(
        headPath,
        JSON.stringify({ scripts: { test: 'vitest run', build: 'electron-vite build' } })
      )
      await expect(
        classifyPackageImpactMain(
          ['--base-package-json', basePath, '--head-package-json', headPath],
          Readable.from([Buffer.from('package.json\0')])
        )
      ).resolves.toMatchObject({
        required: false,
        windows: false,
        linux: false,
        macos: false
      })
      await expect(
        classifyPackageImpactMain(
          [],
          Readable.from([Buffer.from('package.json\0')])
        )
      ).rejects.toThrow(/snapshot paths/)
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })

  it('requires an exact tag, package version, and non-empty changelog section', () => {
    const context = prepareReleaseContext({
      tag: `v${version}`,
      sourceSha,
      packageJson: { version },
      changelog: `# Changelog\n\n## v${version} (2026-07-23)\n\n- Added contract checks.\n\n## v1.2.2 (2026-07-01)\n\n- Previous.\n`
    })
    expect(context).toMatchObject({
      tag: `v${version}`,
      sourceSha,
      version,
      prerelease: true
    })
    expect(context.releaseNotes).toContain('Added contract checks.')

    expect(() =>
      prepareReleaseContext({
        tag: `v${version}`,
        sourceSha,
        packageJson: { version: '1.2.3' },
        changelog: ''
      })
    ).toThrow(/does not match/)
    expect(() =>
      prepareReleaseContext({
        tag: `v${version}`,
        sourceSha,
        packageJson: { version },
        changelog: `## v${version} (2026-07-23)\n`
      })
    ).toThrow(/is empty/)
    expect(() =>
      prepareReleaseContext({
        tag: `v${version}`,
        sourceSha,
        packageJson: { version },
        changelog: `## v${version} (2026-07-23)\n\n- First.\n\n## v${version} (2026-07-22)\n\n- Duplicate.\n`
      })
    ).toThrow(/duplicate/)
  })

  it('derives macOS application evidence from distribution verification commands', async () => {
    const appPath = '/tmp/DeepChat.app'
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === '/usr/bin/codesign' && args[0] === '--display') {
        return {
          stdout: '',
          stderr:
            'Authority=Developer ID Application: DeepChat (Y7P5QLKLYG)\nTimestamp=Jul 23, 2026 at 20:00:00\n'
        }
      }
      return { stdout: '', stderr: '' }
    })

    await verifyMacAppDistribution(appPath, {
      teamId: 'Y7P5QLKLYG',
      runCommand
    })
    expect(runCommand).toHaveBeenCalledWith(
      '/usr/bin/xcrun',
      ['stapler', 'validate', '-v', appPath],
      expect.any(Object)
    )
    expect(runCommand).toHaveBeenCalledWith(
      '/usr/sbin/spctl',
      ['--assess', '--type', 'execute', '--verbose=4', appPath],
      expect.any(Object)
    )
    expect(runCommand).toHaveBeenCalledWith(
      '/usr/bin/syspolicy_check',
      ['distribution', appPath],
      expect.any(Object)
    )

    const unsignedCommand = vi.fn(async () => ({ stdout: '', stderr: 'Signature=adhoc\n' }))
    await expect(
      verifyMacAppDistribution(appPath, {
        teamId: 'Y7P5QLKLYG',
        runCommand: unsignedCommand
      })
    ).rejects.toThrow(/Developer ID Application/)
  })

  it('verifies the updater ZIP after extracting its sole application payload', async () => {
    const zipPath = '/tmp/DeepChat-1.2.3-mac-arm64.zip'
    let extractionRoot = ''
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === '/usr/bin/unzip') {
        return {
          stdout: 'DeepChat.app/\nDeepChat.app/Contents/Info.plist\n',
          stderr: ''
        }
      }
      expect(command).toBe('/usr/bin/ditto')
      extractionRoot = args.at(-1)!
      await mkdir(path.join(extractionRoot, 'DeepChat.app'))
      return { stdout: '', stderr: '' }
    })
    const verifyCuaMacHelper = vi.fn(async () => {})
    const verifyMacApp = vi.fn(async () => {})

    await expect(
      verifyMacZipDistribution(zipPath, {
        teamId: 'Y7P5QLKLYG',
        runCommand,
        verifyCuaMacHelper,
        verifyMacApp
      })
    ).resolves.toBe(true)
    expect(runCommand).toHaveBeenCalledWith(
      '/usr/bin/ditto',
      ['-x', '-k', zipPath, extractionRoot],
      expect.any(Object)
    )
    expect(extractionRoot).not.toBe('')
    const extractedAppPath = path.join(extractionRoot, 'DeepChat.app')
    expect(verifyCuaMacHelper).toHaveBeenCalledWith(extractedAppPath, {
      teamId: 'Y7P5QLKLYG',
      runCommand
    })
    expect(verifyMacApp).toHaveBeenCalledWith(extractedAppPath, {
      teamId: 'Y7P5QLKLYG',
      runCommand
    })
    await expect(lstat(extractionRoot)).rejects.toThrow()
  })

  it('rejects updater ZIPs with an unexpected root payload', async () => {
    const verifyCuaMacHelper = vi.fn(async () => {})
    const verifyMacApp = vi.fn(async () => {})
    let extractionRoot = ''

    await expect(
      verifyMacZipDistribution('/tmp/DeepChat.zip', {
        teamId: 'Y7P5QLKLYG',
        runCommand: async (command: string, args: string[]) => {
          if (command === '/usr/bin/unzip') {
            return {
              stdout: 'DeepChat.app/\nDeepChat.app/Contents/Info.plist\n',
              stderr: ''
            }
          }
          extractionRoot = args.at(-1)!
          await Promise.all([
            mkdir(path.join(extractionRoot, 'DeepChat.app')),
            writeFile(path.join(extractionRoot, 'unexpected.txt'), 'unexpected')
          ])
          return { stdout: '', stderr: '' }
        },
        verifyCuaMacHelper,
        verifyMacApp
      })
    ).rejects.toThrow(/exactly one root DeepChat.app/)
    expect(verifyCuaMacHelper).not.toHaveBeenCalled()
    expect(verifyMacApp).not.toHaveBeenCalled()
    expect(extractionRoot).not.toBe('')
    await expect(lstat(extractionRoot)).rejects.toThrow()
  })

  it('rejects unsafe or ambiguous updater ZIP entry paths before extraction', () => {
    expect(
      validateMacZipEntries('DeepChat.app/\nDeepChat.app/Contents/Info.plist\n')
    ).toEqual(['DeepChat.app/', 'DeepChat.app/Contents/Info.plist'])

    for (const unsafeEntries of [
      '../DeepChat.app/Contents/Info.plist\n',
      '/DeepChat.app/Contents/Info.plist\n',
      'DeepChat.app\\Contents\\Info.plist\n',
      'Other.app/Contents/Info.plist\n',
      'DeepChat.app/Contents/../escape\n',
      'DeepChat.app/Contents/Info.plist\nDeepChat.app/Contents/Info.plist\n'
    ]) {
      expect(() => validateMacZipEntries(unsafeEntries)).toThrow(/unsafe entry|duplicate entry/)
    }
  })
})

describe('package-size contract', () => {
  let tempDirectory: string

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-package-size-'))
  })

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true })
  })

  const createBaseline = () => ({
    schemaVersion: 1,
    source: {
      runId: '29978292769',
      commit: sourceSha,
      version,
      workflow: 'Build Application'
    },
    targets: Object.fromEntries(
      TARGET_DEFINITIONS.map((definition) => [
        definition.id,
        Object.fromEntries(
          getMeasuredRoles(definition).map((role) => [
            role.name,
            {
              name: `DeepChat-${version}${role.suffixes[0]}`,
              bytes: 6,
              sha256: '0'.repeat(64),
              artifactId: '123'
            }
          ])
        )
      ])
    )
  })

  it('accepts exact growth and shrink limits and rejects either overrun', async () => {
    const definition = getTargetDefinition('win32-x64')
    const candidateName = `DeepChat-${version}-windows-x64.exe`
    const candidatePath = path.join(tempDirectory, candidateName)
    const baseline = createBaseline()
    const policy = createDefaultPackageSizePolicy()
    policy.targets[definition.id].installer = {
      maxGrowthBytes: 3,
      maxShrinkBytes: 5
    }

    await writeFile(candidatePath, '123456789')
    await expect(
      comparePackageSize({
        target: definition.id,
        candidateDirectory: tempDirectory,
        candidateCommit: sourceSha,
        baseline,
        policy
      })
    ).resolves.toMatchObject({
      withinPolicy: true,
      comparisons: [{ deltaBytes: 3, withinPolicy: true }]
    })

    await writeFile(candidatePath, '1234567890')
    await expect(
      comparePackageSize({
        target: definition.id,
        candidateDirectory: tempDirectory,
        candidateCommit: sourceSha,
        baseline,
        policy
      })
    ).resolves.toMatchObject({
      withinPolicy: false,
      comparisons: [{ deltaBytes: 4, withinPolicy: false }]
    })

    await writeFile(candidatePath, '1')
    await expect(
      comparePackageSize({
        target: definition.id,
        candidateDirectory: tempDirectory,
        candidateCommit: sourceSha,
        baseline,
        policy
      })
    ).resolves.toMatchObject({
      withinPolicy: true,
      comparisons: [{ deltaBytes: -5, withinPolicy: true }]
    })

    await writeFile(candidatePath, '')
    await expect(
      comparePackageSize({
        target: definition.id,
        candidateDirectory: tempDirectory,
        candidateCommit: sourceSha,
        baseline,
        policy
      })
    ).resolves.toMatchObject({
      withinPolicy: false,
      comparisons: [{ deltaBytes: -6, withinPolicy: false }]
    })
  })

  it('rejects unknown baseline and policy entries', () => {
    const baseline = createBaseline()
    baseline.targets['unknown-x64'] = {}
    expect(() => validatePackageSizeBaseline(baseline)).toThrow(/unexpected targets/)

    const policy = createDefaultPackageSizePolicy()
    policy.targets['win32-x64'].unknown = {
      maxGrowthBytes: 1,
      maxShrinkBytes: 1
    }
    expect(() => validatePackageSizePolicy(policy)).toThrow(/unexpected win32-x64 roles/)
  })

  it('defaults the package-size CLI to comparison when options are passed directly', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const definition = getTargetDefinition('win32-x64')
    const baselinePath = path.join(tempDirectory, 'baseline.json')
    const policyPath = path.join(tempDirectory, 'policy.json')
    const reportPath = path.join(tempDirectory, 'report.json')
    await Promise.all([
      writeFile(
        path.join(tempDirectory, `DeepChat-${version}-windows-x64.exe`),
        '123456'
      ),
      writeFile(baselinePath, JSON.stringify(createBaseline())),
      writeFile(policyPath, JSON.stringify(createDefaultPackageSizePolicy()))
    ])

    await expect(
      packageSizeMain([
        '--target',
        definition.id,
        '--candidate-dir',
        tempDirectory,
        '--candidate-commit',
        sourceSha,
        '--baseline',
        baselinePath,
        '--policy',
        policyPath,
        '--report',
        reportPath
      ])
    ).resolves.toMatchObject({ target: definition.id, withinPolicy: true })
  })

  it('keeps the committed baseline provenance and policy in sync with the contract', async () => {
    const baseline = JSON.parse(
      await readFile(path.resolve('resources/package-size-baseline.json'), 'utf8')
    )
    const policy = JSON.parse(
      await readFile(path.resolve('resources/package-size-policy.json'), 'utf8')
    )

    expect(() => validatePackageSizeBaseline(baseline)).not.toThrow()
    expect(baseline.source).toEqual({
      runId: '29978292769',
      commit: 'dfb4ba0f34c008c27cfb6bd98a08fdbd36f7b343',
      version: '1.1.0-beta.4',
      workflow: 'Build Application'
    })
    expect(policy).toEqual(createDefaultPackageSizePolicy())
  })
})

describe('package manifest staging', () => {
  let tempDirectory: string
  let projectDirectory: string
  let distDirectory: string

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-package-manifest-'))
    projectDirectory = path.join(tempDirectory, 'project')
    distDirectory = path.join(projectDirectory, 'dist')
    await mkdir(distDirectory, { recursive: true })
    await writeFile(
      path.join(projectDirectory, 'package.json'),
      JSON.stringify({
        version,
        devDependencies: {
          electron: '41.10.4',
          'electron-builder': '26.15.3'
        }
      })
    )
  })

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true })
  })

  async function prepareWindowsPackage() {
    const installerName = `DeepChat-${version}-windows-x64.exe`
    const installer = Buffer.from('installer')
    const blockmapName = `${installerName}.blockmap`
    const smokePath = path.join(distDirectory, 'light-ocr-smoke-win32-x64.json')
    const sizePath = path.join(distDirectory, 'package-size-win32-x64.json')
    await Promise.all([
      writeFile(path.join(distDirectory, installerName), installer),
      writeFile(path.join(distDirectory, blockmapName), 'blockmap'),
      writeFile(path.join(distDirectory, 'builder-debug.yml'), 'must not be staged'),
      writeFile(
        path.join(distDirectory, 'latest.yml'),
        stringify({
          version,
          files: [
            {
              url: installerName,
              sha512: sha512(installer),
              size: installer.length
            }
          ],
          path: installerName,
          sha512: sha512(installer),
          releaseDate: '2026-07-23T00:00:00.000Z'
        })
      ),
      writeFile(
        smokePath,
        JSON.stringify({
          schemaVersion: 2,
          target: { platform: 'win32', arch: 'x64' },
          executed: true,
          componentMetrics: { ocrAssets: {}, nodeRuntime: {}, otherRuntime: {} }
        })
      ),
      writeFile(
        sizePath,
        JSON.stringify({
          schemaVersion: 1,
          target: 'win32-x64',
          candidateCommit: sourceSha,
          comparisons: [
            {
              role: 'installer',
              baseline: {
                name: 'baseline.exe',
                bytes: installer.length,
                sha256: '0'.repeat(64)
              },
              candidate: {
                name: installerName,
                bytes: installer.length,
                sha256: sha256(installer)
              },
              deltaBytes: 0,
              maxGrowthBytes: 1,
              maxShrinkBytes: 1,
              withinPolicy: true
            }
          ],
          withinPolicy: true
        })
      )
    ])
    return { installerName, smokePath, sizePath }
  }

  async function prepareMacPackage() {
    const dmgName = `DeepChat-${version}-mac-arm64.dmg`
    const zipName = `DeepChat-${version}-mac-arm64.zip`
    const zip = Buffer.from('updater zip')
    const smokePath = path.join(distDirectory, 'light-ocr-smoke-darwin-arm64.json')
    await Promise.all([
      writeFile(path.join(distDirectory, dmgName), 'dmg'),
      writeFile(path.join(distDirectory, zipName), zip),
      writeFile(path.join(distDirectory, `${zipName}.blockmap`), 'blockmap'),
      writeFile(
        path.join(distDirectory, 'latest-mac.yml'),
        stringify({
          version,
          files: [
            {
              url: zipName,
              sha512: sha512(zip),
              size: zip.length
            }
          ],
          path: zipName,
          sha512: sha512(zip),
          releaseDate: '2026-07-23T00:00:00.000Z'
        })
      ),
      writeFile(
        smokePath,
        JSON.stringify({
          schemaVersion: 2,
          target: { platform: 'darwin', arch: 'arm64' },
          executed: true,
          componentMetrics: { ocrAssets: {}, nodeRuntime: {}, otherRuntime: {} }
        })
      )
    ])
    return { dmgName, zipName, smokePath }
  }

  it('stages only allowlisted files and never adds Windows signing claims', async () => {
    const { installerName, smokePath, sizePath } = await prepareWindowsPackage()
    const outputDirectory = path.join(tempDirectory, 'output')
    const manifest = await createPackageManifest({
      projectDirectory,
      distDirectory,
      outputDirectory,
      platform: 'win32',
      arch: 'x64',
      sourceSha,
      purpose: 'distribution',
      reportPaths: [smokePath],
      installerSizeReportPath: sizePath,
      actualSourceSha: sourceSha,
      workflow: { runId: '42', runAttempt: '1' }
    })

    expect(manifest.checks).toEqual({
      packageSmoke: 'passed',
      componentSize: 'passed',
      installerSize: 'passed'
    })
    expect(manifest).not.toHaveProperty('signed')
    expect(manifest.build).not.toHaveProperty('signed')
    expect(await readdir(path.join(outputDirectory, 'files'))).toEqual([
      installerName,
      `${installerName}.blockmap`
    ])
    expect(await readdir(path.join(outputDirectory, 'metadata'))).toEqual([
      'latest.yml'
    ])
    expect(
      await readFile(path.join(outputDirectory, 'manifest.json'), 'utf8')
    ).not.toContain('builder-debug.yml')
  })

  it('rejects duplicate diagnostic basenames', async () => {
    const { smokePath, sizePath } = await prepareWindowsPackage()
    await expect(
      createPackageManifest({
        projectDirectory,
        distDirectory,
        outputDirectory: path.join(tempDirectory, 'duplicate-output'),
        platform: 'win32',
        arch: 'x64',
        sourceSha,
        purpose: 'distribution',
        reportPaths: [smokePath, smokePath],
        installerSizeReportPath: sizePath,
        actualSourceSha: sourceSha
      })
    ).rejects.toThrow(/Duplicate diagnostic report basename/)
  })

  it('derives macOS ZIP evidence from the staged updater payload', async () => {
    const { zipName, smokePath } = await prepareMacPackage()
    const outputDirectory = path.join(tempDirectory, 'mac-output')
    const verifyCuaMacHelper = vi.fn(async () => {})
    const verifyMacApp = vi.fn(async () => {})
    const verifyMacZip = vi.fn(async () => {})
    const verifyMacDmg = vi.fn(async () => {})

    const manifest = await createPackageManifest({
      projectDirectory,
      distDirectory,
      outputDirectory,
      platform: 'darwin',
      arch: 'arm64',
      sourceSha,
      purpose: 'distribution',
      reportPaths: [smokePath],
      actualSourceSha: sourceSha,
      macAppPath: '/tmp/DeepChat.app',
      appleTeamId: 'Y7P5QLKLYG',
      verifyCuaMacHelper,
      verifyMacApp,
      verifyMacZip,
      verifyMacDmg
    })

    expect(verifyMacZip).toHaveBeenCalledWith(
      path.join(outputDirectory, 'files', zipName),
      { teamId: 'Y7P5QLKLYG' }
    )
    expect(manifest.checks).toMatchObject({
      cuaMacHelperDistribution: 'passed',
      macAppDistribution: 'passed',
      macZipDistribution: 'passed',
      macDmgDistribution: 'passed'
    })
  })
})
