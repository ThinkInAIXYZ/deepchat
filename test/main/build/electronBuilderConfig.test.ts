import { readFile } from 'fs/promises'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface ElectronBuilderConfig {
  asarUnpack?: string[]
}

interface PackageJson {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

interface WorkflowMatrixEntry {
  arch: string
  platform: string
  runner: string
  unpacked: string
}

interface WorkflowStep {
  name?: string
  if?: string
  run?: string
  with?: Record<string, string>
}

interface WorkflowJob {
  'runs-on'?: string
  strategy?: {
    matrix?: {
      include?: WorkflowMatrixEntry[]
    }
  }
  steps?: WorkflowStep[]
}

interface GitHubWorkflow {
  jobs?: Record<string, WorkflowJob>
}

const OPENDAL_VERSION = '0.49.2'
const OPENDAL_NATIVE_PACKAGES = [
  '@opendal/lib-darwin-arm64',
  '@opendal/lib-darwin-x64',
  '@opendal/lib-linux-arm64-gnu',
  '@opendal/lib-linux-arm64-musl',
  '@opendal/lib-linux-x64-gnu',
  '@opendal/lib-linux-x64-musl',
  '@opendal/lib-win32-arm64-msvc',
  '@opendal/lib-win32-x64-msvc'
] as const

const readElectronBuilderConfig = async () => {
  const configPath = path.join(process.cwd(), 'electron-builder.yml')
  return parse(await readFile(configPath, 'utf8')) as ElectronBuilderConfig
}

const readPackageJson = async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json')
  return JSON.parse(await readFile(packageJsonPath, 'utf8')) as PackageJson
}

const readWorkflow = async (name: string) => {
  const workflowPath = path.join(process.cwd(), '.github', 'workflows', name)
  return parse(await readFile(workflowPath, 'utf8')) as GitHubWorkflow
}

describe('electron-builder config', () => {
  it('unpacks native dependencies for packaged app loading and signing', async () => {
    const config = await readElectronBuilderConfig()

    expect(config.asarUnpack).toEqual(
      expect.arrayContaining([
        '**/node_modules/@ff-labs/fff-node/**/*',
        '**/node_modules/@ff-labs/fff-bin-*/**/*',
        '**/node_modules/opendal/**/*',
        '**/node_modules/@opendal/**/*',
        '**/node_modules/ffi-rs/**/*',
        '**/node_modules/@yuuang/ffi-rs-*/**/*'
      ])
    )
  })

  it('pins OpenDAL native packages to the Ubuntu 22.04 compatible ABI version', async () => {
    const packageJson = await readPackageJson()

    expect(packageJson.dependencies?.opendal).toBe(OPENDAL_VERSION)
    expect(Object.keys(packageJson.optionalDependencies ?? {}).sort()).toEqual(
      expect.arrayContaining([...OPENDAL_NATIVE_PACKAGES].sort())
    )

    for (const packageName of OPENDAL_NATIVE_PACKAGES) {
      expect(packageJson.optionalDependencies?.[packageName]).toBe(OPENDAL_VERSION)
    }
  })
})

describe('Linux ARM64 packaging', () => {
  it.each(['build.yml', 'release.yml'])('%s builds both Linux architectures without ARM64 CUA', async (name) => {
    const workflow = await readWorkflow(name)
    const linuxJob = workflow.jobs?.['build-linux']
    const steps = linuxJob?.steps ?? []

    expect(linuxJob?.['runs-on']).toBe('${{ matrix.runner }}')
    expect(linuxJob?.strategy?.matrix?.include).toEqual([
      {
        arch: 'x64',
        platform: 'linux-x64',
        runner: 'ubuntu-24.04',
        unpacked: 'linux-unpacked'
      },
      {
        arch: 'arm64',
        platform: 'linux-arm64',
        runner: 'ubuntu-24.04-arm',
        unpacked: 'linux-arm64-unpacked'
      }
    ])

    const cuaSteps = steps.filter((step) => step.run?.includes('--name cua --platform linux'))
    expect(cuaSteps).toHaveLength(2)
    expect(cuaSteps.every((step) => step.if === "matrix.arch == 'x64'")).toBe(true)

    expect(steps.find((step) => step.name === 'Install Linux runtimes')?.run).toBe(
      'pnpm run installRuntime:linux:${{ matrix.arch }}'
    )
    expect(steps.find((step) => step.name === 'Bundle Feishu plugin')?.if).toBeUndefined()

    const ocrSmoke = steps.find((step) => step.name === 'Verify packaged Light OCR for Linux')
    expect(ocrSmoke?.if).toBeUndefined()
    expect(ocrSmoke?.run).toContain('--expect-supported')
    expect(ocrSmoke?.run).toContain('dist/${{ matrix.unpacked }}/resources')
    expect(
      steps.find((step) => step.name?.includes('OCR is unavailable'))
    ).toBeUndefined()

    const ocrSize = steps.find((step) => step.name === 'Enforce Light OCR package size for Linux')
    expect(ocrSize?.if).toBeUndefined()
    expect(ocrSize?.with?.['runtime-token']).toContain('RTK_GITHUB_TOKEN')

    const commands = steps.map((step) => step.run ?? '').join('\n')
    expect(commands).toContain('dist/${{ matrix.unpacked }}/resources')
    expect(commands).not.toContain('dist/linux-unpacked/resources')

    const uploadPaths = steps.find((step) => step.name === 'Upload artifacts')?.with?.path
    expect(uploadPaths).toContain('!dist/linux-unpacked')
    expect(uploadPaths).toContain('!dist/linux-arm64-unpacked')
  })

  it('keeps local Linux ARM64 packaging free of CUA', async () => {
    const packageJson = await readPackageJson()
    const buildScript = packageJson.scripts?.['build:linux:arm64']
    const ocrRuntimeScript = packageJson.scripts?.['installRuntime:ocr:linux:arm64']

    expect(buildScript).toContain('plugin:bundle -- --name feishu --platform linux --arch arm64')
    expect(buildScript).toContain('electron-builder --linux --arm64')
    expect(buildScript).not.toContain('plugin:bundle -- --name cua')
    expect(ocrRuntimeScript).toBe(
      'node scripts/install-runtime.mjs --platform linux --arch arm64 --types node'
    )
  })

  it('declares the pinned Linux ARM64 Light OCR native package', async () => {
    const runtimeVersions = JSON.parse(
      await readFile(path.join(process.cwd(), 'resources', 'runtime-versions.json'), 'utf8')
    ) as {
      lightOcr?: { nativePackages?: Record<string, string> }
    }

    expect(runtimeVersions.lightOcr?.nativePackages?.['linux-arm64']).toBe(
      '@arcships/light-ocr-linux-arm64-gnu'
    )
  })

  it('collects Linux ARM64 packages and update metadata for releases', async () => {
    const workflow = await readWorkflow('release.yml')
    const prepareAssets = workflow.jobs?.release?.steps?.find(
      (step) => step.name === 'Prepare release assets'
    )?.run

    expect(prepareAssets).toContain('artifacts/deepchat-linux-arm64/*.AppImage')
    expect(prepareAssets).toContain('artifacts/deepchat-linux-arm64/*.tar.gz')
    expect(prepareAssets).toContain('artifacts/deepchat-linux-arm64/*.yml')
    expect(prepareAssets).toContain('artifacts/deepchat-linux-arm64/*.blockmap')
  })
})
