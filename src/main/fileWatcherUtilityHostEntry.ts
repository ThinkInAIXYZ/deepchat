import { runFileWatcherUtilityHostIfRequested } from './platform/fileWatcher/fileWatcherUtilityHost'

if (!runFileWatcherUtilityHostIfRequested()) {
  throw new Error('File watcher utility host entrypoint started outside a utility process.')
}
