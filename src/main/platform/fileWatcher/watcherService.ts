import { WatcherPool } from './watcherPool'
import type {
  IFileWatcherService,
  WatchBatchListener,
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
