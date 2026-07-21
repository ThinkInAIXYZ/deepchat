import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import crossSpawn from 'cross-spawn'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = path.resolve(scriptDir, '..')
export const runtimeVersionsPath = path.join(repositoryRoot, 'resources', 'runtime-versions.json')

const supportedPlatforms = new Set(['darwin', 'linux', 'win32'])
const supportedArchitectures = new Set(['arm64', 'x64'])

export function loadRuntimeVersions(manifestPath = runtimeVersionsPath) {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const requiredKeys = ['tinyRuntimeInjector', 'node', 'uv', 'rtk']

  if (parsed.schemaVersion !== 1) {
    throw new Error(`Unsupported runtime version manifest schema: ${parsed.schemaVersion}`)
  }
  for (const key of requiredKeys) {
    if (typeof parsed[key] !== 'string' || parsed[key].trim() === '') {
      throw new Error(`Runtime version manifest is missing a valid ${key} value`)
    }
  }

  return Object.freeze({
    tinyRuntimeInjector: parsed.tinyRuntimeInjector,
    node: parsed.node,
    uv: parsed.uv,
    rtk: parsed.rtk
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
    if (argument === '--platform' || argument === '--arch') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}`)
      }
      options[argument.slice(2)] = value
      index += 1
      continue
    }
    if (argument.startsWith('--platform=') || argument.startsWith('--arch=')) {
      const [key, value] = argument.slice(2).split('=', 2)
      if (!value) throw new Error(`Missing value for --${key}`)
      options[key] = value
      continue
    }
    throw new Error(`Unknown runtime installer argument: ${argument}`)
  }

  return options
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
  versions = loadRuntimeVersions()
} = {}) {
  validateTarget(platform, arch)

  const runtimes = [
    { type: 'uv', version: versions.uv },
    { type: 'node', version: versions.node }
  ]
  if (!(platform === 'win32' && arch === 'arm64')) {
    runtimes.push({ type: 'rtk', version: versions.rtk })
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
    version
  }))
}

export function runRuntimeInstallPlan(plan, spawn = crossSpawn.sync) {
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
  }
}

function formatDryRunStep(step) {
  return [step.command, ...step.args].map((part) => JSON.stringify(part)).join(' ')
}

export function main(argv = process.argv.slice(2)) {
  const options = parseRuntimeInstallArgs(argv)
  const plan = buildRuntimeInstallPlan({
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch
  })

  if (options.dryRun) {
    for (const step of plan) console.log(formatDryRunStep(step))
    return
  }

  runRuntimeInstallPlan(plan)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
