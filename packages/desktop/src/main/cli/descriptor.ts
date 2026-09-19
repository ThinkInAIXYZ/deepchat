import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  unlink
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  LOCAL_CONTROL_DESCRIPTOR_FILENAME,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_SURFACE_VERSION,
  LocalControlDescriptorSchema,
  type LocalControlDescriptor,
  type LocalControlEndpoint
} from '@shared/contracts/localControl'

const execFileAsync = promisify(execFile)
const MAX_POSIX_SOCKET_PATH_BYTES = 100
const OWNED_TEMP_FILE_PATTERN =
  /^body-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/

export type CliControlLayout = Readonly<{
  controlDirectory: string
  descriptorPath: string
  tempDirectory: string
  endpointDirectory: string
  endpoint: LocalControlEndpoint
}>

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function applyWindowsOwnerAcl(targetPath: string, directory: boolean): Promise<void> {
  const username = os.userInfo().username
  const grant = directory ? `${username}:(OI)(CI)F` : `${username}:F`
  await execFileAsync('icacls.exe', [targetPath, '/inheritance:r', '/grant:r', grant], {
    windowsHide: true,
    timeout: 5_000
  })
}

async function preparePrivatePosixDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const directoryStat = await lstat(directory)
  if (!directoryStat.isDirectory()) throw new Error('Local-control path is not a directory')
  if (typeof process.getuid === 'function' && directoryStat.uid !== process.getuid()) {
    throw new Error('Local-control directory is not owned by the current user')
  }
  await chmod(directory, 0o700)
  const protectedStat = await lstat(directory)
  if ((protectedStat.mode & 0o077) !== 0) {
    throw new Error('Local-control directory permissions are not private')
  }
}

function createFallbackSocketPath(userDataPath: string): string {
  const profileIdentity = createHash('sha256')
    .update(path.resolve(userDataPath))
    .digest('hex')
    .slice(0, 16)
  const ownerIdentity =
    typeof process.getuid === 'function'
      ? String(process.getuid())
      : createHash('sha256').update(os.userInfo().username).digest('hex').slice(0, 8)
  const directoryName = `deepchat-${ownerIdentity}-${profileIdentity}`
  const bases = [process.env.XDG_RUNTIME_DIR, os.tmpdir(), '/tmp']

  for (const base of bases) {
    if (!base || !path.isAbsolute(base)) continue
    const candidate = path.join(base, directoryName, 'control.sock')
    if (Buffer.byteLength(candidate) <= MAX_POSIX_SOCKET_PATH_BYTES) return candidate
  }
  throw new Error('No private path is short enough for the DeepChat Unix socket')
}

export function createLocalControlLayout(
  userDataPath: string,
  platform: NodeJS.Platform = process.platform
): CliControlLayout {
  const controlDirectory = path.join(userDataPath, 'local-control')
  const descriptorPath = path.join(controlDirectory, LOCAL_CONTROL_DESCRIPTOR_FILENAME)
  const tempDirectory = path.join(controlDirectory, 'tmp')

  if (platform === 'win32') {
    const identity = createHash('sha256')
      .update(path.resolve(userDataPath))
      .digest('hex')
      .slice(0, 16)
    return {
      controlDirectory,
      descriptorPath,
      tempDirectory,
      endpointDirectory: controlDirectory,
      endpoint: {
        kind: 'pipe',
        name: `\\\\.\\pipe\\deepchat-${identity}-${randomUUID()}`
      }
    }
  }

  const preferredSocketPath = path.join(controlDirectory, 'control.sock')
  const socketPath =
    Buffer.byteLength(preferredSocketPath) <= MAX_POSIX_SOCKET_PATH_BYTES
      ? preferredSocketPath
      : createFallbackSocketPath(userDataPath)
  return {
    controlDirectory,
    descriptorPath,
    tempDirectory,
    endpointDirectory: path.dirname(socketPath),
    endpoint: { kind: 'unix', path: socketPath }
  }
}

export async function prepareLocalControlLayout(
  layout: CliControlLayout,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  if (platform === 'win32') {
    await mkdir(layout.controlDirectory, { recursive: true, mode: 0o700 })
    await mkdir(layout.tempDirectory, { recursive: true, mode: 0o700 })
    await applyWindowsOwnerAcl(layout.controlDirectory, true)
    await applyWindowsOwnerAcl(layout.tempDirectory, true)
  } else {
    await preparePrivatePosixDirectory(layout.controlDirectory)
    await preparePrivatePosixDirectory(layout.tempDirectory)
    if (layout.endpointDirectory !== layout.controlDirectory) {
      await preparePrivatePosixDirectory(layout.endpointDirectory)
    }
  }

  for (const entry of await readdir(layout.tempDirectory, { withFileTypes: true })) {
    if (OWNED_TEMP_FILE_PATTERN.test(entry.name) && (entry.isFile() || entry.isSymbolicLink())) {
      await unlink(path.join(layout.tempDirectory, entry.name))
    }
  }

  if (layout.endpoint.kind === 'unix') {
    try {
      const socketStat = await lstat(layout.endpoint.path)
      if (!socketStat.isSocket()) {
        throw new Error('Refusing to replace a non-socket local-control endpoint')
      }
      await unlink(layout.endpoint.path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  await removeIfPresent(layout.descriptorPath)
}

export function createLocalControlToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function writeLocalControlDescriptor(
  layout: CliControlLayout,
  input: {
    appVersion: string
    endpoint: LocalControlEndpoint
    pid: number
    token: string
    startedAt: number
  },
  platform: NodeJS.Platform = process.platform
): Promise<LocalControlDescriptor> {
  const descriptor = LocalControlDescriptorSchema.parse({
    protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
    surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
    ...input
  })
  const tempPath = path.join(layout.controlDirectory, `.descriptor-${randomUUID()}.tmp`)
  const handle = await open(tempPath, 'wx', 0o600)
  try {
    try {
      await handle.writeFile(`${JSON.stringify(descriptor)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (platform === 'win32') await applyWindowsOwnerAcl(tempPath, false)
    else await chmod(tempPath, 0o600)
    await rename(tempPath, layout.descriptorPath)
    if (platform === 'win32') await applyWindowsOwnerAcl(layout.descriptorPath, false)
    else await chmod(layout.descriptorPath, 0o600)
    return descriptor
  } catch (error) {
    await removeIfPresent(tempPath).catch(() => undefined)
    throw error
  }
}

export async function protectUnixSocket(socketPath: string): Promise<void> {
  await chmod(socketPath, 0o600)
  const socketStat = await lstat(socketPath)
  if (!socketStat.isSocket()) throw new Error('Local-control endpoint is not a Unix socket')
  if (typeof process.getuid === 'function' && socketStat.uid !== process.getuid()) {
    throw new Error('Local-control socket is not owned by the current user')
  }
  if ((socketStat.mode & 0o077) !== 0) {
    throw new Error('Local-control socket permissions are not private')
  }
}

export async function cleanupLocalControlLayout(
  layout: CliControlLayout,
  token: string
): Promise<void> {
  let endpointBelongsToCaller = true
  try {
    const raw = await readFile(layout.descriptorPath, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      parsed = null
    }
    const current = LocalControlDescriptorSchema.safeParse(parsed)
    if (current.success && current.data.token === token) {
      await removeIfPresent(layout.descriptorPath)
    } else if (current.success) {
      endpointBelongsToCaller = false
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  if (!endpointBelongsToCaller || layout.endpoint.kind !== 'unix') return
  try {
    const socketStat = await lstat(layout.endpoint.path)
    if (socketStat.isSocket()) await unlink(layout.endpoint.path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (layout.endpointDirectory !== layout.controlDirectory) {
    try {
      await rmdir(layout.endpointDirectory)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY') throw error
    }
  }
}
