import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gunzip } from 'node:zlib'

const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_MANIFEST_ARTIFACTS = 512
const MAX_NATIVE_ARTIFACTS = 8
const MAX_ENCODED_OVERHEAD_BYTES = 1024 * 1024
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export type LightOcrNativePayloadEncoding = 'direct' | 'gzip-base64-v1'

export interface LightOcrNativeRuntimeOverride {
  nodeBinaryPath: string
  runtimeDescriptorPath: string
}

interface NativeArtifact {
  path: string
  bytes: number
  sha256: string
}

interface NativeArtifactManifest {
  files: NativeArtifact[]
}

interface RuntimeDescriptor {
  addon: NativeArtifact
  runtime: {
    artifacts: NativeArtifact[]
  }
}

export async function materializeLightOcrNativePayload(options: {
  nativePackageDir: string
  tempRoot: string
}): Promise<LightOcrNativeRuntimeOverride> {
  const packageStat = await lstat(options.nativePackageDir)
  if (!packageStat.isDirectory() || packageStat.isSymbolicLink()) {
    throw new Error('Light OCR native package root is not a regular directory')
  }

  const manifest = await readArtifactManifest(options.nativePackageDir)
  const artifactByPath = new Map(manifest.files.map((artifact) => [artifact.path, artifact]))
  if (artifactByPath.size !== manifest.files.length) {
    throw new Error('Light OCR native artifact manifest contains duplicate paths')
  }

  const descriptorArtifact = artifactByPath.get('native/runtime-descriptor.json')
  if (!descriptorArtifact) {
    throw new Error('Light OCR native runtime descriptor is missing from the artifact manifest')
  }
  const descriptorBytes = await readVerifiedArtifact(options.nativePackageDir, descriptorArtifact)
  const descriptor = parseRuntimeDescriptor(descriptorBytes)
  const codeArtifacts = collectCodeArtifacts(descriptor, artifactByPath)
  const declaredCodePaths = manifest.files.filter(isNativeCodeArtifact).map((entry) => entry.path)
  if (
    declaredCodePaths.length !== codeArtifacts.length ||
    declaredCodePaths.some(
      (artifactPath) => !codeArtifacts.some((entry) => entry.path === artifactPath)
    )
  ) {
    throw new Error('Light OCR native descriptor and artifact manifest inventories disagree')
  }

  const materializedRoot = await mkdtemp(path.join(options.tempRoot, 'native-runtime-'))
  try {
    const destinationDescriptor = resolveContainedPath(materializedRoot, descriptorArtifact.path)
    await mkdir(path.dirname(destinationDescriptor), { recursive: true, mode: 0o700 })
    await writeFile(destinationDescriptor, descriptorBytes, { flag: 'wx', mode: 0o600 })

    for (const artifact of codeArtifacts) {
      await assertRawArtifactAbsent(options.nativePackageDir, artifact.path)
      const encodedPath = resolveContainedPath(options.nativePackageDir, `${artifact.path}.gz.b64`)
      const encoded = await readBoundedRegularFile(
        encodedPath,
        maximumEncodedBytes(artifact.bytes),
        `encoded native artifact ${artifact.path}`
      )
      const decoded = await decodeNativeArtifact(encoded, artifact)
      const destination = resolveContainedPath(materializedRoot, artifact.path)
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
      await writeFile(destination, decoded, { flag: 'wx', mode: 0o600 })
    }

    return {
      nodeBinaryPath: resolveContainedPath(materializedRoot, descriptor.addon.path),
      runtimeDescriptorPath: destinationDescriptor
    }
  } catch (error) {
    await rm(materializedRoot, { recursive: true, force: true })
    throw error
  }
}

async function readArtifactManifest(packageDir: string): Promise<NativeArtifactManifest> {
  const manifestPath = path.join(packageDir, 'artifact-hashes.json')
  const bytes = await readBoundedRegularFile(
    manifestPath,
    MAX_MANIFEST_BYTES,
    'native artifact manifest'
  )
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown
  } catch (error) {
    throw new Error('Light OCR native artifact manifest is not valid JSON', { cause: error })
  }
  if (
    !isRecord(value) ||
    !Array.isArray(value.files) ||
    value.files.length === 0 ||
    value.files.length > MAX_MANIFEST_ARTIFACTS
  ) {
    throw new Error('Light OCR native artifact manifest has an invalid shape')
  }
  return { files: value.files.map(parseArtifact) }
}

function parseRuntimeDescriptor(bytes: Buffer): RuntimeDescriptor {
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown
  } catch (error) {
    throw new Error('Light OCR native runtime descriptor is not valid JSON', { cause: error })
  }
  if (!isRecord(value) || !isRecord(value.runtime) || !Array.isArray(value.runtime.artifacts)) {
    throw new Error('Light OCR native runtime descriptor has an invalid shape')
  }
  return {
    addon: parseArtifact(value.addon),
    runtime: { artifacts: value.runtime.artifacts.map(parseArtifact) }
  }
}

function collectCodeArtifacts(
  descriptor: RuntimeDescriptor,
  artifactByPath: Map<string, NativeArtifact>
): NativeArtifact[] {
  const referenced = [descriptor.addon, ...descriptor.runtime.artifacts]
  if (referenced.length === 0 || referenced.length > MAX_NATIVE_ARTIFACTS) {
    throw new Error('Light OCR native runtime descriptor has an invalid artifact count')
  }
  const uniquePaths = new Set<string>()
  for (const artifact of referenced) {
    if (!isNativeCodeArtifact(artifact)) {
      throw new Error(`Light OCR descriptor references an unsupported artifact: ${artifact.path}`)
    }
    if (uniquePaths.has(artifact.path)) {
      throw new Error('Light OCR native runtime descriptor contains duplicate artifacts')
    }
    uniquePaths.add(artifact.path)
    const declared = artifactByPath.get(artifact.path)
    if (!declared || declared.bytes !== artifact.bytes || declared.sha256 !== artifact.sha256) {
      throw new Error(`Light OCR descriptor metadata mismatch for ${artifact.path}`)
    }
  }
  return referenced
}

function parseArtifact(value: unknown): NativeArtifact {
  if (
    !isRecord(value) ||
    typeof value.path !== 'string' ||
    !Number.isSafeInteger(value.bytes) ||
    (value.bytes as number) <= 0 ||
    typeof value.sha256 !== 'string' ||
    !SHA256_PATTERN.test(value.sha256)
  ) {
    throw new Error('Light OCR native artifact metadata is invalid')
  }
  validateRelativePath(value.path)
  return { path: value.path, bytes: value.bytes as number, sha256: value.sha256 }
}

function isNativeCodeArtifact(artifact: NativeArtifact): boolean {
  if (!artifact.path.startsWith('native/')) return false
  const extension = path.posix.extname(artifact.path).toLowerCase()
  return extension === '.node' || extension === '.dylib'
}

async function readVerifiedArtifact(packageDir: string, artifact: NativeArtifact): Promise<Buffer> {
  const filePath = resolveContainedPath(packageDir, artifact.path)
  const bytes = await readBoundedRegularFile(filePath, artifact.bytes, artifact.path)
  if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
    throw new Error(`Light OCR native artifact integrity mismatch for ${artifact.path}`)
  }
  return bytes
}

async function decodeNativeArtifact(encoded: Buffer, artifact: NativeArtifact): Promise<Buffer> {
  const text = encoded.toString('utf8')
  if (!isCanonicalBase64(text)) {
    throw new Error(`Light OCR encoded artifact is not canonical base64: ${artifact.path}`)
  }
  const compressed = Buffer.from(text, 'base64')

  const decoded = await new Promise<Buffer>((resolve, reject) => {
    gunzip(compressed, { maxOutputLength: artifact.bytes }, (error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  }).catch((error) => {
    throw new Error(`Unable to decode Light OCR native artifact ${artifact.path}`, {
      cause: error
    })
  })
  if (decoded.byteLength !== artifact.bytes || sha256(decoded) !== artifact.sha256) {
    throw new Error(`Light OCR decoded artifact integrity mismatch for ${artifact.path}`)
  }
  return decoded
}

async function readBoundedRegularFile(
  filePath: string,
  maximumBytes: number,
  label: string
): Promise<Buffer> {
  const initialStat = await lstat(filePath)
  if (!initialStat.isFile() || initialStat.isSymbolicLink() || initialStat.size > maximumBytes) {
    throw new Error(`Light OCR ${label} is not a bounded regular file`)
  }
  const noFollowFlag = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW
  const handle = await open(filePath, fsConstants.O_RDONLY | noFollowFlag)
  try {
    const fileStat = await handle.stat()
    if (!fileStat.isFile() || fileStat.size > maximumBytes) {
      throw new Error(`Light OCR ${label} is not a bounded regular file`)
    }
    const bytes = await handle.readFile()
    if (bytes.byteLength > maximumBytes) {
      throw new Error(`Light OCR ${label} exceeds its size limit`)
    }
    return bytes
  } finally {
    await handle.close()
  }
}

async function assertRawArtifactAbsent(packageDir: string, relativePath: string): Promise<void> {
  const filePath = resolveContainedPath(packageDir, relativePath)
  try {
    await lstat(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw new Error(`Light OCR encoded package still contains raw native code: ${relativePath}`)
}

function maximumEncodedBytes(expectedBytes: number): number {
  return Math.ceil(((expectedBytes + MAX_ENCODED_OVERHEAD_BYTES) * 4) / 3)
}

function isCanonicalBase64(value: string): boolean {
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

function base64Value(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52
  if (code === 0x2b) return 62
  if (code === 0x2f) return 63
  return -1
}

function resolveContainedPath(rootDir: string, relativePath: string): string {
  validateRelativePath(relativePath)
  const resolvedRoot = path.resolve(rootDir)
  const resolvedPath = path.resolve(resolvedRoot, ...relativePath.split('/'))
  const relative = path.relative(resolvedRoot, resolvedPath)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Light OCR native artifact path escapes its package: ${relativePath}`)
  }
  return resolvedPath
}

function validateRelativePath(value: string): void {
  if (
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid Light OCR native artifact path: ${value}`)
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
