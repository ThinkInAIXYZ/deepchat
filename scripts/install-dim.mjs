import { createHash } from 'node:crypto'
import crossSpawn from 'cross-spawn'
import { createReadStream } from 'node:fs'
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'

const root = fileURLToPath(new URL('../', import.meta.url))
export const dimLockPath = path.join(root, 'resources/dim-runtime-lock.json')

export function loadDimLock(filename = dimLockPath) {
  return readFile(filename, 'utf8').then((text) => {
    const lock = JSON.parse(text)
    if (
      lock.schemaVersion !== 1 ||
      !/^\d+\.\d+\.\d+-alpha\.\d+$/.test(lock.version) ||
      !/^[a-f0-9]{40}$/.test(lock.sourceCommit) ||
      lock.protocolVersion !== 3
    ) {
      throw new Error('Invalid dim runtime lock')
    }
    for (const [target, artifact] of Object.entries(lock.artifacts)) {
      if (
        !/^(darwin|linux|win32)-(arm64|x64)$/.test(target) ||
        !/^[a-f0-9]{64}$/.test(artifact.archiveSha256) ||
        artifact.filename !==
          `${artifact.directory}-${lock.version}.${target.startsWith('win32') ? 'zip' : 'tar.gz'}` ||
        artifact.directory !== `dimcode-${target.replace('win32-', 'windows-')}`
      ) {
        throw new Error(`Invalid dim artifact: ${target}`)
      }
    }
    return lock
  })
}

function run(command, args, options = {}) {
  const result = crossSpawn.sync(command, args, { encoding: 'utf8', windowsHide: true, ...options })
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.stderr || ''}`, {
      cause: result.error
    })
  }
  return String(result.stdout || '').trim()
}

async function rejectLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    const info = await lstat(filename)
    if (
      info.isSymbolicLink() ||
      (!info.isDirectory() && !info.isFile()) ||
      (info.isFile() && info.nlink > 1)
    ) {
      throw new Error(`Unsupported entry in dim archive: ${entry.name}`)
    }
    if (info.isDirectory()) await rejectLinks(filename)
  }
}

export async function installDim({
  platform = process.platform,
  arch = process.arch,
  target = path.join(root, 'runtime/dim')
} = {}) {
  const lock = await loadDimLock()
  const artifact = lock.artifacts[`${platform}-${arch}`]
  if (!artifact) throw new Error(`Unsupported dim platform: ${platform}-${arch}`)
  await mkdir(target, { recursive: true })
  const stage = await mkdtemp(path.join(target, '.install-'))
  try {
    const url = `https://github.com/arcships/dim/releases/download/v${lock.version}/${artifact.filename}`
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
    if (!response.ok || !response.body) throw new Error(`dim download failed: ${response.status}`)
    const hash = createHash('sha256')
    let bytes = 0
    const digest = new Transform({
      transform(chunk, _encoding, done) {
        bytes += chunk.length
        if (bytes > 512 * 1024 * 1024) return done(new Error('dim archive exceeds size limit'))
        hash.update(chunk)
        done(null, chunk)
      }
    })
    const archive = path.join(stage, artifact.filename)
    const { createWriteStream } = await import('node:fs')
    await pipeline(
      Readable.fromWeb(response.body),
      digest,
      createWriteStream(archive, { flags: 'wx', mode: 0o600 })
    )
    if (hash.digest('hex') !== artifact.archiveSha256)
      throw new Error('dim archive checksum mismatch')
    const kinds = run('tar', ['-tvf', archive]).split(/\r?\n/)
    if (kinds.some((line) => !['-', 'd'].includes(line[0])))
      throw new Error('Links or special files in dim archive')
    const entries = run('tar', ['-tf', archive]).split(/\r?\n/)
    for (const entry of entries) {
      const parts = entry.replaceAll('\\', '/').split('/').filter(Boolean)
      if (
        parts[0] !== artifact.directory ||
        parts.some((part) => part === '..' || part.includes(':')) ||
        entry.startsWith('/')
      ) {
        throw new Error('Unsafe path in dim archive')
      }
    }
    run('tar', ['-xf', archive, '-C', stage])
    const extracted = path.join(stage, artifact.directory)
    await rejectLinks(extracted)
    const manifest = JSON.parse(
      await readFile(path.join(extracted, 'release-manifest.json'), 'utf8')
    )
    if (manifest.version !== lock.version || manifest.sourceCommit !== lock.sourceCommit) {
      throw new Error('dim release manifest mismatch')
    }
    const executable = path.join(extracted, 'bin', platform === 'win32' ? 'dimcode.exe' : 'dimcode')
    await chmod(executable, 0o755)
    if (
      platform === process.platform &&
      arch === process.arch &&
      run(executable, ['--version']) !== `dimcode ${lock.version}`
    ) {
      throw new Error('dim executable version mismatch')
    }
    // Versioned installations are immutable; never replace a potentially running host.
    const destination = path.join(target, 'releases', `${lock.version}-${platform}-${arch}`)
    await mkdir(path.dirname(destination), { recursive: true })
    try {
      await rename(extracted, destination)
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error
      const existing = JSON.parse(
        await readFile(path.join(destination, 'release-manifest.json'), 'utf8')
      )
      if (existing.sourceCommit !== lock.sourceCommit || existing.version !== lock.version)
        throw error
      const installed = path.join(destination, 'bin', path.basename(executable))
      const fileHash = async (filename) => {
        const h = createHash('sha256')
        for await (const chunk of createReadStream(filename)) h.update(chunk)
        return h.digest('hex')
      }
      if ((await fileHash(installed)) !== (await fileHash(executable)))
        throw new Error('Existing dim executable is modified')
    }
    console.log(`dim ${lock.version}: ${destination}`)
    return destination
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

export async function installDimPlugins(target = path.join(root, 'runtime/dim/plugins')) {
  // Keep the Node dependency tree outside app.asar for the foreign runtime process.
  await mkdir(target, { recursive: true })
  for (const filename of ['package.json', 'pnpm-lock.yaml']) {
    await cp(path.join(root, 'resources/dim-plugin-runtime', filename), path.join(target, filename))
  }
  run(
    'pnpm',
    [
      '--dir',
      target,
      'install',
      '--prod',
      '--frozen-lockfile',
      '--ignore-workspace',
      '--ignore-scripts',
      '--config.node-linker=hoisted'
    ],
    { stdio: 'inherit' }
  )
  await cp(path.join(root, 'plugins/dim'), path.join(target, 'modules'), { recursive: true })
  await cp(dimLockPath, path.join(target, 'runtime-lock.json'))
  // dim's --js-runtime takes the package directory, not the runner filename.
  const entry = run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'console.log(new URL("./", import.meta.resolve("@arcships/rutis-runtime/package.json")).href)'
    ],
    { cwd: target }
  )
  await writeFile(
    path.join(target, 'runtime-entry.json'),
    JSON.stringify({ relativePath: path.relative(target, fileURLToPath(entry)) }) + '\n'
  )
  return target
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [
    platform = process.platform,
    arch = process.arch,
    target = path.join(root, 'runtime/dim')
  ] = process.argv.slice(2)
  await installDim({ platform, arch, target: path.resolve(target) })
  await installDimPlugins(path.join(path.resolve(target), 'plugins'))
}
