import { createRequire } from 'node:module'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import runtimeVersions from '../../../resources/runtime-versions.json'
import { resolveBundledNodeExecutable } from './lightOcrProcessHost'
import type { LightOcrNativePayloadEncoding } from './lightOcrNativePayload'

const LIGHT_OCR_FACADE_PACKAGE = '@arcships/light-ocr'

export type OcrRuntimeUnavailableReason =
  | 'asset_identity_mismatch'
  | 'assets_missing'
  | 'runtime_manifest_invalid'
  | 'service_closed'
  | 'unsupported_platform'

export interface OcrRuntimeAssets {
  nodeExecutable: string
  helperEntryPath: string
  facadeDir: string
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
}

interface PackagedRuntimeManifest {
  schemaVersion: number
  supported: boolean
  reason?: string
  platform: string
  arch: string
  lightOcrVersion: string
  bundleId: string
  nativePayloadEncoding?: LightOcrNativePayloadEncoding
  nativePackage?: string
  paths?: {
    node: string
    helper: string
    facade: string
    bundle: string
    native: string
  }
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
      const assets = this.options.isPackaged
        ? await this.resolvePackaged(nativePackage)
        : await this.resolveDevelopment(nativePackage)
      await this.verifyIdentity(assets)
      return { status: 'available', assets }
    } catch (error) {
      if (error instanceof RuntimeAssetError) return this.unavailable(error.reason)
      return this.unavailable('assets_missing')
    }
  }

  private async resolvePackaged(nativePackage: string): Promise<OcrRuntimeAssets> {
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
      manifest.schemaVersion !== 2 ||
      !manifest.supported ||
      manifest.platform !== this.platform ||
      manifest.arch !== this.arch ||
      manifest.lightOcrVersion !== runtimeVersions.lightOcr.version ||
      manifest.bundleId !== runtimeVersions.lightOcr.bundleId ||
      manifest.nativePayloadEncoding !== expectedNativePayloadEncoding(this.platform) ||
      manifest.nativePackage !== nativePackage ||
      !manifest.paths
    ) {
      throw new RuntimeAssetError(
        'runtime_manifest_invalid',
        'Packaged OCR runtime manifest does not match this build'
      )
    }

    return {
      nodeExecutable: resolveManifestPath(unpackedRoot, manifest.paths.node),
      helperEntryPath: resolveManifestPath(unpackedRoot, manifest.paths.helper),
      facadeDir: resolveManifestPath(unpackedRoot, manifest.paths.facade),
      bundlePath: resolveManifestPath(unpackedRoot, manifest.paths.bundle),
      nativePackageDir: resolveManifestPath(unpackedRoot, manifest.paths.native),
      nativePayloadEncoding: manifest.nativePayloadEncoding,
      nativePackage,
      lightOcrVersion: runtimeVersions.lightOcr.version,
      bundleId: runtimeVersions.lightOcr.bundleId
    }
  }

  private async resolveDevelopment(nativePackage: string): Promise<OcrRuntimeAssets> {
    if (!this.options.nodeRuntimePath) {
      throw new RuntimeAssetError('assets_missing', 'Bundled Node runtime is not installed')
    }

    const projectRequire = createRequire(path.join(this.options.appPath, 'package.json'))
    let facadeEntry: string
    let bundleManifestPath: string
    let nativeEntry: string
    try {
      facadeEntry = projectRequire.resolve(LIGHT_OCR_FACADE_PACKAGE)
      const facadeRequire = createRequire(facadeEntry)
      bundleManifestPath = facadeRequire.resolve(
        `${runtimeVersions.lightOcr.modelPackage}/bundle/manifest.json`
      )
      nativeEntry = facadeRequire.resolve(nativePackage)
    } catch (error) {
      throw new RuntimeAssetError('assets_missing', 'Development OCR packages are missing', {
        cause: error
      })
    }

    return {
      nodeExecutable: resolveBundledNodeExecutable(this.options.nodeRuntimePath, this.platform),
      helperEntryPath: path.join(this.options.appPath, 'out', 'main', 'lightOcrHelper.js'),
      facadeDir: path.resolve(path.dirname(facadeEntry), '..'),
      bundlePath: path.dirname(bundleManifestPath),
      nativePackageDir: path.resolve(path.dirname(nativeEntry), '..'),
      nativePayloadEncoding: 'direct',
      nativePackage,
      lightOcrVersion: runtimeVersions.lightOcr.version,
      bundleId: runtimeVersions.lightOcr.bundleId
    }
  }

  private async verifyIdentity(assets: OcrRuntimeAssets): Promise<void> {
    try {
      await Promise.all([
        access(assets.nodeExecutable),
        access(assets.helperEntryPath),
        access(path.join(assets.facadeDir, 'js', 'index.cjs')),
        access(path.join(assets.nativePackageDir, 'artifact-hashes.json')),
        access(path.join(assets.nativePackageDir, 'native', 'runtime-descriptor.json'))
      ])
      const [facadePackage, modelPackage, nativePackage, bundleManifest] = await Promise.all([
        readJson(path.join(assets.facadeDir, 'package.json')),
        readJson(path.join(assets.bundlePath, '..', 'package.json')),
        readJson(path.join(assets.nativePackageDir, 'package.json')),
        readJson(path.join(assets.bundlePath, 'manifest.json'))
      ])
      if (
        facadePackage.name !== LIGHT_OCR_FACADE_PACKAGE ||
        facadePackage.version !== runtimeVersions.lightOcr.version ||
        modelPackage.name !== runtimeVersions.lightOcr.modelPackage ||
        modelPackage.version !== runtimeVersions.lightOcr.version ||
        nativePackage.name !== assets.nativePackage ||
        nativePackage.version !== runtimeVersions.lightOcr.version ||
        bundleManifest.bundleId !== runtimeVersions.lightOcr.bundleId
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
      lightOcrVersion: runtimeVersions.lightOcr.version,
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

function isPackagedRuntimeManifest(value: unknown): value is PackagedRuntimeManifest {
  if (!isRecord(value)) return false
  if (
    typeof value.schemaVersion !== 'number' ||
    typeof value.supported !== 'boolean' ||
    typeof value.platform !== 'string' ||
    typeof value.arch !== 'string' ||
    typeof value.lightOcrVersion !== 'string' ||
    typeof value.bundleId !== 'string'
  ) {
    return false
  }
  if (value.reason !== undefined && typeof value.reason !== 'string') return false
  if (value.nativePackage !== undefined && typeof value.nativePackage !== 'string') return false
  if (
    value.nativePayloadEncoding !== undefined &&
    value.nativePayloadEncoding !== 'direct' &&
    value.nativePayloadEncoding !== 'gzip-base64-v1'
  ) {
    return false
  }
  if (value.paths === undefined) return true
  if (!isRecord(value.paths)) return false
  return ['node', 'helper', 'facade', 'bundle', 'native'].every(
    (key) => typeof value.paths?.[key] === 'string'
  )
}

function expectedNativePayloadEncoding(platform: NodeJS.Platform): LightOcrNativePayloadEncoding {
  return platform === 'darwin' ? 'gzip-base64-v1' : 'direct'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
