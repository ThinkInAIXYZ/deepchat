import { lstat, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  LOCAL_CONTROL_AGENT_TOKEN_ENV,
  LOCAL_CONTROL_DESCRIPTOR_FILENAME,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_SURFACE_VERSION,
  LocalControlDescriptorSchema,
  LocalControlTokenSchema,
  type LocalControlDescriptor
} from '@shared/contracts/localControl'
import { CLI_EXIT_CODES, CliClientError } from './errors'

const MAX_DESCRIPTOR_BYTES = 64 * 1024
const EXPLICIT_PROFILE_ENV = 'DEEPCHAT_E2E_USER_DATA_DIR'
const MAX_POSIX_SOCKET_PATH_BYTES = 100

export type CliDiscoveryOptions = Readonly<{
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  homeDirectory?: string
  processAlive?: (pid: number) => boolean
}>

function resolveDefaultProfilePath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  homeDirectory: string
): string {
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Application Support', 'DeepChat')
  }
  if (platform === 'win32') {
    return path.join(env.APPDATA ?? path.join(homeDirectory, 'AppData', 'Roaming'), 'DeepChat')
  }
  return path.join(env.XDG_CONFIG_HOME ?? path.join(homeDirectory, '.config'), 'DeepChat')
}

export function resolveCliUserDataPath(options: CliDiscoveryOptions = {}): string {
  const env = options.env ?? process.env
  const explicitPath = env[EXPLICIT_PROFILE_ENV]?.trim()
  if (explicitPath) return path.resolve(explicitPath)
  return resolveDefaultProfilePath(
    env,
    options.platform ?? process.platform,
    options.homeDirectory ?? os.homedir()
  )
}

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM') return true
    if (code === 'ESRCH') return false
    throw error
  }
}

function unavailable(message: string): CliClientError {
  return new CliClientError('unavailable', message, CLI_EXIT_CODES.unavailable, true)
}

export async function loadLocalControlDescriptor(
  options: CliDiscoveryOptions = {}
): Promise<LocalControlDescriptor> {
  const platform = options.platform ?? process.platform
  const descriptorPath = path.join(
    resolveCliUserDataPath(options),
    'local-control',
    LOCAL_CONTROL_DESCRIPTOR_FILENAME
  )

  let descriptorStat
  try {
    descriptorStat = await lstat(descriptorPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw unavailable('DeepChat is not running or its CLI descriptor is unavailable')
    }
    throw unavailable(`Cannot inspect the DeepChat CLI descriptor: ${(error as Error).message}`)
  }
  if (!descriptorStat.isFile() || descriptorStat.isSymbolicLink()) {
    throw unavailable('DeepChat CLI descriptor is not a regular file')
  }
  if (descriptorStat.size <= 0 || descriptorStat.size > MAX_DESCRIPTOR_BYTES) {
    throw unavailable('DeepChat CLI descriptor has an invalid size')
  }
  if (platform !== 'win32') {
    if (typeof process.getuid === 'function' && descriptorStat.uid !== process.getuid()) {
      throw unavailable('DeepChat CLI descriptor is owned by another user')
    }
    if ((descriptorStat.mode & 0o077) !== 0) {
      throw unavailable('DeepChat CLI descriptor permissions are not private')
    }
  }

  let serialized: string
  try {
    serialized = await readFile(descriptorPath, 'utf8')
  } catch (error) {
    throw unavailable(`Cannot read the DeepChat CLI descriptor: ${(error as Error).message}`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(serialized) as unknown
  } catch {
    throw unavailable('DeepChat CLI descriptor is not valid JSON')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw unavailable('DeepChat CLI descriptor has an invalid shape')
  }
  const versioned = raw as Record<string, unknown>
  if (
    typeof versioned.protocolVersion !== 'number' ||
    typeof versioned.surfaceVersion !== 'number'
  ) {
    throw unavailable('DeepChat CLI descriptor has no valid protocol version')
  }
  if (
    versioned.protocolVersion !== LOCAL_CONTROL_PROTOCOL_VERSION ||
    versioned.surfaceVersion !== LOCAL_CONTROL_SURFACE_VERSION
  ) {
    throw new CliClientError(
      'unsupported_version',
      `CLI requires protocol ${LOCAL_CONTROL_PROTOCOL_VERSION} and surface ${LOCAL_CONTROL_SURFACE_VERSION}; descriptor has protocol ${versioned.protocolVersion} and surface ${versioned.surfaceVersion}`,
      CLI_EXIT_CODES.unavailable
    )
  }

  const parsed = LocalControlDescriptorSchema.safeParse(raw)
  if (!parsed.success) throw unavailable('DeepChat CLI descriptor failed validation')
  const descriptor = parsed.data
  if (!(options.processAlive ?? defaultProcessAlive)(descriptor.pid)) {
    throw unavailable('DeepChat CLI descriptor points to a stopped process')
  }

  if (platform === 'win32') {
    if (
      descriptor.endpoint.kind !== 'pipe' ||
      !descriptor.endpoint.name.startsWith('\\\\.\\pipe\\')
    ) {
      throw unavailable('DeepChat CLI descriptor does not contain a local named pipe')
    }
  } else {
    if (
      descriptor.endpoint.kind !== 'unix' ||
      !path.isAbsolute(descriptor.endpoint.path) ||
      Buffer.byteLength(descriptor.endpoint.path) > MAX_POSIX_SOCKET_PATH_BYTES
    ) {
      throw unavailable('DeepChat CLI descriptor does not contain a valid Unix socket')
    }
    try {
      const socketStat = await lstat(descriptor.endpoint.path)
      if (!socketStat.isSocket()) throw unavailable('DeepChat CLI endpoint is not a Unix socket')
      if (typeof process.getuid === 'function' && socketStat.uid !== process.getuid()) {
        throw unavailable('DeepChat CLI endpoint is owned by another user')
      }
      if ((socketStat.mode & 0o077) !== 0) {
        throw unavailable('DeepChat CLI endpoint permissions are not private')
      }
    } catch (error) {
      if (error instanceof CliClientError) throw error
      throw unavailable('DeepChat CLI Unix socket is unavailable')
    }
  }
  return descriptor
}

export function selectLocalControlToken(
  descriptor: LocalControlDescriptor,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (Object.prototype.hasOwnProperty.call(env, LOCAL_CONTROL_AGENT_TOKEN_ENV)) {
    const token = LocalControlTokenSchema.safeParse(env[LOCAL_CONTROL_AGENT_TOKEN_ENV])
    if (!token.success) {
      throw new CliClientError(
        'authentication_failed',
        `${LOCAL_CONTROL_AGENT_TOKEN_ENV} is present but invalid; refusing human-token fallback`,
        CLI_EXIT_CODES.authorization
      )
    }
    return token.data
  }
  return descriptor.token
}
