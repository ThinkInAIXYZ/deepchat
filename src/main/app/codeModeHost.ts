import path from 'node:path'
import { app, utilityProcess } from 'electron'
import type { CodeModeHost } from '@/tool/codeMode/runCodeRuntimeManager'

export async function spawnCodeModeHost(entry: string, signal: AbortSignal): Promise<CodeModeHost> {
  if (!path.isAbsolute(entry)) throw new Error('Code Mode helper entry must be absolute')
  signal.throwIfAborted()
  const env: Record<string, string> = { DEEPCHAT_CODE_MODE_HOST: '1' }
  for (const name of ['LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot']) {
    const value = process.env[name]
    if (value) env[name] = value
  }
  const host = utilityProcess.fork(entry, ['--deepchat-code-mode-host'], {
    serviceName: 'DeepChat Code Mode Cell',
    stdio: 'ignore',
    env,
    execArgv: ['--max-old-space-size=64'],
    allowLoadingUnsignedLibraries: false
  })
  if (signal.aborted) {
    host.kill()
    signal.throwIfAborted()
  }
  const events: NodeJS.EventEmitter = host
  return {
    get pid() {
      return host.pid
    },
    postMessage(message) {
      host.postMessage(message)
    },
    kill() {
      host.kill()
    },
    on(event, listener) {
      events.on(event, listener)
    },
    off(event, listener) {
      events.off(event, listener)
    },
    async getRssBytes(requestSignal) {
      requestSignal.throwIfAborted()
      if (!host.pid) return null
      const metric = app.getAppMetrics().find((entry) => entry.pid === host.pid)
      requestSignal.throwIfAborted()
      return metric ? metric.memory.workingSetSize * 1024 : null
    }
  }
}
