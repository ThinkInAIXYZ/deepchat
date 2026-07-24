#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { createGzip, gunzip } from 'node:zlib'

const PROTOCOL_VERSION = 1
const MAX_PROTOCOL_LINE_BYTES = 4 * 1024 * 1024
const DEFAULT_OPERATION_TIMEOUT_MS = 120_000
const DEFAULT_PEAK_RSS_LIMIT_BYTES = 768 * 1024 * 1024
const MAX_ENCODED_OVERHEAD_BYTES = 1024 * 1024
const MIB = 1024 * 1024
const execFileAsync = promisify(execFile)
const gunzipAsync = promisify(gunzip)
const BOOLEAN_ARGS = new Set([
  'expect-supported',
  'expect-unsupported',
  'require-execution',
  'require-peak-rss',
  'skip-compression'
])
const VALUE_ARGS = new Set([
  'arch',
  'backend',
  'max-compressed-mib',
  'max-duration-ms',
  'max-node-compressed-mib',
  'max-other-runtime-compressed-mib',
  'max-peak-rss-mib',
  'platform',
  'project-dir',
  'report-path',
  'resources-path',
  'size-budgets-path'
])

export function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`)

    const [key, inlineValue] = argument.slice(2).split('=', 2)
    if (BOOLEAN_ARGS.has(key)) {
      if (inlineValue !== undefined) throw new Error(`Boolean option --${key} does not take a value`)
      options[key] = true
      continue
    }
    if (!VALUE_ARGS.has(key)) throw new Error(`Unknown Light OCR smoke option: --${key}`)

    let value = inlineValue
    if (value === undefined) {
      value = argv[index + 1]
      if (!value || value === '--' || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`)
      }
      index += 1
    }
    options[key] = value
  }
  return options
}

export function normalizePlatform(value) {
  switch (value) {
    case 'darwin':
    case 'mac':
    case 'macos':
      return 'darwin'
    case 'linux':
      return 'linux'
    case 'win':
    case 'win32':
    case 'windows':
      return 'win32'
    default:
      throw new Error(`Unsupported Light OCR platform: ${value}`)
  }
}

export function normalizeArch(value) {
  switch (value) {
    case 'amd64':
    case 'x64':
      return 'x64'
    case 'aarch64':
    case 'arm64':
      return 'arm64'
    default:
      throw new Error(`Unsupported Light OCR architecture: ${value}`)
  }
}

export function assertSupportExpectation(args, supported) {
  if (args['expect-supported'] && args['expect-unsupported']) {
    throw new Error('--expect-supported and --expect-unsupported are mutually exclusive')
  }
  if (args['require-execution'] && !args['expect-supported']) {
    throw new Error('--require-execution requires --expect-supported')
  }
  if (args['require-peak-rss'] && !args['require-execution']) {
    throw new Error('--require-peak-rss requires --require-execution')
  }
  if (args['expect-supported'] && !supported) {
    throw new Error('Packaged OCR target was expected to be supported')
  }
  if (args['expect-unsupported'] && supported) {
    throw new Error('Packaged OCR target was expected to be unsupported')
  }
}

const INHERITED_HELPER_ENVIRONMENT_KEYS = [
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NUMBER_OF_PROCESSORS',
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'WINDIR'
]

export function createPackagedLightOcrEnvironment(inherited = process.env, nativeRuntimeOverride) {
  const environment = {}
  for (const key of INHERITED_HELPER_ENVIRONMENT_KEYS) {
    if (typeof inherited[key] === 'string') environment[key] = inherited[key]
  }
  environment.DEEPCHAT_LIGHT_OCR_HELPER = '1'
  environment.DEEPCHAT_LIGHT_OCR_OFFLINE_SMOKE = '1'
  if (nativeRuntimeOverride) {
    environment.LIGHT_OCR_NODE_BINARY = nativeRuntimeOverride.nodeBinaryPath
    environment.LIGHT_OCR_RUNTIME_DESCRIPTOR = nativeRuntimeOverride.runtimeDescriptorPath
  }
  return environment
}

function parsePositiveNumber(value, label, fallback) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`)
  }
  return parsed
}

function parseNonNegativeNumber(value, label, fallback) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number`)
  }
  return parsed
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

function resolveContainedPath(rootDir, relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-empty relative path`)
  }
  const resolvedRoot = path.resolve(rootDir)
  const resolvedPath = path.resolve(resolvedRoot, relativePath)
  const relative = path.relative(resolvedRoot, resolvedPath)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the packaged app root`)
  }
  return resolvedPath
}

async function assertPackageIdentity(packageDir, expectedName, expectedVersion) {
  const packageJson = await readJson(path.join(packageDir, 'package.json'))
  if (packageJson.name !== expectedName || packageJson.version !== expectedVersion) {
    throw new Error(`Unexpected packaged OCR identity for ${expectedName}`)
  }
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

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function resolveDarwinAppBundle(resourcesPath) {
  let candidate = path.resolve(resourcesPath)
  const root = path.parse(candidate).root
  while (candidate !== root) {
    if (candidate.endsWith('.app')) return candidate
    candidate = path.dirname(candidate)
  }
  throw new Error('Packaged OCR resources are not inside a macOS application bundle')
}

async function verifyCodesign(pathToVerify, { deep = false } = {}) {
  const args = ['--verify']
  if (deep) args.push('--deep')
  args.push('--strict', '--verbose=2', '-R=anchor apple generic', pathToVerify)
  await execFileAsync('/usr/bin/codesign', args, {
    encoding: 'utf8',
    timeout: 30_000
  })
}

async function readCodeSignatureTeamIdentifier(pathToInspect) {
  const result = await execFileAsync('/usr/bin/codesign', ['-dv', '--verbose=4', pathToInspect], {
    encoding: 'utf8',
    timeout: 30_000
  })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const teamIdentifier = /^TeamIdentifier=(.+)$/m.exec(output)?.[1]?.trim()
  if (!teamIdentifier || teamIdentifier === 'not set') {
    throw new Error('Packaged OCR code signature has no team identifier')
  }
  return teamIdentifier
}

export function createDarwinPackagedCodeSignatureVerifier(resourcesPath) {
  let appIdentityPromise
  return async (filePath) => {
    if (process.platform !== 'darwin') {
      throw new Error('macOS code signatures can only be verified on macOS')
    }
    appIdentityPromise ??= (async () => {
      const appBundlePath = resolveDarwinAppBundle(resourcesPath)
      await verifyCodesign(appBundlePath, { deep: true })
      return await readCodeSignatureTeamIdentifier(appBundlePath)
    })()

    const [fileTeamIdentifier, appTeamIdentifier] = await Promise.all([
      (async () => {
        await verifyCodesign(filePath)
        return await readCodeSignatureTeamIdentifier(filePath)
      })(),
      appIdentityPromise
    ])
    if (fileTeamIdentifier !== appTeamIdentifier) {
      throw new Error('Packaged OCR code signature does not match the application signer')
    }
  }
}

export async function assertPackagedArtifactIntegrity({
  filePath,
  expectedBytes,
  expectedSha256,
  label,
  allowDarwinSignedMutation = false,
  verifySignature
}) {
  const fileStat = await lstat(filePath)
  if (!fileStat.isFile()) throw new Error(`${label} is not a regular file`)

  const actualSha256 = await sha256File(filePath)
  const sizeMatches = expectedBytes === undefined || fileStat.size === expectedBytes
  if (sizeMatches && actualSha256 === expectedSha256) return 'sha256'

  if (allowDarwinSignedMutation) {
    if (typeof verifySignature !== 'function') {
      throw new Error(`${label} changed after packaging but no signature verifier is available`)
    }
    await verifySignature(filePath)
    return 'darwin-code-signature'
  }

  if (!sizeMatches) throw new Error(`${label} size mismatch`)
  throw new Error(`${label} checksum mismatch`)
}

async function verifyModelChecksums(bundlePath) {
  const checksumLines = (await readFile(path.join(bundlePath, 'SHA256SUMS'), 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
  if (checksumLines.length === 0) throw new Error('Packaged OCR model checksum list is empty')

  for (const line of checksumLines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line)
    if (!match) throw new Error('Packaged OCR model checksum list is malformed')
    const filePath = resolveContainedPath(bundlePath, match[2], 'OCR model checksum path')
    if ((await sha256File(filePath)) !== match[1]) {
      throw new Error(`Packaged OCR model checksum mismatch for ${match[2]}`)
    }
  }
}

function isDarwinCodeArtifact(relativePath) {
  const extension = path.extname(relativePath).toLowerCase()
  return extension === '.dylib' || extension === '.node'
}

async function readEncodedNativeArtifact(nativePackageDir, entry) {
  const rawPath = resolveContainedPath(
    nativePackageDir,
    entry.path,
    'OCR raw native artifact path'
  )
  let rawArtifactExists = true
  try {
    await lstat(rawPath)
  } catch (error) {
    if (error?.code === 'ENOENT') rawArtifactExists = false
    else throw error
  }
  if (rawArtifactExists) {
    throw new Error(`Packaged OCR encoded payload still contains raw native code: ${entry.path}`)
  }

  const encodedPath = resolveContainedPath(
    nativePackageDir,
    `${entry.path}.gz.b64`,
    'OCR encoded native artifact path'
  )
  const encodedStat = await lstat(encodedPath)
  const maximumBytes = Math.ceil(((entry.bytes + MAX_ENCODED_OVERHEAD_BYTES) * 4) / 3)
  if (!encodedStat.isFile() || encodedStat.isSymbolicLink() || encodedStat.size > maximumBytes) {
    throw new Error(`Packaged OCR encoded native artifact is invalid: ${entry.path}`)
  }
  const text = await readFile(encodedPath, 'utf8')
  if (!isCanonicalBase64(text)) {
    throw new Error(`Packaged OCR encoded native artifact is not canonical base64: ${entry.path}`)
  }
  const compressed = Buffer.from(text, 'base64')
  let decoded
  try {
    decoded = await gunzipAsync(compressed, { maxOutputLength: entry.bytes })
  } catch (error) {
    throw new Error(`Packaged OCR encoded native artifact cannot be decoded: ${entry.path}`, {
      cause: error
    })
  }
  if (decoded.byteLength !== entry.bytes || sha256Buffer(decoded) !== entry.sha256) {
    throw new Error(`Packaged OCR encoded native artifact integrity mismatch: ${entry.path}`)
  }
  return decoded
}

function isCanonicalBase64(value) {
  if (value.length === 0 || value.length % 4 !== 0) return false
  let padding = 0
  if (value.endsWith('==')) padding = 2
  else if (value.endsWith('=')) padding = 1
  const contentLength = value.length - padding
  for (let index = 0; index < contentLength; index += 1) {
    if (base64Value(value.charCodeAt(index)) < 0) return false
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 0x3d) return false
  }
  if (contentLength === 0) return false
  const finalValue = base64Value(value.charCodeAt(contentLength - 1))
  if (padding === 2 && (finalValue & 0x0f) !== 0) return false
  if (padding === 1 && (finalValue & 0x03) !== 0) return false
  return true
}

function base64Value(code) {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52
  if (code === 0x2b) return 62
  if (code === 0x2f) return 63
  return -1
}

async function verifyNativeChecksums(nativePackageDir, nativePayloadEncoding) {
  const manifest = await readJson(path.join(nativePackageDir, 'artifact-hashes.json'))
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Packaged OCR native checksum list is empty')
  }
  for (const entry of manifest.files) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0 ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error('Packaged OCR native checksum list is malformed')
    }
    const filePath = resolveContainedPath(nativePackageDir, entry.path, 'OCR native checksum path')
    if (nativePayloadEncoding === 'gzip-base64-v1' && isDarwinCodeArtifact(entry.path)) {
      await readEncodedNativeArtifact(nativePackageDir, entry)
      continue
    }
    await assertPackagedArtifactIntegrity({
      filePath,
      expectedBytes: entry.bytes,
      expectedSha256: entry.sha256,
      label: `Packaged OCR native artifact ${entry.path}`
    })
  }
}

async function assertUnsupportedLayout(unpackedRoot) {
  const helperPath = path.join(unpackedRoot, 'out', 'main', 'lightOcrHelper.js')
  try {
    await access(helperPath)
    throw new Error('Unsupported OCR target still contains the helper')
  } catch (error) {
    if (error instanceof Error && error.message.includes('still contains')) throw error
    if (error?.code !== 'ENOENT') throw error
  }

  const scopeDir = path.join(unpackedRoot, 'node_modules', '@arcships')
  let entries = []
  try {
    entries = await readdir(scopeDir)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return
  }
  if (entries.some((entry) => entry === 'light-ocr' || entry.startsWith('light-ocr-'))) {
    throw new Error('Unsupported OCR target still contains Light OCR packages')
  }
}

export async function resolvePackagedOcrLayout({
  resourcesPath,
  platform,
  arch,
  runtimeVersions,
  verifySignature
}) {
  const effectiveSignatureVerifier =
    verifySignature ??
    (platform === 'darwin' ? createDarwinPackagedCodeSignatureVerifier(resourcesPath) : undefined)
  const unpackedRoot = path.join(path.resolve(resourcesPath), 'app.asar.unpacked')
  const manifestPath = path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json')
  const manifest = await readJson(manifestPath)
  const pinned = runtimeVersions.lightOcr
  const expectedNativePackage = pinned.nativePackages[`${platform}-${arch}`] ?? null
  const expectedNodeArtifact = runtimeVersions.nodeArtifacts?.[`${platform}-${arch}`] ?? null

  if (
    manifest.schemaVersion !== 2 ||
    manifest.platform !== platform ||
    manifest.arch !== arch ||
    manifest.lightOcrVersion !== pinned.version ||
    manifest.bundleId !== pinned.bundleId ||
    typeof manifest.supported !== 'boolean'
  ) {
    throw new Error('Packaged OCR runtime manifest does not match the requested target')
  }

  if (!expectedNativePackage) {
    if (manifest.supported || manifest.reason !== 'unsupported_platform') {
      throw new Error('Unsupported OCR target has an invalid availability manifest')
    }
    await assertUnsupportedLayout(unpackedRoot)
    return {
      supported: false,
      unpackedRoot,
      lightOcrVersion: pinned.version,
      bundleId: pinned.bundleId
    }
  }

  if (!manifest.supported || manifest.nativePackage !== expectedNativePackage || !manifest.paths) {
    throw new Error('Supported OCR target has an invalid availability manifest')
  }
  const expectedNativePayloadEncoding = platform === 'darwin' ? 'gzip-base64-v1' : 'direct'
  if (manifest.nativePayloadEncoding !== expectedNativePayloadEncoding) {
    throw new Error('Supported OCR target has an invalid native payload encoding')
  }
  if (
    !expectedNodeArtifact ||
    manifest.nodeVersion !== runtimeVersions.node ||
    manifest.nodeSha256 !== expectedNodeArtifact.executableSha256
  ) {
    throw new Error('Supported OCR target has invalid bundled Node integrity metadata')
  }

  const nodeExecutable = resolveContainedPath(unpackedRoot, manifest.paths.node, 'OCR Node path')
  const helperEntryPath = resolveContainedPath(
    unpackedRoot,
    manifest.paths.helper,
    'OCR helper path'
  )
  const facadeDir = resolveContainedPath(unpackedRoot, manifest.paths.facade, 'OCR facade path')
  const bundlePath = resolveContainedPath(unpackedRoot, manifest.paths.bundle, 'OCR bundle path')
  const nativePackageDir = resolveContainedPath(
    unpackedRoot,
    manifest.paths.native,
    'OCR native path'
  )
  const modelPackageDir = path.dirname(bundlePath)

  await Promise.all([
    access(nodeExecutable),
    access(helperEntryPath),
    access(path.join(facadeDir, 'js', 'index.cjs')),
    access(path.join(nativePackageDir, 'native', 'runtime-descriptor.json'))
  ])
  await assertPackagedArtifactIntegrity({
    filePath: nodeExecutable,
    expectedSha256: expectedNodeArtifact.executableSha256,
    label: 'Packaged OCR bundled Node',
    allowDarwinSignedMutation: platform === 'darwin',
    verifySignature: effectiveSignatureVerifier
  })
  await Promise.all([
    assertPackageIdentity(facadeDir, '@arcships/light-ocr', pinned.version),
    assertPackageIdentity(modelPackageDir, pinned.modelPackage, pinned.version),
    assertPackageIdentity(nativePackageDir, expectedNativePackage, pinned.version)
  ])
  const bundleManifest = await readJson(path.join(bundlePath, 'manifest.json'))
  if (bundleManifest.bundleId !== pinned.bundleId) {
    throw new Error('Packaged OCR model bundle identity does not match the pinned bundle')
  }
  await Promise.all([
    verifyModelChecksums(bundlePath),
    verifyNativeChecksums(nativePackageDir, manifest.nativePayloadEncoding)
  ])

  return {
    supported: true,
    unpackedRoot,
    nodeExecutable,
    helperEntryPath,
    facadeDir,
    modelPackageDir,
    bundlePath,
    nativePackageDir,
    nativePayloadEncoding: manifest.nativePayloadEncoding,
    nativePackage: expectedNativePackage,
    lightOcrVersion: pinned.version,
    bundleId: pinned.bundleId
  }
}

function createProtocolClient(child) {
  let stdoutBuffer = Buffer.alloc(0)
  let stderr = ''
  let terminalError = null
  const messages = []
  const waiters = new Set()

  const rejectWaiters = (error) => {
    terminalError = terminalError ?? error
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout)
      waiter.reject(terminalError)
    }
    waiters.clear()
  }

  const dispatch = (message) => {
    for (const waiter of waiters) {
      if (!waiter.predicate(message)) continue
      waiters.delete(waiter)
      clearTimeout(waiter.timeout)
      waiter.resolve(message)
      return
    }
    messages.push(message)
  }

  child.stdout.on('data', (chunk) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)])
    if (stdoutBuffer.byteLength > MAX_PROTOCOL_LINE_BYTES && !stdoutBuffer.includes(0x0a)) {
      rejectWaiters(new Error('Packaged OCR helper exceeded the protocol line limit'))
      return
    }
    let newlineIndex = stdoutBuffer.indexOf(0x0a)
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.subarray(0, newlineIndex)
      stdoutBuffer = stdoutBuffer.subarray(newlineIndex + 1)
      if (line.byteLength > MAX_PROTOCOL_LINE_BYTES) {
        rejectWaiters(new Error('Packaged OCR helper exceeded the protocol line limit'))
        return
      }
      if (line.byteLength > 0) {
        try {
          dispatch(JSON.parse(line.toString('utf8')))
        } catch {
          rejectWaiters(new Error('Packaged OCR helper emitted invalid protocol output'))
          return
        }
      }
      newlineIndex = stdoutBuffer.indexOf(0x0a)
    }
  })
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 16_384) {
      stderr = `${stderr}${Buffer.from(chunk).toString('utf8')}`.slice(0, 16_384)
    }
  })
  child.once('error', (error) => rejectWaiters(error))
  child.once('exit', (code, signal) => {
    rejectWaiters(
      new Error(
        `Packaged OCR helper exited before completing (${signal ?? `code ${String(code)}`})${stderr ? `: ${stderr.slice(0, 2_048)}` : ''}`
      )
    )
  })

  return {
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    },
    waitFor(predicate, label, timeoutMs) {
      const queuedIndex = messages.findIndex(predicate)
      if (queuedIndex >= 0) return Promise.resolve(messages.splice(queuedIndex, 1)[0])
      if (terminalError) return Promise.reject(terminalError)

      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timeout: setTimeout(() => {
            waiters.delete(waiter)
            reject(new Error(`Timed out waiting for packaged OCR ${label}`))
          }, timeoutMs)
        }
        waiters.add(waiter)
      })
    }
  }
}

function assertResult(message, requestId) {
  if (message?.type === 'error') {
    throw new Error(
      `Packaged OCR helper ${requestId} failed (${String(message.error?.code)}): ${String(message.error?.message)}`
    )
  }
  if (message?.type !== 'result' || message.id !== requestId) {
    throw new Error(`Packaged OCR helper returned an invalid ${requestId} response`)
  }
  return message.data
}

function waitForResponse(client, requestId, timeoutMs) {
  return client.waitFor(
    (message) =>
      (message?.type === 'result' || message?.type === 'error') && message.id === requestId,
    requestId,
    timeoutMs
  )
}

function normalizedRecognitionText(result) {
  if (!result || !Array.isArray(result.lines)) {
    throw new Error('Packaged OCR helper returned an invalid recognition result')
  }
  return result.lines
    .map((line) => (typeof line?.text === 'string' ? line.text : ''))
    .join(' ')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function assertFixtureRecognized(result) {
  const normalized = normalizedRecognitionText(result)
  if (!normalized.includes('DEEPCHAT') || !normalized.includes('2026')) {
    throw new Error('Packaged OCR did not recognize the deterministic smoke fixture')
  }
}

function fixtureSvg() {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="520">
      <rect width="1400" height="520" fill="white" />
      <text x="700" y="210" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif"
        font-size="170" font-weight="700" fill="black">DEEPCHAT</text>
      <text x="700" y="410" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif"
        font-size="135" font-weight="700" fill="black">OCR TEST 2026</text>
    </svg>
  `)
}

async function createFixture(filePath) {
  const sharpModule = await import('sharp')
  await sharpModule.default(fixtureSvg(), { density: 144 }).png().toFile(filePath)
}

async function materializePackagedNativeRuntime(layout, tempRoot) {
  if (layout.nativePayloadEncoding === 'direct') return undefined
  if (layout.nativePayloadEncoding !== 'gzip-base64-v1') {
    throw new Error('Packaged OCR native payload encoding is unsupported')
  }

  const manifest = await readJson(path.join(layout.nativePackageDir, 'artifact-hashes.json'))
  if (!Array.isArray(manifest.files)) {
    throw new Error('Packaged OCR native checksum list is malformed')
  }
  const descriptorEntry = manifest.files.find(
    (entry) => entry?.path === 'native/runtime-descriptor.json'
  )
  const codeEntries = manifest.files.filter(
    (entry) => entry && typeof entry.path === 'string' && isDarwinCodeArtifact(entry.path)
  )
  if (!descriptorEntry || codeEntries.length === 0) {
    throw new Error('Packaged OCR encoded native payload is incomplete')
  }

  const sourceDescriptor = resolveContainedPath(
    layout.nativePackageDir,
    descriptorEntry.path,
    'OCR native descriptor path'
  )
  await assertPackagedArtifactIntegrity({
    filePath: sourceDescriptor,
    expectedBytes: descriptorEntry.bytes,
    expectedSha256: descriptorEntry.sha256,
    label: 'Packaged OCR native runtime descriptor'
  })
  const descriptorBytes = await readFile(sourceDescriptor)
  const descriptor = JSON.parse(descriptorBytes.toString('utf8'))
  const addonPath = descriptor?.addon?.path
  if (
    typeof addonPath !== 'string' ||
    !codeEntries.some((entry) => entry.path === addonPath)
  ) {
    throw new Error('Packaged OCR native runtime descriptor has an invalid addon path')
  }

  const materializedRoot = await mkdtemp(path.join(tempRoot, 'native-runtime-'))
  const destinationDescriptor = resolveContainedPath(
    materializedRoot,
    descriptorEntry.path,
    'materialized OCR native descriptor path'
  )
  await mkdir(path.dirname(destinationDescriptor), { recursive: true, mode: 0o700 })
  await writeFile(destinationDescriptor, descriptorBytes, { flag: 'wx', mode: 0o600 })
  for (const entry of codeEntries) {
    const decoded = await readEncodedNativeArtifact(layout.nativePackageDir, entry)
    const destination = resolveContainedPath(
      materializedRoot,
      entry.path,
      'materialized OCR native artifact path'
    )
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
    await writeFile(destination, decoded, { flag: 'wx', mode: 0o600 })
  }
  return {
    nodeBinaryPath: resolveContainedPath(
      materializedRoot,
      addonPath,
      'materialized OCR addon path'
    ),
    runtimeDescriptorPath: destinationDescriptor
  }
}

async function readProcessRssBytes(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    if (process.platform === 'win32') {
      const result = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`],
        { encoding: 'utf8', timeout: 5_000, windowsHide: true }
      )
      const value = Number(result.stdout.trim())
      return Number.isFinite(value) && value > 0 ? value : null
    }

    const result = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 5_000
    })
    const kibibytes = Number(result.stdout.trim())
    return Number.isFinite(kibibytes) && kibibytes > 0 ? kibibytes * 1024 : null
  } catch {
    // The helper may exit while an asynchronous sample is in flight.
    return null
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit)
      reject(new Error('Packaged OCR helper did not exit after shutdown'))
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timeout)
      resolve()
    }
    child.once('exit', onExit)
  })
}

async function recognize(client, requestId, fixturePath, timeoutMs) {
  const startedAt = performance.now()
  client.send({ type: 'recognize', id: requestId, filePath: fixturePath })
  const result = assertResult(await waitForResponse(client, requestId, timeoutMs), requestId)
  assertFixtureRecognized(result)
  return { result, durationMs: performance.now() - startedAt }
}

export async function runPackagedLightOcr(layout, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-light-ocr-smoke-'))
  const fixturePath = path.join(tempRoot, 'fixture.png')
  let child = null
  let sampler = null
  let rssSampling = null
  let peakRssBytes = 0

  try {
    await createFixture(fixturePath)
    const nativeRuntimeOverride = await materializePackagedNativeRuntime(layout, tempRoot)
    child = spawn(
      layout.nodeExecutable,
      [
        layout.helperEntryPath,
        '--bundle-path',
        layout.bundlePath,
        '--expected-bundle-id',
        layout.bundleId,
        '--temp-root',
        tempRoot
      ],
      {
        cwd: layout.unpackedRoot,
        env: createPackagedLightOcrEnvironment(process.env, nativeRuntimeOverride),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      }
    )
    const client = createProtocolClient(child)
    const sampleRss = () => {
      if (rssSampling) return rssSampling
      rssSampling = readProcessRssBytes(child.pid)
        .then((rss) => {
          if (rss) peakRssBytes = Math.max(peakRssBytes, rss)
        })
        .finally(() => {
          rssSampling = null
        })
      return rssSampling
    }
    sampler = setInterval(() => void sampleRss(), 200)

    const initializationStartedAt = performance.now()
    const hello = await client.waitFor(
      (message) => message?.type === 'hello',
      'handshake',
      Math.min(timeoutMs, 60_000)
    )
    if (
      hello.protocolVersion !== PROTOCOL_VERSION ||
      hello.nodeVersion !== options.expectedNodeVersion
    ) {
      throw new Error('Packaged OCR helper handshake does not match the pinned runtime')
    }

    client.send({
      type: 'configure',
      id: 'configure',
      backend: options.backend ?? 'auto',
      strategy: 'bounded-960'
    })
    const engine = assertResult(
      await waitForResponse(client, 'configure', timeoutMs),
      'configure'
    )
    const initializationMs = performance.now() - initializationStartedAt
    if (engine?.modelBundleId !== layout.bundleId) {
      throw new Error('Packaged OCR engine loaded an unexpected model bundle')
    }

    const cold = await recognize(client, 'recognize-cold', fixturePath, timeoutMs)
    const warm = await recognize(client, 'recognize-warm', fixturePath, timeoutMs)
    await sampleRss()

    client.send({ type: 'shutdown', id: 'shutdown' })
    assertResult(await waitForResponse(client, 'shutdown', 10_000), 'shutdown')
    await waitForExit(child, 10_000)

    return {
      initializationMs,
      coldRecognitionMs: cold.durationMs,
      warmRecognitionMs: warm.durationMs,
      peakRssBytes: peakRssBytes || null,
      engine: {
        coreVersion: engine.coreVersion,
        requestedProvider: engine.requestedProvider,
        strategy: engine.strategy,
        detectionProviderChain: engine.detection?.actualProviderChain ?? [],
        detectionPrecision: engine.detection?.precision ?? null,
        recognitionProviderChain: engine.recognition?.actualProviderChain ?? [],
        recognitionPrecision: engine.recognition?.precision ?? null
      },
      helperExitedAfterShutdown: true
    }
  } catch (error) {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    throw error
  } finally {
    if (sampler) clearInterval(sampler)
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await waitForExit(child, 5_000).catch(() => undefined)
    }
    if (rssSampling) await rssSampling
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function isContainedPath(rootDir, candidatePath) {
  const relative = path.relative(rootDir, candidatePath)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function listFiles(rootDir, { allowInternalSymlinks = false } = {}) {
  const files = []
  const resolvedRoot = await realpath(rootDir)
  const visit = async (current) => {
    const currentStat = await lstat(current)
    if (currentStat.isSymbolicLink()) {
      if (!allowInternalSymlinks) {
        throw new Error('Packaged measured assets must not contain symbolic links')
      }
      const resolvedTarget = await realpath(current)
      if (!isContainedPath(resolvedRoot, resolvedTarget)) {
        throw new Error('Packaged runtime symbolic link escapes its measured root')
      }
      return
    }
    if (currentStat.isFile()) {
      files.push({ path: current, bytes: currentStat.size })
      return
    }
    if (!currentStat.isDirectory()) return
    const entries = await readdir(current)
    for (const entry of entries) await visit(path.join(current, entry))
  }
  await visit(rootDir)
  return files
}

async function pathExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function gzipFileSize(filePath) {
  return new Promise((resolve, reject) => {
    let bytes = 0
    const input = createReadStream(filePath)
    const gzip = createGzip({ level: 9 })
    input.once('error', reject)
    gzip.once('error', reject)
    gzip.on('data', (chunk) => {
      bytes += chunk.byteLength
    })
    gzip.once('end', () => resolve(bytes))
    input.pipe(gzip)
  })
}

async function measureRoots(roots, includeCompressed, { allowInternalSymlinks = false } = {}) {
  let unpackedBytes = 0
  let compressedBytes = 0
  let fileCount = 0
  for (const root of roots) {
    const files = await listFiles(root, { allowInternalSymlinks })
    fileCount += files.length
    for (const file of files) {
      unpackedBytes += file.bytes
      if (includeCompressed) compressedBytes += await gzipFileSize(file.path)
    }
  }
  return {
    fileCount,
    unpackedBytes,
    compressedBytes: includeCompressed ? compressedBytes : null,
    compressionMethod: includeCompressed ? 'sum-of-file-gzip-9' : null
  }
}

function sumMetrics(metrics, includeCompressed) {
  return {
    fileCount: metrics.reduce((total, metric) => total + metric.fileCount, 0),
    unpackedBytes: metrics.reduce((total, metric) => total + metric.unpackedBytes, 0),
    compressedBytes: includeCompressed
      ? metrics.reduce((total, metric) => total + metric.compressedBytes, 0)
      : null,
    compressionMethod: includeCompressed ? 'sum-of-file-gzip-9' : null
  }
}

export async function measurePackagedOcrAssets(layout, { includeCompressed = true } = {}) {
  if (!layout.supported) return measureRoots([], includeCompressed)
  return measureRoots(
    [layout.facadeDir, layout.modelPackageDir, layout.nativePackageDir, layout.helperEntryPath],
    includeCompressed
  )
}

export async function measurePackagedComponents(layout, { includeCompressed = true } = {}) {
  const runtimeRoot = path.join(layout.unpackedRoot, 'runtime')
  const nodeRoot = path.join(runtimeRoot, 'node')
  const nodeRuntime = await measureRoots(
    (await pathExists(nodeRoot)) ? [nodeRoot] : [],
    includeCompressed,
    { allowInternalSymlinks: true }
  )
  const ignoredRuntimeEntries = new Set(['.gitkeep', 'duckdb', 'node', 'ocr'])
  const otherRuntimeEntries = {}
  const entries = await readdir(runtimeRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (ignoredRuntimeEntries.has(entry.name)) continue
    const metric = await measureRoots([path.join(runtimeRoot, entry.name)], includeCompressed)
    otherRuntimeEntries[entry.name] = metric
  }

  return {
    ocrAssets: await measurePackagedOcrAssets(layout, { includeCompressed }),
    nodeRuntime,
    otherRuntime: {
      ...sumMetrics(Object.values(otherRuntimeEntries), includeCompressed),
      entries: otherRuntimeEntries
    }
  }
}

export function readComponentBudgets(manifest, target) {
  if (manifest?.schemaVersion !== 1 || !manifest.componentBudgetsMiB) {
    throw new Error('Invalid Light OCR package-size budget manifest')
  }
  const { ocrAssetsCompressed, nodeRuntimeCompressed, otherRuntimeCompressedByTarget } =
    manifest.componentBudgetsMiB
  if (
    !Number.isFinite(ocrAssetsCompressed) ||
    ocrAssetsCompressed <= 0 ||
    !Number.isFinite(nodeRuntimeCompressed) ||
    nodeRuntimeCompressed <= 0 ||
    !otherRuntimeCompressedByTarget ||
    typeof otherRuntimeCompressedByTarget !== 'object'
  ) {
    throw new Error('Invalid Light OCR component-size budgets')
  }
  const otherRuntimeCompressed = otherRuntimeCompressedByTarget[target]
  if (
    !Number.isFinite(otherRuntimeCompressed) ||
    otherRuntimeCompressed < 0
  ) {
    throw new Error(`Missing or invalid Light OCR other-runtime budget for ${target}`)
  }
  return { ocrAssetsCompressed, nodeRuntimeCompressed, otherRuntimeCompressed }
}

function assertThreshold(value, limit, label) {
  if (value !== null && value > limit) {
    throw new Error(`${label} exceeded: ${value} > ${limit}`)
  }
}

async function writeReport(reportPath, report) {
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (!args['resources-path']) throw new Error('--resources-path is required')

  const platform = normalizePlatform(args.platform ?? process.platform)
  const arch = normalizeArch(args.arch ?? process.arch)
  const backend = args.backend ?? 'auto'
  if (backend !== 'auto' && backend !== 'cpu') {
    throw new Error('--backend must be auto or cpu')
  }
  const projectDir = path.resolve(args['project-dir'] ?? process.cwd())
  const runtimeVersions = await readJson(path.join(projectDir, 'resources', 'runtime-versions.json'))
  const sizeBudgets = await readJson(
    path.resolve(
      args['size-budgets-path'] ??
        path.join(projectDir, 'resources', 'light-ocr-size-budgets.json')
    )
  )
  const target = `${platform}-${arch}`
  const componentBudgets = readComponentBudgets(sizeBudgets, target)
  const timeoutMs = parsePositiveNumber(
    args['max-duration-ms'],
    '--max-duration-ms',
    DEFAULT_OPERATION_TIMEOUT_MS
  )
  const peakRssLimitBytes =
    parsePositiveNumber(
      args['max-peak-rss-mib'],
      '--max-peak-rss-mib',
      DEFAULT_PEAK_RSS_LIMIT_BYTES / MIB
    ) *
    MIB
  const compressedAssetLimitBytes =
    parsePositiveNumber(
      args['max-compressed-mib'],
      '--max-compressed-mib',
      componentBudgets.ocrAssetsCompressed
    ) *
    MIB
  const compressedNodeLimitBytes =
    parsePositiveNumber(
      args['max-node-compressed-mib'],
      '--max-node-compressed-mib',
      componentBudgets.nodeRuntimeCompressed
    ) * MIB
  const compressedOtherRuntimeLimitBytes =
    parseNonNegativeNumber(
      args['max-other-runtime-compressed-mib'],
      '--max-other-runtime-compressed-mib',
      componentBudgets.otherRuntimeCompressed
    ) * MIB
  const layout = await resolvePackagedOcrLayout({
    resourcesPath: args['resources-path'],
    platform,
    arch,
    runtimeVersions
  })
  assertSupportExpectation(args, layout.supported)

  const report = {
    schemaVersion: 2,
    target: { platform, arch },
    supported: layout.supported,
    executed: false,
    lightOcrVersion: layout.lightOcrVersion,
    bundleId: layout.bundleId,
    componentMetrics: null,
    assetMetrics: null,
    runtimeMetrics: null
  }

  report.componentMetrics = await measurePackagedComponents(layout, {
    includeCompressed: !args['skip-compression']
  })
  report.assetMetrics = report.componentMetrics.ocrAssets
  try {
    assertThreshold(
      report.componentMetrics.ocrAssets.compressedBytes,
      compressedAssetLimitBytes,
      'Packaged OCR compressed asset estimate'
    )
    assertThreshold(
      report.componentMetrics.nodeRuntime.compressedBytes,
      compressedNodeLimitBytes,
      'Packaged Node compressed runtime estimate'
    )
    assertThreshold(
      report.componentMetrics.otherRuntime.compressedBytes,
      compressedOtherRuntimeLimitBytes,
      'Packaged other-runtime compressed estimate'
    )
    if (layout.supported) {
      const targetMatchesHost = platform === process.platform && arch === process.arch
      if (targetMatchesHost) {
        report.runtimeMetrics = await runPackagedLightOcr(layout, {
          backend,
          timeoutMs,
          expectedNodeVersion: runtimeVersions.node
        })
        report.executed = true
        assertThreshold(
          report.runtimeMetrics.coldRecognitionMs,
          timeoutMs,
          'Packaged OCR cold recognition time'
        )
        assertThreshold(
          report.runtimeMetrics.warmRecognitionMs,
          timeoutMs,
          'Packaged OCR warm recognition time'
        )
        if (report.runtimeMetrics.peakRssBytes === null && args['require-peak-rss']) {
          throw new Error('Unable to measure packaged OCR peak RSS')
        }
        assertThreshold(
          report.runtimeMetrics.peakRssBytes,
          peakRssLimitBytes,
          'Packaged OCR peak RSS'
        )
      } else if (args['require-execution']) {
        throw new Error(
          `Packaged OCR execution requires a matching host: target ${platform}/${arch}, host ${process.platform}/${process.arch}`
        )
      }
    }
  } catch (error) {
    if (args['report-path']) await writeReport(path.resolve(args['report-path']), report)
    throw error
  }

  if (args['report-path']) await writeReport(path.resolve(args['report-path']), report)
  console.log(`[Light OCR Smoke] ${JSON.stringify(report)}`)
  return report
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error('[Light OCR Smoke] failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
