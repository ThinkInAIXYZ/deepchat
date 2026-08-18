import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import crossSpawn from 'cross-spawn'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = path.resolve(scriptDir, '..')
export const runtimeVersionsPath = path.join(repositoryRoot, 'resources', 'runtime-versions.json')

const supportedPlatforms = new Set(['darwin', 'linux', 'win32'])
const supportedArchitectures = new Set(['arm64', 'x64'])
const supportedRuntimeTypes = new Set(['node', 'rtk', 'uv'])
const supportedToolchainManifestSchemas = new Set([2, 3])
const sha256Pattern = /^[a-f0-9]{64}$/

export function loadRuntimeVersions(manifestPath = runtimeVersionsPath) {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const requiredKeys = ['tinyRuntimeInjector', 'node', 'uv', 'rtk']

  if (!supportedToolchainManifestSchemas.has(parsed.schemaVersion)) {
    throw new Error(`Unsupported runtime version manifest schema: ${parsed.schemaVersion}`)
  }
  for (const key of requiredKeys) {
    if (typeof parsed[key] !== 'string' || parsed[key].trim() === '') {
      throw new Error(`Runtime version manifest is missing a valid ${key} value`)
    }
  }
  if (!parsed.nodeArtifacts || typeof parsed.nodeArtifacts !== 'object') {
    throw new Error('Runtime version manifest is missing Node artifact integrity metadata')
  }
  const nodeArtifacts = {}
  for (const platform of supportedPlatforms) {
    for (const arch of supportedArchitectures) {
      const target = `${platform}-${arch}`
      const artifact = parsed.nodeArtifacts[target]
      if (
        !artifact ||
        !sha256Pattern.test(artifact.executableSha256)
      ) {
        throw new Error(`Runtime version manifest has invalid Node integrity metadata for ${target}`)
      }
      nodeArtifacts[target] = Object.freeze({
        executableSha256: artifact.executableSha256
      })
    }
  }

  return Object.freeze({
    tinyRuntimeInjector: parsed.tinyRuntimeInjector,
    node: parsed.node,
    uv: parsed.uv,
    rtk: parsed.rtk,
    nodeArtifacts: Object.freeze(nodeArtifacts)
  })
}

export function parseRuntimeInstallArgs(argv) {
  const options = { dryRun: false }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (
      argument === '--platform' ||
      argument === '--arch' ||
      argument === '--types' ||
      argument === '--root-dir'
    ) {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}`)
      }
      const key = argument.slice(2)
      options[key] = key === 'types' ? parseRuntimeTypes(value) : value
      index += 1
      continue
    }
    if (
      argument.startsWith('--platform=') ||
      argument.startsWith('--arch=') ||
      argument.startsWith('--types=') ||
      argument.startsWith('--root-dir=')
    ) {
      const [key, value] = argument.slice(2).split('=', 2)
      if (!value) throw new Error(`Missing value for --${key}`)
      options[key] = key === 'types' ? parseRuntimeTypes(value) : value
      continue
    }
    throw new Error(`Unknown runtime installer argument: ${argument}`)
  }

  return options
}

function parseRuntimeTypes(value) {
  const types = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
  if (types.length === 0 || types.some((type) => !supportedRuntimeTypes.has(type))) {
    throw new Error(`Unsupported runtime type selection: ${value}`)
  }
  return types
}

function validateTarget(platform, arch) {
  if (!supportedPlatforms.has(platform)) {
    throw new Error(`Unsupported runtime platform: ${platform}`)
  }
  if (!supportedArchitectures.has(arch)) {
    throw new Error(`Unsupported runtime architecture: ${arch}`)
  }
}

export function buildRuntimeInstallPlan({
  platform = process.platform,
  arch = process.arch,
  rootDir = repositoryRoot,
  versions = loadRuntimeVersions(),
  types
} = {}) {
  validateTarget(platform, arch)

  let runtimes = [
    { type: 'uv', version: versions.uv },
    { type: 'node', version: versions.node }
  ]
  if (!(platform === 'win32' && arch === 'arm64')) {
    runtimes.push({ type: 'rtk', version: versions.rtk })
  }

  runtimes = types
    ? runtimes.filter(({ type }) => types.includes(type))
    : runtimes.filter(({ type }) => type !== 'node')
  if (runtimes.length === 0) {
    throw new Error(`No selected runtimes are available for ${platform}-${arch}`)
  }

  return runtimes.map(({ type, version }) => ({
    command: 'pnpm',
    args: [
      'dlx',
      `tiny-runtime-injector@${versions.tinyRuntimeInjector}`,
      '--type',
      type,
      '--dir',
      path.join(rootDir, 'runtime', type),
      '--runtime-version',
      version,
      '--arch',
      arch,
      '--platform',
      platform
    ],
    type,
    version,
    platform,
    arch,
    ...(type === 'node'
      ? {
          executablePath: path.join(
            rootDir,
            'runtime',
            'node',
            ...(platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
          ),
          expectedExecutableSha256: versions.nodeArtifacts[`${platform}-${arch}`]
            .executableSha256
        }
      : {})
  }))
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolve)
  })
  return hash.digest('hex')
}

export async function verifyInstalledRuntime(step, spawn = crossSpawn.sync) {
  if (step.type !== 'node') return
  const actualHash = await sha256File(step.executablePath)
  if (actualHash !== step.expectedExecutableSha256) {
    throw new Error(
      `node runtime executable checksum mismatch: ${actualHash} != ${step.expectedExecutableSha256}`
    )
  }

  const nodeRoot =
    step.platform === 'win32'
      ? path.dirname(step.executablePath)
      : path.dirname(path.dirname(step.executablePath))
  const companions =
    step.platform === 'win32'
      ? [
          path.join(nodeRoot, 'npm.cmd'),
          path.join(nodeRoot, 'npx.cmd'),
          path.join(nodeRoot, 'corepack.cmd')
        ]
      : [
          path.join(nodeRoot, 'bin', 'npm'),
          path.join(nodeRoot, 'bin', 'npx'),
          path.join(nodeRoot, 'bin', 'corepack')
        ]
  for (const companion of companions) {
    try {
      if (!statSync(companion).isFile()) {
        throw new Error(`node runtime is missing ${path.basename(companion)}`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('node runtime is missing')) throw error
      throw new Error(`node runtime is missing ${path.basename(companion)}`, { cause: error })
    }
  }

  if (step.platform !== process.platform || step.arch !== process.arch) return

  const versionResult = spawn(step.executablePath, ['--version'], {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true
  })
  if (versionResult.error || versionResult.status !== 0) {
    throw new Error('Installed node runtime could not report its version', {
      cause: versionResult.error
    })
  }
  if (String(versionResult.stdout).trim() !== step.version) {
    throw new Error(
      `Installed node runtime version mismatch: ${String(versionResult.stdout).trim()} != ${step.version}`
    )
  }
}

export async function runRuntimeInstallPlan(
  plan,
  spawn = crossSpawn.sync,
  verify = verifyInstalledRuntime
) {
  for (const step of plan) {
    const result = spawn(step.command, step.args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'inherit'
    })
    if (result.error) {
      throw new Error(`Failed to start ${step.type} runtime installer`, { cause: result.error })
    }
    if (result.status !== 0) {
      const termination = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`
      throw new Error(`${step.type} runtime installation failed with ${termination}`)
    }
    await verify(step)
  }
}

function formatDryRunStep(step) {
  return [step.command, ...step.args].map((part) => JSON.stringify(part)).join(' ')
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseRuntimeInstallArgs(argv)
  const plan = buildRuntimeInstallPlan({
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
    types: options.types,
    rootDir: options['root-dir'] ? path.resolve(options['root-dir']) : repositoryRoot
  })

  if (options.dryRun) {
    for (const step of plan) console.log(formatDryRunStep(step))
    return
  }

  await runRuntimeInstallPlan(plan)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
