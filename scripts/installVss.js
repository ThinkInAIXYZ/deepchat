import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const require = createRequire(import.meta.url)
const duckdbPackage = require('@duckdb/node-api/package.json')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const extensionName = 'vss.duckdb_extension'
export const defaultRepository = 'https://extensions.duckdb.org'
export const defaultDownloadRetries = 3
export const defaultRetryBaseDelayMs = 250
export const defaultRequestTimeoutMs = 15_000
const extensionMetadataFooterBytes = 64 * 1024

export class VssDownloadError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'VssDownloadError'
    this.status = options.status
    this.retryable = options.retryable === true
    this.cause = options.cause
  }
}

export function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (!arg.startsWith('--')) continue
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    let value = inlineValue
    if (value === undefined) {
      const next = argv[index + 1]
      if (next === undefined || next === '--' || next.startsWith('--')) {
        throw new Error(`Missing value for --${rawKey}`)
      }
      value = next
      index += 1
    }
    options[rawKey] = value
  }
  return options
}

export function normalizePlatform(value) {
  switch (value) {
    case 'darwin':
    case 'mac':
    case 'macos':
    case 'osx':
      return 'darwin'
    case 'win32':
    case 'windows':
    case 'win':
      return 'win32'
    case 'linux':
      return 'linux'
    default:
      throw new Error(`Unsupported DuckDB VSS platform: ${value}`)
  }
}

export function normalizeArch(value) {
  switch (value) {
    case 'x64':
    case 'amd64':
      return 'x64'
    case 'arm64':
    case 'aarch64':
      return 'arm64'
    default:
      throw new Error(`Unsupported DuckDB VSS architecture: ${value}`)
  }
}

export function resolveDuckDbVersion(packageVersion) {
  const base = packageVersion.split('-')[0]
  if (!/^\d+\.\d+\.\d+$/.test(base)) {
    throw new Error(`Cannot derive DuckDB extension version from @duckdb/node-api ${packageVersion}`)
  }
  return `v${base}`
}

export function targetTriple(platform, arch) {
  if (platform === 'darwin') return arch === 'arm64' ? 'osx_arm64' : 'osx_amd64'
  if (platform === 'win32') return arch === 'arm64' ? 'windows_arm64' : 'windows_amd64'
  if (platform === 'linux') return arch === 'arm64' ? 'linux_arm64' : 'linux_amd64'
  throw new Error(`Unsupported DuckDB VSS target: ${platform}/${arch}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`Timed out after ${timeoutMs}ms while downloading ${url}`))
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
  })
  try {
    return await Promise.race([fetchImpl(url, { signal: controller.signal }), timeout])
  } finally {
    clearTimeout(timer)
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500
}

function downloadErrorMessage(reason, context) {
  const details = context
    ? `DuckDB ${context.duckdbVersion}, target ${context.triple}, source ${context.url}`
    : `source ${context?.url ?? 'unknown'}`
  return `${reason} while downloading DuckDB VSS extension (${details})`
}

export function validateExtensionMetadata(extension, expected) {
  if (!Buffer.isBuffer(extension) || extension.length === 0) {
    throw new Error('DuckDB VSS extension is empty or invalid')
  }
  const footer = extension
    .subarray(Math.max(0, extension.length - extensionMetadataFooterBytes))
    .toString('latin1')
  const missing = []
  if (!footer.includes('duckdb_signature')) missing.push('duckdb_signature')
  if (!footer.includes(expected.duckdbVersion)) missing.push(expected.duckdbVersion)
  if (!footer.includes(expected.triple)) missing.push(expected.triple)
  if (missing.length > 0) {
    throw new Error(
      `DuckDB VSS extension metadata mismatch for ${expected.duckdbVersion}/${expected.triple}; missing ${missing.join(', ')}`
    )
  }
}

export async function downloadExtension(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleepImpl = options.sleep ?? sleep
  const retries = options.retries ?? defaultDownloadRetries
  const baseDelayMs = options.baseDelayMs ?? defaultRetryBaseDelayMs
  const timeoutMs = options.timeoutMs ?? defaultRequestTimeoutMs
  const onRetry = options.onRetry ?? (() => undefined)
  let lastError = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url, timeoutMs)
      if (!response.ok) {
        const retryable = isRetryableStatus(response.status)
        throw new VssDownloadError(
          downloadErrorMessage(`HTTP ${response.status}`, options.context),
          {
            status: response.status,
            retryable
          }
        )
      }
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      const downloadError =
        error instanceof VssDownloadError
          ? error
          : new VssDownloadError(downloadErrorMessage(String(error), options.context), {
              retryable: true,
              cause: error
            })
      lastError = downloadError
      if (!downloadError.retryable || attempt === retries) throw downloadError
      const delayMs = baseDelayMs * 2 ** attempt
      onRetry({ attempt: attempt + 1, retries, delayMs, error: downloadError })
      await sleepImpl(delayMs)
    }
  }

  throw lastError ?? new Error(downloadErrorMessage('Unknown error', options.context))
}

export async function installVssExtension(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv)
  const platform = normalizePlatform(args.platform ?? process.platform)
  const arch = normalizeArch(args.arch ?? process.arch)
  const duckdbVersion = resolveDuckDbVersion(duckdbPackage.version)
  const triple = targetTriple(platform, arch)
  const repository = String(
    args.repository ?? process.env.DUCKDB_EXTENSION_REPOSITORY ?? defaultRepository
  ).replace(/\/+$/, '')
  const url = `${repository}/${duckdbVersion}/${triple}/${extensionName}.gz`
  const targetDir = path.join(__dirname, '../runtime/duckdb/extensions')
  const targetPath = path.join(targetDir, extensionName)
  const tempPath = `${targetPath}.tmp`

  console.log(
    `[DuckDB VSS] installing ${extensionName} for ${platform}/${arch} (${triple}), DuckDB ${duckdbVersion}`
  )
  console.log(`[DuckDB VSS] source: ${url}`)

  try {
    const compressed = await downloadExtension(url, {
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
      retries: options.retries,
      baseDelayMs: options.baseDelayMs,
      timeoutMs: options.timeoutMs,
      context: { duckdbVersion, triple, url },
      onRetry:
        options.onRetry ??
        ((retry) => {
          console.warn(
            `[DuckDB VSS] retry ${retry.attempt}/${retry.retries} in ${retry.delayMs}ms: ${retry.error.message}`
          )
        })
    })
    const extension = zlib.gunzipSync(compressed)
    validateExtensionMetadata(extension, { duckdbVersion, triple })
    fs.mkdirSync(targetDir, { recursive: true })
    fs.writeFileSync(tempPath, extension)
    fs.renameSync(tempPath, targetPath)
    console.log(`[DuckDB VSS] installed: ${targetPath}`)
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    throw error
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  installVssExtension().catch((error) => {
    console.error('[DuckDB VSS] install failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
