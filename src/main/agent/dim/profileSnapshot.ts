import { constants, createReadStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

export interface DimProfileIdentity {
  sourceRevision: string
  bridgeVersion: string
  storeFormat: number
}
export interface DimProfileManifest extends DimProfileIdentity {
  version: 1
  sourceHome?: string
  files: Array<{ path: string; size: number; sha256: string; mode: number }>
}
export interface DimProfileSnapshot {
  directory: string
  manifest(): Promise<DimProfileManifest>
  dispose(): Promise<void>
}

const transient = (value: string) =>
  value === 'deepchat-plugin-rows.json' ||
  value === 'rust/deepchat-payloads' ||
  value.startsWith('rust/deepchat-payloads/')

function relativeFile(value: string): void {
  if (
    !value ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.includes(':') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid native profile path')
}

async function filesAt(root: string, prefix = '', excludeTransient = false): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    relativeFile(relative)
    if (excludeTransient && transient(relative)) continue
    if (entry.isDirectory()) files.push(...(await filesAt(root, relative, excludeTransient)))
    else if (entry.isFile()) files.push(relative)
    else throw new Error('Native profile contains an unsupported filesystem entry')
  }
  return files.sort()
}

async function digest(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** The caller must hold the supervisor's successful graceful-shutdown barrier. */
export async function captureDimProfile(
  source: string,
  temporaryRoot: string,
  identity: DimProfileIdentity
): Promise<DimProfileSnapshot> {
  const relative = path.relative(path.resolve(source), path.resolve(temporaryRoot))
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
    throw new Error('Native snapshot staging must be outside the profile')
  const directory = await mkdtemp(path.join(temporaryRoot, 'deepchat-dim-snapshot-'))
  const dispose = () => rm(directory, { recursive: true, force: true })
  try {
    let exists = true
    try {
      const root = await lstat(source)
      if (!root.isDirectory() || root.isSymbolicLink())
        throw new Error('Invalid native profile root')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      exists = false
    }
    const sourceHome = exists ? await realpath(source) : path.resolve(source)
    const files = exists ? await filesAt(source, '', true) : []
    for (const relative of files) {
      const input = path.join(source, relative)
      const output = path.join(directory, relative)
      await mkdir(path.dirname(output), { recursive: true, mode: 0o700 })
      await copyFile(input, output, constants.COPYFILE_FICLONE)
      const info = await lstat(input)
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error('Native profile changed during capture')
      // Preserve native immutable files (0400) and executable bits without widening access.
      await chmod(output, 0o400 | (info.mode & 0o300))
    }
    return {
      directory,
      dispose,
      // Hash the immutable clone after releasing the native host, using bounded buffers.
      manifest: async () => {
        const entries: DimProfileManifest['files'] = []
        for (const relative of files) {
          const file = path.join(directory, relative)
          const info = await lstat(file)
          entries.push({
            path: relative,
            size: info.size,
            sha256: await digest(file),
            mode: info.mode & 0o700
          })
        }
        return { ...identity, version: 1, sourceHome, files: entries }
      }
    }
  } catch (error) {
    await dispose()
    throw error
  }
}

/** Validate the complete opaque file closure before any live profile or product SQL is replaced. */
export async function validateDimProfile(
  directory: string,
  value: unknown,
  identity: DimProfileIdentity
): Promise<DimProfileManifest> {
  if (!value || typeof value !== 'object') throw new Error('Invalid native profile manifest')
  const manifest = value as DimProfileManifest
  if (
    manifest.version !== 1 ||
    manifest.sourceRevision !== identity.sourceRevision ||
    manifest.storeFormat !== identity.storeFormat ||
    typeof manifest.bridgeVersion !== 'string' ||
    !Array.isArray(manifest.files)
  )
    throw new Error('Unsupported native profile backup')
  if (
    manifest.sourceHome !== undefined &&
    (typeof manifest.sourceHome !== 'string' ||
      manifest.sourceHome.length > 32768 ||
      manifest.sourceHome.includes('\0') ||
      (!path.posix.isAbsolute(manifest.sourceHome) && !path.win32.isAbsolute(manifest.sourceHome)))
  )
    throw new Error('Invalid native profile source home')
  const root = await lstat(directory)
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Invalid native profile root')
  const actual = await filesAt(directory)
  const expected = new Set<string>()
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string') throw new Error('Invalid native profile file')
    relativeFile(file.path)
    if (
      transient(file.path) ||
      expected.has(file.path) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      ![0o400, 0o500, 0o600, 0o700].includes(file.mode)
    )
      throw new Error('Invalid native profile file')
    expected.add(file.path)
    const location = path.join(directory, file.path)
    const info = await lstat(location)
    if (!info.isFile() || info.size !== file.size || (await digest(location)) !== file.sha256)
      throw new Error('Native profile backup integrity check failed')
  }
  if (actual.length !== expected.size || actual.some((file) => !expected.has(file)))
    throw new Error('Native profile backup contains unlisted files')
  return manifest
}
