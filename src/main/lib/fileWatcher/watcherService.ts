import { WatcherPool } from './watcherPool'
import type {
  IFileWatcherService,
  WatchBatchListener,
  WatcherHostKind,
  WatchHandle,
  WatchRequest,
  WatchStatusListener
} from './watcherTypes'

export class FileWatcherService implements IFileWatcherService {
  constructor(private readonly pool = new WatcherPool()) {}

  async watch(
    request: WatchRequest,
    onBatch: WatchBatchListener,
    onStatus?: WatchStatusListener
  ): Promise<WatchHandle> {
    return await this.pool.watch(request, onBatch, onStatus)
  }

  async destroy(): Promise<void> {
    await this.pool.destroy()
  }
}

let sharedWatcherService: FileWatcherService | null = null

export function getFileWatcherService(): FileWatcherService {
  sharedWatcherService ??= new FileWatcherService()
  return sharedWatcherService
}

export async function resetFileWatcherServiceForTests(): Promise<void> {
  if (sharedWatcherService) {
    await sharedWatcherService.destroy()
    sharedWatcherService = null
  }
}

export function createWatcherRequestId(
  kind: WatcherHostKind,
  purpose: string,
  rootPath: string
): string {
  return `${kind}:${purpose}:${rootPath}`
}
