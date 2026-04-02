import { spawn } from 'child_process'
import { app } from 'electron'
import * as path from 'path'
import { RuntimeHelper } from '../runtimeHelper'

const runtimeHelper = RuntimeHelper.getInstance()

const PATH_ENV_KEYS = ['PATH', 'Path', 'path'] as const
const NODE_ENV_KEYS = [
  'NVM_DIR',
  'NVM_CD_FLAGS',
  'NVM_BIN',
  'NODE_PATH',
  'NODE_VERSION',
  'FNM_DIR',
  'VOLTA_HOME',
  'N_PREFIX'
] as const
const NPM_ENV_KEYS = [
  'npm_config_registry',
  'npm_config_cache',
  'npm_config_prefix',
  'npm_config_tmp',
  'NPM_CONFIG_REGISTRY',
  'NPM_CONFIG_CACHE',
  'NPM_CONFIG_PREFIX',
  'NPM_CONFIG_TMP'
] as const
const RELEVANT_ENV_KEYS = [...PATH_ENV_KEYS, ...NODE_ENV_KEYS, ...NPM_ENV_KEYS] as const

let cachedShellEnv: Record<string, string> | null = null

const TIMEOUT_MS = 8000

function getPathSeparator(): string {
  return process.platform === 'win32' ? ';' : ':'
}

function getPrimaryPathKey(): 'PATH' | 'Path' {
  return process.platform === 'win32' ? 'Path' : 'PATH'
}

function toStringEnvEntries(
  input: NodeJS.ProcessEnv | Record<string, string> | undefined
): Record<string, string> {
  if (!input) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

function pickRelevantEnvironment(
  input: NodeJS.ProcessEnv | Record<string, string> | undefined
): Record<string, string> {
  const env = toStringEnvEntries(input)
  const filtered: Record<string, string> = {}

  for (const key of RELEVANT_ENV_KEYS) {
    const value = env[key]
    if (typeof value === 'string' && value !== '') {
      filtered[key] = value
    }
  }

  return filtered
}

function getDefaultPathEntries(): string[] {
  try {
    return runtimeHelper.getDefaultPaths(app.getPath('home'))
  } catch {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ''
    return homeDir ? runtimeHelper.getDefaultPaths(homeDir) : []
  }
}

export function getPathEntriesFromEnv(
  input: NodeJS.ProcessEnv | Record<string, string> | undefined
): string[] {
  const env = toStringEnvEntries(input)
  const separator = getPathSeparator()
  const entries: string[] = []

  for (const key of PATH_ENV_KEYS) {
    const value = env[key]
    if (typeof value !== 'string' || value.length === 0) {
      continue
    }
    entries.push(...value.split(separator))
  }

  return entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
}

export function mergePathEntries(
  pathSources: Array<string | string[] | null | undefined>,
  options: {
    includeDefaultPaths?: boolean
    defaultPaths?: string[]
  } = {}
): { key: 'PATH' | 'Path'; value: string; entries: string[] } {
  const entries: string[] = []
  const separator = getPathSeparator()
  const includeDefaultPaths = options.includeDefaultPaths !== false

  for (const source of pathSources) {
    if (!source) {
      continue
    }

    if (Array.isArray(source)) {
      entries.push(...source)
      continue
    }

    entries.push(...source.split(separator))
  }

  if (includeDefaultPaths) {
    entries.push(...(options.defaultPaths ?? getDefaultPathEntries()))
  }

  const seen = new Set<string>()
  const deduped = entries
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => {
      const normalized = process.platform === 'win32' ? entry.toLowerCase() : entry
      if (seen.has(normalized)) {
        return false
      }
      seen.add(normalized)
      return true
    })

  return {
    key: getPrimaryPathKey(),
    value: deduped.join(separator),
    entries: deduped
  }
}

export function setPathEntriesOnEnv(
  env: Record<string, string>,
  pathSources: Array<string | string[] | null | undefined>,
  options: {
    includeDefaultPaths?: boolean
    defaultPaths?: string[]
  } = {}
): Record<string, string> {
  const normalized = mergePathEntries(pathSources, options)

  delete env.PATH
  delete env.Path
  delete env.path

  if (normalized.value.length > 0) {
    env[normalized.key] = normalized.value
    if (process.platform === 'win32') {
      env.PATH = normalized.value
      env.Path = normalized.value
    }
  }

  return env
}

export function mergeCommandEnvironment(
  options: {
    processEnv?: NodeJS.ProcessEnv | Record<string, string>
    shellEnv?: Record<string, string>
    overrides?: Record<string, string>
    prependPathSources?: Array<string | string[] | null | undefined>
    includeDefaultPaths?: boolean
  } = {}
): Record<string, string> {
  const processEnv = toStringEnvEntries(options.processEnv ?? process.env)
  const shellEnv = pickRelevantEnvironment(options.shellEnv)
  const overrides = toStringEnvEntries(options.overrides)
  const env: Record<string, string> = {
    ...processEnv,
    ...shellEnv
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (PATH_ENV_KEYS.includes(key as (typeof PATH_ENV_KEYS)[number])) {
      continue
    }
    env[key] = value
  }

  setPathEntriesOnEnv(
    env,
    [
      ...(options.prependPathSources ?? []),
      getPathEntriesFromEnv(overrides),
      getPathEntriesFromEnv(shellEnv),
      getPathEntriesFromEnv(processEnv)
    ],
    {
      includeDefaultPaths: options.includeDefaultPaths
    }
  )

  return env
}

function getShellBootstrapMarkers() {
  const suffix = `${process.pid}_${Date.now().toString(36)}`
  return {
    start: `__DEEPCHAT_SHELL_ENV_START_${suffix}__`,
    end: `__DEEPCHAT_SHELL_ENV_END_${suffix}__`
  }
}

function buildShellBootstrapCommand(startMarker: string, endMarker: string): string {
  return `printf '%s\\n' '${startMarker}'; env; printf '%s\\n' '${endMarker}'`
}

function parseShellBootstrapOutput(output: string, startMarker: string, endMarker: string) {
  const lines = output.split(/\r?\n/)
  const startIndex = lines.findIndex((line) => line.trim() === startMarker)
  const endIndex = lines.findIndex((line, index) => index > startIndex && line.trim() === endMarker)

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error('Missing shell environment markers in bootstrap output')
  }

  const env: Record<string, string> = {}
  for (const line of lines.slice(startIndex + 1, endIndex)) {
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (key.length > 0) {
      env[key] = value
    }
  }

  return env
}

function getShellBootstrapArgs(shellPath: string, command: string): string[] {
  const shellName = path.basename(shellPath).toLowerCase()

  if (shellName.includes('fish') || shellName.includes('zsh') || shellName.includes('bash')) {
    return ['-l', '-i', '-c', command]
  }

  return ['-l', '-c', command]
}

export function getUserShell(): { shell: string; args: string[] } {
  const platform = process.platform

  if (platform === 'win32') {
    const powershell = process.env.PSModulePath ? 'powershell.exe' : null
    if (powershell) {
      return { shell: powershell, args: ['-NoProfile', '-Command'] }
    }
    return { shell: 'cmd.exe', args: ['/c'] }
  }

  const fallbackShell =
    platform === 'darwin' ? '/bin/zsh' : platform === 'linux' ? '/bin/bash' : '/bin/sh'
  const shell = process.env.SHELL || fallbackShell

  return { shell, args: ['-c'] }
}

export async function resolveShellBootstrapEnv(): Promise<Record<string, string>> {
  if (process.platform === 'win32') {
    return pickRelevantEnvironment(process.env)
  }

  const { shell } = getUserShell()
  const { start, end } = getShellBootstrapMarkers()
  const envCommand = buildShellBootstrapCommand(start, end)
  const args = getShellBootstrapArgs(shell, envCommand)

  return await new Promise<Record<string, string>>((resolve, reject) => {
    const child = spawn(shell, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TERM: process.env.TERM || 'dumb'
      }
    })

    let stdout = ''
    let stderr = ''
    let timeoutId: NodeJS.Timeout | null = null

    timeoutId = setTimeout(() => {
      child.kill()
      reject(new Error(`Shell environment command timed out after ${TIMEOUT_MS}ms`))
    }, TIMEOUT_MS)

    child.stdout?.on('data', (data: Buffer | string) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data: Buffer | string) => {
      stderr += data.toString()
    })

    child.on('error', (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      reject(error)
    })

    child.on('exit', (code, signal) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (code !== 0 && signal === null) {
        reject(
          new Error(
            `Shell environment command exited with code ${code}, stderr: ${stderr.substring(0, 200)}`
          )
        )
        return
      }

      if (signal) {
        reject(new Error(`Shell environment command killed by signal: ${signal}`))
        return
      }

      resolve(parseShellBootstrapOutput(stdout, start, end))
    })
  })
}

function normalizeShellEnvironment(
  shellBootstrapEnv: Record<string, string>,
  processEnv: NodeJS.ProcessEnv | Record<string, string> = process.env
): Record<string, string> {
  const processRelevantEnv = pickRelevantEnvironment(processEnv)
  const shellRelevantEnv = pickRelevantEnvironment(shellBootstrapEnv)
  const merged: Record<string, string> = {
    ...processRelevantEnv,
    ...shellRelevantEnv
  }

  setPathEntriesOnEnv(merged, [
    getPathEntriesFromEnv(shellRelevantEnv),
    getPathEntriesFromEnv(processRelevantEnv)
  ])

  return merged
}

export async function getShellEnvironment(): Promise<Record<string, string>> {
  if (cachedShellEnv !== null) {
    console.log('[ACP] Using cached shell environment variables')
    return cachedShellEnv
  }

  console.log('[ACP] Fetching shell environment variables (this may take a moment)...')

  try {
    const shellEnv = await resolveShellBootstrapEnv()
    const normalizedEnv = normalizeShellEnvironment(shellEnv)

    cachedShellEnv = normalizedEnv

    console.log('[ACP] Shell environment variables fetched and cached:', {
      pathLength: normalizedEnv.PATH?.length || normalizedEnv.Path?.length || 0,
      hasNvm: !!normalizedEnv.NVM_DIR,
      hasFnm: !!normalizedEnv.FNM_DIR,
      hasVolta: !!normalizedEnv.VOLTA_HOME,
      hasN: !!normalizedEnv.N_PREFIX,
      envVarCount: Object.keys(normalizedEnv).length
    })

    return normalizedEnv
  } catch (error) {
    console.warn('[ACP] Failed to get shell environment variables:', error)
    return normalizeShellEnvironment(toStringEnvEntries(process.env), process.env)
  }
}

export function clearShellEnvironmentCache(): void {
  cachedShellEnv = null
  console.log('[ACP] Shell environment cache cleared')
}
