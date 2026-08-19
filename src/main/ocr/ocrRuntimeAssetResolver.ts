import { createRequire } from 'node:module'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import runtimeVersions from '../../../resources/runtime-versions.json'
import { isToolchainResolutionError } from '@/toolchains/errors'
import { resolveBundledNodeExecutable } from './lightOcrProcessHost'
import {
  classifyLightOcrArtifact,
  getRequiredPdfiumArtifactPaths,
  type LightOcrNativePayloadEncoding
} from './lightOcrNativePayload'

const LIGHT_OCR_FACADE_PACKAGE = '@arcships/light-ocr'

export type OcrRuntimeUnavailableReason =
  | 'asset_identity_mismatch'
  | 'assets_missing'
  | 'runtime_manifest_invalid'
  | 'service_closed'
  | 'unsupported_platform'
  | 'toolchain_unavailable'
  | 'version_mismatch'
  | 'abi_mismatch'

export interface OcrRuntimeAssets {
  nodeExecutable: string
  nodeVersion?: string
  helperEntryPath: string
  facadeDir: string
  runtimeDir: string
  bundlePath: string
  nativePackageDir: string
  nativePayloadEncoding: LightOcrNativePayloadEncoding
  nativePackage: string
  lightOcrVersion: string
  bundleId: string
}

export type OcrRuntimeAvailability =
  | {
      status: 'available'
      assets: OcrRuntimeAssets
    }
  | {
      status: 'unavailable'
      reason: OcrRuntimeUnavailableReason
      lightOcrVersion: string
      bundleId: string
    }

export interface OcrRuntimeAssetResolverOptions {
  appPath: string
  isPackaged: boolean
  platform?: NodeJS.Platform
  arch?: string
  nodeRuntimePath?: string | null
  resolveNode?: () => { executable: string; version: string }
}

interface PackagedRuntimeManifest {
  schemaVersion: number
  supported: boolean
  reason?: string
  platform: string
  arch: string
  facadeVersion: string
  runtimeVersion: string
  modelVersion: string
  nativeVersion: string
  pdfSupport: boolean
  bundleId: string
  nativePayloadEncoding?: LightOcrNativePayloadEncoding
  nativePackage?: string
  nativeArtifactInventory?: NativeArtifactInventory
  paths?: {
    node?: string
    helper: string
    facade: string
    runtime: string
    bundle: string
    native: string
  }
}

interface NativeArtifactInventory {
  nativeCode: string[]
  pdfiumCode: string[]
  pdfiumLoader: string[]
  other: string[]
}

const NATIVE_ARTIFACT_INVENTORY_GROUPS: ReadonlyArray<keyof NativeArtifactInventory> = [
  'nativeCode',
  'pdfiumCode',
  'pdfiumLoader',
  'other'
]

interface ResolvedRuntimeAssets {
  assets: OcrRuntimeAssets
  expectedNativeArtifactInventory: NativeArtifactInventory | null
}

export class OcrRuntimeAssetResolver {
  private readonly platform: NodeJS.Platform
  private readonly arch: string

  constructor(private readonly options: OcrRuntimeAssetResolverOptions) {
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
  }

  async resolve(): Promise<OcrRuntimeAvailability> {
    const nativePackage = this.getNativePackage()
    if (!nativePackage) return this.unavailable('unsupported_platform')

    try {
      const resolved = this.options.isPackaged
        ? await this.resolvePackaged(nativePackage)
        : await this.resolveDevelopment(nativePackage)
      await this.verifyIdentity(resolved.assets, resolved.expectedNativeArtifactInventory)
      return { status: 'available', assets: resolved.assets }
    } catch (error) {
      if (error instanceof RuntimeAssetError) return this.unavailable(error.reason)
      return this.unavailable('assets_missing')
    }
  }

  private async resolvePackaged(nativePackage: string): Promise<ResolvedRuntimeAssets> {
    const unpackedRoot = resolveUnpackedAppRoot(this.options.appPath)
    const manifestPath = path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json')
    let parsedManifest: unknown
    try {
      parsedManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
    } catch (error) {
      const reason =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'assets_missing'
          : 'runtime_manifest_invalid'
      throw new RuntimeAssetError(reason, 'Packaged OCR runtime manifest is unavailable', {
        cause: error
      })
    }

    if (!isPackagedRuntimeManifest(parsedManifest)) {
      throw new RuntimeAssetError(
        'runtime_manifest_invalid',
        'Packaged OCR runtime manifest has an invalid shape'
      )
    }
    const manifest = parsedManifest
    if (
      manifest.schemaVersion !== 3 ||
      !manifest.supported ||
      manifest.platform !== this.platform ||
      manifest.arch !== this.arch ||
      manifest.facadeVersion !== runtimeVersions.lightOcr.facadeVersion ||
      manifest.runtimeVersion !== runtimeVersions.lightOcr.runtimeVersion ||
      manifest.modelVersion !== runtimeVersions.lightOcr.modelVersion ||
      manifest.nativeVersion !== runtimeVersions.lightOcr.nativeVersion ||
      !manifest.pdfSupport ||
      manifest.bundleId !== runtimeVersions.lightOcr.bundleId ||
      manifest.nativePayloadEncoding !== expectedNativePayloadEncoding(this.platform) ||
      manifest.nativePackage !== nativePackage ||
      !manifest.nativeArtifactInventory ||
      !manifest.paths
    ) {
      throw new RuntimeAssetError(
        'runtime_manifest_invalid',
        'Packaged OCR runtime manifest does not match this build'
      )
    }

    return {
      assets: {
        ...this.resolveNodeAssets(
          manifest.paths.node ? resolveManifestPath(unpackedRoot, manifest.paths.node) : ''
        ),
        helperEntryPath: resolveManifestPath(unpackedRoot, manifest.paths.helper),
        facadeDir: resolveManifestPath(unpackedRoot, manifest.paths.facade),
        runtimeDir: resolveManifestPath(unpackedRoot, manifest.paths.runtime),
        bundlePath: resolveManifestPath(unpackedRoot, manifest.paths.bundle),
        nativePackageDir: resolveManifestPath(unpackedRoot, manifest.paths.native),
        nativePayloadEncoding: manifest.nativePayloadEncoding,
        nativePackage,
        lightOcrVersion: runtimeVersions.lightOcr.facadeVersion,
        bundleId: runtimeVersions.lightOcr.bundleId
      },
      expectedNativeArtifactInventory: manifest.nativeArtifactInventory
    }
  }

  private async resolveDevelopment(nativePackage: string): Promise<ResolvedRuntimeAssets> {
    if (!this.options.resolveNode && !this.options.nodeRuntimePath) {
      throw new RuntimeAssetError('assets_missing', 'Bundled Node runtime is not installed')
    }

    const projectRequire = createRequire(path.join(this.options.appPath, 'package.json'))
    let facadeEntry: string
    let runtimeEntry: string
    let bundleManifestPath: string
    let nativeEntry: string
    try {
      facadeEntry = projectRequire.resolve(LIGHT_OCR_FACADE_PACKAGE)
      const facadeRequire = createRequire(facadeEntry)
      runtimeEntry = facadeRequire.resolve(runtimeVersions.lightOcr.runtimePackage)
      bundleManifestPath = facadeRequire.resolve(
        `${runtimeVersions.lightOcr.modelPackage}/bundle/manifest.json`
      )
      nativeEntry = createRequire(runtimeEntry).resolve(nativePackage)
    } catch (error) {
      throw new RuntimeAssetError('assets_missing', 'Development OCR packages are missing', {
        cause: error
      })
    }

    return {
      assets: {
        ...this.resolveNodeAssets(
          this.options.nodeRuntimePath
            ? resolveBundledNodeExecutable(this.options.nodeRuntimePath, this.platform)
            : ''
        ),
        helperEntryPath: path.join(this.options.appPath, 'out', 'main', 'lightOcrHelper.js'),
        facadeDir: path.resolve(path.dirname(facadeEntry), '..'),
        runtimeDir: path.resolve(path.dirname(runtimeEntry), '..'),
        bundlePath: path.dirname(bundleManifestPath),
        nativePackageDir: path.resolve(path.dirname(nativeEntry), '..'),
        nativePayloadEncoding: 'direct',
        nativePackage,
        lightOcrVersion: runtimeVersions.lightOcr.facadeVersion,
        bundleId: runtimeVersions.lightOcr.bundleId
      },
      expectedNativeArtifactInventory: null
    }
  }

  private resolveNodeAssets(fallbackExecutable: string): {
    nodeExecutable: string
    nodeVersion?: string
  } {
    if (this.options.resolveNode) {
      try {
        const resolved = this.options.resolveNode()
        return { nodeExecutable: resolved.executable, nodeVersion: resolved.version }
      } catch (error) {
        if (isToolchainResolutionError(error)) {
          const reason =
            error.reason === 'version_mismatch' || error.reason === 'abi_mismatch'
              ? error.reason
              : 'toolchain_unavailable'
          throw new RuntimeAssetError(reason, error.message, { cause: error })
        }
        throw error
      }
    }
    if (fallbackExecutable) {
      return { nodeExecutable: fallbackExecutable }
    }
    throw new RuntimeAssetError('assets_missing', 'Bundled Node runtime is not installed')
  }

  private async verifyIdentity(
    assets: OcrRuntimeAssets,
    expectedNativeArtifactInventory: NativeArtifactInventory | null
  ): Promise<void> {
    try {
      await Promise.all([
        access(assets.nodeExecutable),
        access(assets.helperEntryPath),
        access(path.join(assets.facadeDir, 'src', 'index.cjs')),
        access(path.join(assets.runtimeDir, 'src', 'index.cjs')),
        access(path.join(assets.nativePackageDir, 'artifact-hashes.json')),
        access(path.join(assets.nativePackageDir, 'native', 'runtime-descriptor.json')),
        ...getRequiredPdfiumArtifactPaths(this.platform).map((relativePath) => {
          const encoded =
            assets.nativePayloadEncoding === 'gzip-base64-v1' &&
            classifyLightOcrArtifact(relativePath) === 'pdfium-code'
          return access(
            path.join(
              assets.nativePackageDir,
              ...`${relativePath}${encoded ? '.gz.b64' : ''}`.split('/')
            )
          )
        })
      ])
      const [
        facadePackage,
        runtimePackage,
        modelPackage,
        nativePackage,
        bundleManifest,
        artifacts
      ] = await Promise.all([
        readJson(path.join(assets.facadeDir, 'package.json')),
        readJson(path.join(assets.runtimeDir, 'package.json')),
        readJson(path.join(assets.bundlePath, '..', 'package.json')),
        readJson(path.join(assets.nativePackageDir, 'package.json')),
        readJson(path.join(assets.bundlePath, 'manifest.json')),
        readJson(path.join(assets.nativePackageDir, 'artifact-hashes.json'))
      ])
      if (
        facadePackage.name !== LIGHT_OCR_FACADE_PACKAGE ||
        facadePackage.version !== runtimeVersions.lightOcr.facadeVersion ||
        !hasExactDependency(
          facadePackage,
          'dependencies',
          runtimeVersions.lightOcr.runtimePackage,
          runtimeVersions.lightOcr.runtimeVersion
        ) ||
        !hasExactDependency(
          facadePackage,
          'dependencies',
          runtimeVersions.lightOcr.modelPackage,
          runtimeVersions.lightOcr.modelVersion
        ) ||
        runtimePackage.name !== runtimeVersions.lightOcr.runtimePackage ||
        runtimePackage.version !== runtimeVersions.lightOcr.runtimeVersion ||
        !hasExactDependency(
          runtimePackage,
          'optionalDependencies',
          assets.nativePackage,
          runtimeVersions.lightOcr.nativeVersion
        ) ||
        modelPackage.name !== runtimeVersions.lightOcr.modelPackage ||
        modelPackage.version !== runtimeVersions.lightOcr.modelVersion ||
        nativePackage.name !== assets.nativePackage ||
        nativePackage.version !== runtimeVersions.lightOcr.nativeVersion ||
        bundleManifest.bundleId !== runtimeVersions.lightOcr.bundleId ||
        !hasRequiredPdfiumInventory(artifacts, this.platform) ||
        (expectedNativeArtifactInventory !== null &&
          !matchesArtifactInventory(artifacts, expectedNativeArtifactInventory))
      ) {
        throw new RuntimeAssetError(
          'asset_identity_mismatch',
          'OCR runtime asset identities do not match the pinned release'
        )
      }
    } catch (error) {
      if (error instanceof RuntimeAssetError) throw error
      throw new RuntimeAssetError('assets_missing', 'OCR runtime assets are incomplete', {
        cause: error
      })
    }
  }

  private getNativePackage(): string | null {
    const packages = runtimeVersions.lightOcr.nativePackages as Record<string, string>
    return packages[`${this.platform}-${this.arch}`] ?? null
  }

  private unavailable(reason: OcrRuntimeUnavailableReason): OcrRuntimeAvailability {
    return {
      status: 'unavailable',
      reason,
      lightOcrVersion: runtimeVersions.lightOcr.facadeVersion,
      bundleId: runtimeVersions.lightOcr.bundleId
    }
  }
}

class RuntimeAssetError extends Error {
  constructor(
    readonly reason: OcrRuntimeUnavailableReason,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'RuntimeAssetError'
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
}

function resolveUnpackedAppRoot(appPath: string): string {
  if (path.basename(appPath) === 'app.asar') {
    return path.join(path.dirname(appPath), 'app.asar.unpacked')
  }
  return path.join(appPath, 'app.asar.unpacked')
}

function resolveManifestPath(rootDir: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new RuntimeAssetError('runtime_manifest_invalid', 'OCR runtime path must be relative')
  }
  const resolvedRoot = path.resolve(rootDir)
  const resolvedPath = path.resolve(resolvedRoot, relativePath)
  const relative = path.relative(resolvedRoot, resolvedPath)
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new RuntimeAssetError(
      'runtime_manifest_invalid',
      'OCR runtime path escapes the unpacked app root'
    )
  }
  return resolvedPath
}

export function isPackagedRuntimeManifest(value: unknown): value is PackagedRuntimeManifest {
  if (!isRecord(value)) return false
  if (
    typeof value.schemaVersion !== 'number' ||
    typeof value.supported !== 'boolean' ||
    typeof value.platform !== 'string' ||
    typeof value.arch !== 'string' ||
    typeof value.facadeVersion !== 'string' ||
    typeof value.runtimeVersion !== 'string' ||
    typeof value.modelVersion !== 'string' ||
    typeof value.nativeVersion !== 'string' ||
    typeof value.pdfSupport !== 'boolean' ||
    typeof value.bundleId !== 'string'
  ) {
    return false
  }
  if (value.reason !== undefined && typeof value.reason !== 'string') return false
  if (value.nativePackage !== undefined && typeof value.nativePackage !== 'string') return false
  if (
    value.nativeArtifactInventory !== undefined &&
    !isNativeArtifactInventory(value.nativeArtifactInventory)
  ) {
    return false
  }
  if (
    value.nativePayloadEncoding !== undefined &&
    value.nativePayloadEncoding !== 'direct' &&
    value.nativePayloadEncoding !== 'gzip-base64-v1'
  ) {
    return false
  }
  if (value.paths === undefined) return true
  if (!isRecord(value.paths)) return false
  const requiredPathKeys = ['helper', 'facade', 'runtime', 'bundle', 'native'] as const
  return (
    requiredPathKeys.every((key) => typeof value.paths?.[key] === 'string') &&
    (value.paths.node === undefined || typeof value.paths.node === 'string')
  )
}

function isNativeArtifactInventory(value: unknown): value is NativeArtifactInventory {
  if (!isRecord(value)) return false
  return ['nativeCode', 'pdfiumCode', 'pdfiumLoader', 'other'].every(
    (key) =>
      Array.isArray(value[key]) && value[key].every((entry: unknown) => typeof entry === 'string')
  )
}

function hasExactDependency(
  packageJson: Record<string, unknown>,
  field: string,
  dependencyName: string,
  expectedVersion: string
): boolean {
  const dependencies = packageJson[field]
  return isRecord(dependencies) && dependencies[dependencyName] === expectedVersion
}

function hasRequiredPdfiumInventory(
  artifactManifest: Record<string, unknown>,
  platform: NodeJS.Platform
): boolean {
  if (!Array.isArray(artifactManifest.files)) return false
  const actualPaths = artifactManifest.files
    .map((entry) => (isRecord(entry) ? entry.path : undefined))
    .filter((entry): entry is string => typeof entry === 'string' && entry.startsWith('pdfium/'))
    .sort()
  const expectedPaths = [...getRequiredPdfiumArtifactPaths(platform)].sort()
  return (
    actualPaths.length === expectedPaths.length &&
    actualPaths.every((entry, index) => entry === expectedPaths[index])
  )
}

function matchesArtifactInventory(
  artifactManifest: Record<string, unknown>,
  expected: NativeArtifactInventory
): boolean {
  const actual = groupArtifactInventory(artifactManifest)
  return (
    actual !== null &&
    NATIVE_ARTIFACT_INVENTORY_GROUPS.every(
      (group) =>
        actual[group].length === expected[group].length &&
        actual[group].every((relativePath, index) => relativePath === expected[group][index])
    )
  )
}

function groupArtifactInventory(
  artifactManifest: Record<string, unknown>
): NativeArtifactInventory | null {
  if (!Array.isArray(artifactManifest.files)) return null
  const result: NativeArtifactInventory = {
    nativeCode: [],
    pdfiumCode: [],
    pdfiumLoader: [],
    other: []
  }
  const seen = new Set<string>()
  for (const entry of artifactManifest.files) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || seen.has(entry.path)) return null
    seen.add(entry.path)
    const kind = classifyLightOcrArtifact(entry.path)
    if (kind === 'native-code') result.nativeCode.push(entry.path)
    else if (kind === 'pdfium-code') result.pdfiumCode.push(entry.path)
    else if (kind === 'pdfium-loader') result.pdfiumLoader.push(entry.path)
    else result.other.push(entry.path)
  }
  for (const paths of Object.values(result)) paths.sort()
  return result
}

function expectedNativePayloadEncoding(platform: NodeJS.Platform): LightOcrNativePayloadEncoding {
  return platform === 'darwin' ? 'gzip-base64-v1' : 'direct'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
