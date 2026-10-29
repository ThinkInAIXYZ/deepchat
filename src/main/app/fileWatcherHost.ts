import path from 'node:path'
import { utilityProcess } from 'electron'
import type { FileWatcherHost } from '@/platform/fileWatcher/watcherHostClient'
import type { WatcherHostKind } from '@/platform/fileWatcher/watcherTypes'

export async function spawnFileWatcherHost(
  entry: string,
  kind: WatcherHostKind,
  signal: AbortSignal
): Promise<FileWatcherHost> {
  if (!path.isAbsolute(entry)) throw new Error('File watcher helper entry must be absolute')
  signal.throwIfAborted()
  const host = utilityProcess.fork(entry, ['--deepchat-file-watcher-host'], {
    serviceName: `DeepChat ${kind === 'git' ? 'Git' : 'Content'} File Watcher`,
    stdio: 'ignore',
    env: {
      ...process.env,
      DEEPCHAT_FILE_WATCHER_HOST: '1',
      DEEPCHAT_FILE_WATCHER_HOST_KIND: kind
    }
  })
  const closed = Promise.withResolvers<void>()
  let exited = false
  let termination: Promise<void> | undefined
  host.once('exit', () => {
    exited = true
    closed.resolve()
  })
  const terminate = (): Promise<void> => {
    termination ??= (async () => {
      try {
        if (!exited) host.kill()
      } finally {
        await closed.promise
      }
    })()
    return termination
  }
  return await new Promise<FileWatcherHost>((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      host.off('spawn', onSpawn)
      host.off('exit', onExit)
      host.off('error', onError)
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const fail = (error: unknown) =>
      settle(() => {
        void terminate().then(() => reject(error), reject)
      })
    const onSpawn = () =>
      settle(() =>
        resolve({
          postMessage(message) {
            host.postMessage(message)
          },
          onMessage(listener) {
            host.on('message', listener)
          },
          onExit(listener) {
            host.on('exit', listener)
          },
          onError(listener) {
            host.on('error', listener)
          },
          terminate
        })
      )
    const onExit = (code: number) =>
      fail(new Error(`File watcher helper exited before spawn: ${code}`))
    const onError = (type: string, location: string) =>
      fail(new Error(`File watcher helper error: ${type} at ${location}`))
    const onAbort = () => fail(signal.reason)
    host.once('spawn', onSpawn)
    host.once('exit', onExit)
    host.once('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}
