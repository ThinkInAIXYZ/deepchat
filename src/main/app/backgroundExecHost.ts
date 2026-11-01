import path from 'node:path'
import { utilityProcess } from 'electron'
import type { BackgroundExecHost } from '@/agent/shared/process/backgroundExecSessionManager'
import {
  childProcessRegistry,
  observeProcessIdentity
} from '@/agent/shared/process/childProcessRegistry'
import { terminateProcessTreeByPid } from '@/agent/shared/process/processTree'

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
  const closed = Promise.withResolvers<void>()
  let exitCode: number | undefined
  let ownerPid: number | undefined
  let ownerIdentity: string | undefined
  let retirement: Promise<void> | undefined
  host.once('exit', (code) => {
    exitCode = code
    closed.resolve()
  })
  const kill = (): Promise<void> => {
    retirement ??= Promise.resolve().then(async () => {
      try {
        if (exitCode === undefined) host.kill()
      } finally {
        await closed.promise
      }
      if (ownerPid === undefined) return
      if (
        ownerIdentity &&
        !(await terminateProcessTreeByPid(ownerPid, {
          nativeIdentity: ownerIdentity,
          ownedGroup: false,
          graceMs: 2000
        }))
      )
        throw new Error('Background exec helper descendants did not retire')
      const recovery = await childProcessRegistry.reapStale('background-exec', { ownerPid })
      if (
        recovery.refused.length ||
        recovery.skipped.length ||
        childProcessRegistry.list('background-exec', ownerPid).length
      )
        throw new Error('Owned background execution did not retire')
    })
    return retirement
  }
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
        void kill().then(() => reject(error), reject)
      })
    const onSpawn = async () => {
      if (!Number.isSafeInteger(host.pid) || !host.pid || host.pid <= 0) {
        fail(new Error('Background exec helper has no owned PID'))
        return
      }
      ownerPid = host.pid
      if (process.platform === 'darwin') {
        try {
          const observed = await observeProcessIdentity(ownerPid)
          if (settled) return
          if (!observed.alive || !observed.nativeIdentity || exitCode !== undefined) {
            fail(new Error('Background exec helper has no native identity'))
            return
          }
          ownerIdentity = observed.nativeIdentity
        } catch (error) {
          fail(error)
          return
        }
      }
      settle(() =>
        resolve({
          get pid() {
            return ownerPid
          },
          postMessage(message) {
            host.postMessage(message)
          },
          kill,
          onMessage(listener) {
            host.on('message', listener)
          },
          onExit(listener) {
            if (exitCode === undefined) host.once('exit', listener)
            else {
              const code = exitCode
              queueMicrotask(() => listener(code))
            }
          },
          onError(listener) {
            host.on('error', listener)
          }
        })
      )
    }
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
