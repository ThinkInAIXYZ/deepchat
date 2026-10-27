import path from 'node:path'
import { utilityProcess } from 'electron'
import type { BackgroundExecHost } from '@/agent/shared/process/backgroundExecSessionManager'

export async function spawnBackgroundExecHost(
  entry: string,
  signal: AbortSignal
): Promise<BackgroundExecHost> {
  if (!path.isAbsolute(entry)) throw new Error('Background exec helper entry must be absolute')
  signal.throwIfAborted()
  const host = utilityProcess.fork(entry, ['--deepchat-exec-utility-host'], {
    serviceName: 'DeepChat Exec Utility',
    stdio: 'ignore',
    env: { ...process.env, DEEPCHAT_EXEC_UTILITY_HOST: '1' }
  })
  return new Promise<BackgroundExecHost>((resolve, reject) => {
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
        try {
          host.kill()
        } catch {}
        reject(error)
      })
    const onSpawn = () =>
      settle(() =>
        resolve({
          get pid() {
            return host.pid
          },
          postMessage(message) {
            host.postMessage(message)
          },
          kill() {
            host.kill()
          },
          onMessage(listener) {
            host.on('message', listener)
          },
          onExit(listener) {
            host.on('exit', listener)
          },
          onError(listener) {
            host.on('error', listener)
          }
        })
      )
    const onExit = (code: number) =>
      fail(new Error(`Background exec helper exited before spawn: ${code}`))
    const onError = (type: string, location: string) =>
      fail(new Error(`Background exec helper error: ${type} at ${location}`))
    const onAbort = () => fail(signal.reason)
    host.once('spawn', onSpawn)
    host.once('exit', onExit)
    host.once('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}
