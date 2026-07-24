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

interface WorkflowStep {
  name?: string
  uses?: string
  if?: string
  run?: string
  with?: Record<string, unknown>
}

interface WorkflowJob {
  'runs-on'?: string
  strategy?: {
    'fail-fast'?: boolean
    matrix?: {
      arch?: string[]
    }
  }
  uses?: string
  with?: Record<string, unknown>
  steps?: WorkflowStep[]
}

interface GitHubWorkflow {
  jobs?: Record<string, WorkflowJob>
}

const OPENDAL_VERSION = '0.49.5'
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
        '**/node_modules/@zerob13/nativekit/prebuilds/**/*',
        '**/node_modules/ffi-rs/**/*',
        '**/node_modules/@yuuang/ffi-rs-*/**/*'
      ])
    )
  })

  it('pins NativeKit to the reviewed native overlay release', async () => {
    const packageJson = await readPackageJson()

    expect(packageJson.dependencies?.['@zerob13/nativekit']).toBe('0.6.2')
  })

  it('pins the OpenDAL facade and native packages to the same release', async () => {
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
  it.each([
    {
      name: 'build.yml',
      sourceSha: '${{ github.sha }}',
      enforceInstallerSize: false
    },
    {
      name: 'release.yml',
      sourceSha: '${{ needs.preflight.outputs.sha }}',
      enforceInstallerSize: true
    }
  ])(
    '$name delegates both Linux architectures to the reusable package workflow',
    async ({ name, sourceSha, enforceInstallerSize }) => {
      const workflow = await readWorkflow(name)
      const linuxJob = workflow.jobs?.['package-linux']

      expect(linuxJob?.strategy).toEqual({
        'fail-fast': false,
        matrix: { arch: ['x64', 'arm64'] }
      })
      expect(linuxJob?.uses).toBe('./.github/workflows/_package-linux.yml')
      expect(linuxJob?.with).toEqual({
        'source-sha': sourceSha,
        arch: '${{ matrix.arch }}',
        'artifact-purpose': 'distribution',
        'enforce-installer-size': enforceInstallerSize
      })
    }
  )

  it('owns runner selection and x64-only CUA behavior in the Linux reusable workflow', async () => {
    const workflow = await readWorkflow('_package-linux.yml')
    const linuxJob = workflow.jobs?.package
    const steps = linuxJob?.steps ?? []

    expect(linuxJob?.['runs-on']).toBe(
      "${{ inputs.arch == 'arm64' && 'ubuntu-24.04-arm' || 'ubuntu-24.04' }}"
    )
    const cuaSteps = steps.filter((step) => step.run?.includes('--name cua --platform linux'))
    expect(cuaSteps).toHaveLength(2)
    expect(cuaSteps.every((step) => step.if === "inputs.arch == 'x64'")).toBe(true)

    expect(steps.find((step) => step.name === 'Install Linux runtimes')?.run).toBe(
      'pnpm run installRuntime:linux:${{ inputs.arch }}'
    )
    expect(steps.find((step) => step.name === 'Bundle Feishu plugin')?.if).toBeUndefined()

    const ocrSmoke = steps.find((step) => step.name === 'Verify packaged Light OCR offline')
    expect(ocrSmoke?.if).toBeUndefined()
    expect(ocrSmoke?.run).toContain('--expect-supported')
    expect(ocrSmoke?.run).toContain('dist/${UNPACKED_DIRECTORY}/resources')
    expect(
      steps.find((step) => step.name?.includes('OCR is unavailable'))
    ).toBeUndefined()

    const installerSize = steps.find((step) => step.name === 'Compare installer sizes')
    expect(installerSize?.if).toBe('inputs.enforce-installer-size')
    expect(installerSize?.run).toContain('--target "linux-${TARGET_ARCH}"')

    const commands = steps.map((step) => step.run ?? '').join('\n')
    expect(commands).toContain('dist/${UNPACKED_DIRECTORY}/resources')
    expect(commands).not.toContain('dist/linux-unpacked/resources')

    const upload = steps.find((step) => step.name === 'Upload distribution package')
    expect(upload?.with).toMatchObject({
      name: 'deepchat-package-linux-${{ inputs.arch }}',
      path: 'package-output/',
      'if-no-files-found': 'error'
    })
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
    const assembleSteps = workflow.jobs?.assemble?.steps ?? []
    const arm64Download = assembleSteps.find(
      (step) => step.name === 'Download Linux ARM64 package'
    )

    expect(arm64Download?.uses).toMatch(/^actions\/download-artifact@[0-9a-f]{40}$/)
    expect(arm64Download?.with).toEqual({
      name: 'deepchat-package-linux-arm64',
      path: 'artifacts/deepchat-package-linux-arm64',
      'digest-mismatch': 'error'
    })
    expect(
      assembleSteps.find((step) => step.name === 'Assemble fail-closed release assets')?.run
    ).toContain('scripts/ci/assemble-release.mjs')
  })
})
