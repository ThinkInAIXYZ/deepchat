import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import crossSpawn from 'cross-spawn'
import {
  buildRuntimeInstallPlan,
  loadRuntimeVersions,
  verifyInstalledRuntime
} from './install-runtime.mjs'
import { verifyDimRuntime } from './package-dim-runtime.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function sourceDigest(root) {
  const files = [
    'resources/dim-runtime-lock.json',
    'resources/dim-native-host-lock.json',
    'resources/runtime-versions.json',
    'resources/dim-plugin-runtime/package.json',
    'resources/dim-plugin-runtime/pnpm-lock.yaml',
    'native/dim-host/Cargo.toml',
    'native/dim-host/Cargo.lock',
    'native/dim-host/rust-toolchain.toml',
    'scripts/build-dim-host.mjs',
    'scripts/prepare-dim-source.mjs',
    'scripts/install-dim.mjs',
    'scripts/install-runtime.mjs',
    'scripts/package-dim-runtime.mjs',
    'scripts/dim-native-contract.mjs',
    'scripts/prepare-dev-runtime.mjs'
  ]
  const collect = async (directory) => {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`
      if (entry.isDirectory()) await collect(relative)
      else if (entry.isFile()) files.push(relative)
      else throw new Error(`Unsupported runtime source entry: ${relative}`)
    }
  }
  await collect('native/dim-host/src')
  await collect('plugins/dim')
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash
      .update(file)
      .update('\0')
      .update(await readFile(path.join(root, file)))
      .update('\0')
  }
  return hash.digest('hex')
}

function runCommand(command, args, options) {
  const result = crossSpawn.sync(command, args, { stdio: 'inherit', ...options })
  if (result.error || result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed`, { cause: result.error })
}

/** Prepare build-time dependencies before starting Electron, never during application startup. */
export async function prepareDevRuntime({
  projectDir = repository,
  run = runCommand,
  verify = verifyDimRuntime,
  verifyNode = verifyInstalledRuntime
} = {}) {
  const runtimeRoot = path.join(projectDir, 'runtime')
  const stampFile = path.join(runtimeRoot, 'dim/development.json')
  const inputs = await sourceDigest(projectDir)
  const target = `${process.platform}-${process.arch}`
  const options = { runtimeRoot, projectDir, development: true, originalNode: true }
  let current
  try {
    current = await verify(options)
    const stamp = JSON.parse(await readFile(stampFile, 'utf8'))
    if (
      stamp.target === target &&
      stamp.inputs === inputs &&
      stamp.sha256 === current.manifest.sha256 &&
      stamp.nodeSha256 === current.nodeSha256
    ) {
      console.log(`dim development runtime ready (${target}, cached)`)
      return
    }
  } catch {
    // Missing, outdated or damaged generated assets must be prepared before Electron starts.
  }

  const toolchain = await readFile(
    path.join(projectDir, 'native/dim-host/rust-toolchain.toml'),
    'utf8'
  )
  const rustVersion = toolchain.match(/^channel\s*=\s*"([^"]+)"/m)?.[1]
  if (!rustVersion) throw new Error('Missing pinned dim Rust toolchain')
  const commandOptions = {
    cwd: projectDir,
    env: { ...process.env, RUSTUP_TOOLCHAIN: rustVersion }
  }
  try {
    await run(process.env.CARGO ?? 'cargo', ['--version'], commandOptions)
  } catch (cause) {
    throw new Error(
      `dim development requires Rust ${rustVersion}. Install rustup and run ` +
        `"rustup toolchain install ${rustVersion} --profile minimal", then retry pnpm dev.`,
      { cause }
    )
  }

  const [node] = buildRuntimeInstallPlan({
    types: ['node'],
    rootDir: projectDir,
    versions: loadRuntimeVersions(path.join(projectDir, 'resources/runtime-versions.json'))
  })
  try {
    await verifyNode(node)
  } catch {
    await run(node.command, node.args, commandOptions)
    await verifyNode(node)
  }
  const lock = JSON.parse(
    await readFile(path.join(projectDir, 'resources/dim-runtime-lock.json'), 'utf8')
  )
  let releaseReady = false
  try {
    const manifest = JSON.parse(
      await readFile(
        path.join(
          runtimeRoot,
          'dim/releases',
          `${lock.version}-${target}`,
          'release-manifest.json'
        ),
        'utf8'
      )
    )
    releaseReady = manifest.version === lock.version && manifest.sourceCommit === lock.sourceCommit
  } catch {
    // The verified official release supplies the native host's legal assets as well.
  }
  await run(
    process.execPath,
    ['--use-env-proxy', 'scripts/install-dim.mjs', ...(releaseReady ? ['--plugins-only'] : [])],
    commandOptions
  )
  await run(process.execPath, ['scripts/build-dim-host.mjs', '--dev'], commandOptions)
  current = await verify(options)
  await writeFile(
    stampFile,
    JSON.stringify({
      target,
      inputs,
      sha256: current.manifest.sha256,
      nodeSha256: current.nodeSha256
    }) + '\n'
  )
  console.log(`dim development runtime ready (${target})`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  prepareDevRuntime().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
