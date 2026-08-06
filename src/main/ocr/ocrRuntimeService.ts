import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import runtimeVersions from '../../../resources/runtime-versions.json'
import {
  DocumentTextExtractionService,
  type DocumentTextExtractionInput,
  type DocumentTextExtractionResult
} from './documentTextExtractionService'
import {
  ImageTextExtractionService,
  type ImageTextExtractionBatchItem,
  type ImageTextExtractionInput,
  type ImageTextExtractionResult
} from './imageTextExtractionService'
import { LightOcrProcessHost, type LightOcrProcessHostStatus } from './lightOcrProcessHost'
import { OcrArtifactStore, type OcrArtifactStoreStats } from './ocrArtifactStore'
import { SafeStorageOcrCacheKeyProvider } from './ocrCacheKeyProvider'
import { OcrExtractionScheduler } from './ocrExtractionScheduler'
import { OcrRuntimeAssetResolver, type OcrRuntimeAvailability } from './ocrRuntimeAssetResolver'
import { OcrSourceSnapshotBudget } from './ocrSourceSnapshotBudget'

export interface OcrRuntimeServiceOptions {
  appPath: string
  isPackaged: boolean
  nodeRuntimePath: string | null
  tempBaseDir: string
  userDataDir: string
  platform?: NodeJS.Platform
  arch?: string
  onDiagnostic?: (event: { code: 'cache_read_failed' | 'cache_write_failed' }) => void
}

export interface OcrRuntimeServiceStatus {
  availability: OcrRuntimeAvailability
  process: LightOcrProcessHostStatus | null
  cache: OcrArtifactStoreStats | null
}

interface RuntimeResources {
  host: LightOcrProcessHost
  store: OcrArtifactStore
  scheduler: OcrExtractionScheduler
  extraction: ImageTextExtractionService
  documentExtraction: DocumentTextExtractionService
}

export class OcrRuntimeBusyError extends Error {
  constructor() {
    super('OCR cache cannot be cleared while extraction is active')
    this.name = 'OcrRuntimeBusyError'
  }
}

/** Lazily owns the offline OCR helper, engine, and derived cache for the application lifetime. */
export class OcrRuntimeService {
  private readonly resolver: OcrRuntimeAssetResolver
  private availabilityPromise: Promise<OcrRuntimeAvailability> | null = null
  private resourcesPromise: Promise<RuntimeResources> | null = null
  private closed = false

  constructor(private readonly options: OcrRuntimeServiceOptions) {
    this.resolver = new OcrRuntimeAssetResolver({
      appPath: options.appPath,
      isPackaged: options.isPackaged,
      nodeRuntimePath: options.nodeRuntimePath,
      platform: options.platform,
      arch: options.arch
    })
  }

  async getAvailability(): Promise<OcrRuntimeAvailability> {
    if (this.closed) {
      return {
        status: 'unavailable',
        reason: 'service_closed',
        lightOcrVersion: runtimeVersions.lightOcr.facadeVersion,
        bundleId: runtimeVersions.lightOcr.bundleId
      }
    }
    this.availabilityPromise ??= this.resolver.resolve()
    return await this.availabilityPromise
  }

  async extract(input: ImageTextExtractionInput): Promise<ImageTextExtractionResult> {
    return await (await this.getResources()).extraction.extract(input)
  }

  async extractBatch(inputs: ImageTextExtractionInput[]): Promise<ImageTextExtractionBatchItem[]> {
    return await (await this.getResources()).extraction.extractBatch(inputs)
  }

  async extractDocument(input: DocumentTextExtractionInput): Promise<DocumentTextExtractionResult> {
    return await (await this.getResources()).documentExtraction.extractDocument(input)
  }

  async getStatus(): Promise<OcrRuntimeServiceStatus> {
    const availability = await this.getAvailability()
    const resources = await this.resourcesPromise?.catch(() => null)
    return {
      availability,
      process: resources?.host.getStatus() ?? null,
      cache: resources ? await resources.store.getStats().catch(() => null) : null
    }
  }

  async clearCache(): Promise<void> {
    const resources = await this.getResources()
    const processStatus = resources.host.getStatus()
    if (
      resources.extraction.hasActiveExtractions() ||
      resources.documentExtraction.hasActiveExtractions() ||
      processStatus.queuedRequests > 0 ||
      processStatus.state === 'starting' ||
      processStatus.state === 'busy' ||
      processStatus.state === 'stopping'
    ) {
      throw new OcrRuntimeBusyError()
    }
    await resources.store.clear()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const resources = await this.resourcesPromise?.catch(() => null)
    if (!resources) return
    resources.extraction.close()
    resources.documentExtraction.close()
    resources.scheduler.close()
    await resources.host.close()
    await resources.store.close()
  }

  private async getResources(): Promise<RuntimeResources> {
    if (this.closed) throw new Error('OCR runtime service is closed')
    this.resourcesPromise ??= this.createResources()
    try {
      return await this.resourcesPromise
    } catch (error) {
      this.resourcesPromise = null
      throw error
    }
  }

  private async createResources(): Promise<RuntimeResources> {
    const availability = await this.getAvailability()
    if (availability.status === 'unavailable') {
      throw new Error(`OCR runtime unavailable: ${availability.reason}`)
    }
    if (this.closed) throw new Error('OCR runtime service is closed')

    const cacheDir = path.join(this.options.userDataDir, 'ocr')
    await mkdir(cacheDir, { recursive: true, mode: 0o700 })
    let host: LightOcrProcessHost | null = null
    let store: OcrArtifactStore | null = null
    let extraction: ImageTextExtractionService | null = null
    let documentExtraction: DocumentTextExtractionService | null = null
    let scheduler: OcrExtractionScheduler | null = null
    try {
      host = new LightOcrProcessHost({
        nodeExecutable: availability.assets.nodeExecutable,
        helperEntryPath: availability.assets.helperEntryPath,
        bundlePath: availability.assets.bundlePath,
        expectedBundleId: availability.assets.bundleId,
        nativePackageDir: availability.assets.nativePackageDir,
        nativePayloadEncoding: availability.assets.nativePayloadEncoding,
        tempBaseDir: this.options.tempBaseDir
      })
      store = new OcrArtifactStore({
        dbPath: path.join(cacheDir, 'ocr-cache.db'),
        keyProvider: new SafeStorageOcrCacheKeyProvider(path.join(cacheDir, 'cache-key.json'))
      })
      scheduler = new OcrExtractionScheduler()
      const snapshotBudget = new OcrSourceSnapshotBudget()
      extraction = new ImageTextExtractionService({
        processHost: host,
        artifactStore: store,
        scheduler,
        closeSchedulerOnClose: false,
        snapshotBudget,
        lightOcrVersion: availability.assets.lightOcrVersion,
        bundleId: availability.assets.bundleId,
        onDiagnostic: this.options.onDiagnostic
      })
      documentExtraction = new DocumentTextExtractionService({
        processHost: host,
        artifactStore: store,
        scheduler,
        closeSchedulerOnClose: false,
        snapshotBudget,
        facadeVersion: availability.assets.lightOcrVersion,
        bundleId: availability.assets.bundleId,
        onDiagnostic: this.options.onDiagnostic
      })
      if (this.closed) throw new Error('OCR runtime service is closed')
      return { host, store, scheduler, extraction, documentExtraction }
    } catch (error) {
      extraction?.close()
      documentExtraction?.close()
      scheduler?.close()
      await Promise.allSettled([host?.close(), store?.close()])
      throw error
    }
  }
}
