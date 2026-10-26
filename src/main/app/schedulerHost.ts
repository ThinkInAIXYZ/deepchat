import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, utilityProcess } from 'electron'
import type { SchedulerHost } from '@/scheduler/schedulerProcessManager'

export async function spawnSchedulerHost(signal: AbortSignal): Promise<SchedulerHost> {
  signal.throwIfAborted()
  const modulePath = fileURLToPath(import.meta.url)
  const appPath = app.getAppPath()
  const candidates = [
    path.join(appPath, 'out/main/schedulerUtilityHost.js'),
    path.join(appPath, 'schedulerUtilityHost.js'),
    path.resolve(path.dirname(modulePath), 'schedulerUtilityHost.js'),
    path.resolve(path.dirname(modulePath), '../schedulerUtilityHost.js'),
    path.resolve(process.cwd(), 'out/main/schedulerUtilityHost.js')
  ]
  const entry = candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  const host = utilityProcess.fork(entry, ['--deepchat-cron-scheduler-host'], {
    serviceName: 'DeepChat Cron Jobs Scheduler',
    stdio: 'ignore',
    env: { ...process.env, DEEPCHAT_CRON_SCHEDULER_HOST: '1' }
  })

  return await new Promise<SchedulerHost>((resolve, reject) => {
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
    const fail = (error: Error) =>
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
          postMessage(command) {
            host.postMessage(command)
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
      fail(new Error(`Cron scheduler utility exited before spawn: ${code}`))
    const onError = (type: string, location: string) =>
      fail(new Error(`Scheduler utility process error: ${type} at ${location}`))
    const onAbort = () => fail(new Error('Scheduler utility spawn canceled.'))

    host.once('spawn', onSpawn)
    host.once('exit', onExit)
    host.once('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}
