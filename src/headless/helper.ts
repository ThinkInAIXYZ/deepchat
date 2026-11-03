import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { serialize } from 'node:v8'
import { fileURLToPath } from 'node:url'
import {
  isMainThread,
  parentPort as workerParent,
  workerData,
  Worker,
  type MessagePort
} from 'node:worker_threads'
import { CORE_HELPER_QUEUE, CORE_HELPER_QUEUE_BYTES } from '@shared/harness/helpers'

let sending = 0
let sendingBytes = 0

function retainMessage(message: unknown): () => void {
  const bytes = serialize(message).length
  if (sending >= CORE_HELPER_QUEUE || sendingBytes + bytes > CORE_HELPER_QUEUE_BYTES)
    throw new Error('Headless helper send queue exceeded')
  sending++
  sendingBytes += bytes
  let released = false
  return () => {
    if (released) return
    released = true
    sending--
    sendingBytes -= bytes
  }
}

function createCodePort(port: MessagePort | Worker, failed: (error: unknown) => void) {
  const messages = new EventEmitter()
  const sends = new Map<number, () => void>()
  let sequence = 0
  port.on('message', (message: unknown) => {
    try {
      if (
        !message ||
        typeof message !== 'object' ||
        !('id' in message) ||
        typeof message.id !== 'number' ||
        !Number.isSafeInteger(message.id) ||
        message.id <= 0 ||
        !('type' in message)
      )
        throw new Error('Invalid Code worker delivery')
      if (message.type === 'received') {
        const release = sends.get(message.id)
        if (!release) throw new Error('Unknown Code worker delivery receipt')
        sends.delete(message.id)
        release()
      } else if (message.type === 'delivery' && 'value' in message) {
        messages.emit('message', message.value)
        // Receipts are bounded by the peer's outstanding deliveries and never reach the VM.
        port.postMessage({ type: 'received', id: message.id })
      } else throw new Error('Invalid Code worker delivery')
    } catch (error) {
      failed(error)
    }
  })
  return {
    postMessage(message: unknown) {
      let release: (() => void) | undefined
      const id = ++sequence
      try {
        release = retainMessage(message)
        sends.set(id, release)
        port.postMessage({ type: 'delivery', id, value: message })
      } catch (error) {
        sends.delete(id)
        release?.()
        failed(error)
      }
    },
    on(_event: 'message', listener: (message: unknown) => void) {
      messages.on('message', listener)
    }
  }
}

async function runHelper(): Promise<void> {
  if (!process.send) throw new Error('Headless helper requires an owned IPC channel')
  const kind = process.argv[2]
  const messages = new EventEmitter()
  const startup = Promise.withResolvers<void>()
  const requests = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
  let shutdown: Promise<void> | undefined
  let shutdownId: string | undefined
  let shutdownReceipt: ReturnType<typeof Promise.withResolvers<void>> | undefined
  let worker: Worker | undefined
  let hostStarted = false
  let failure = false

  const fail = (error: unknown) => {
    if (failure) return
    failure = true
    console.error(error)
    requestStop()
  }
  const parentPort = {
    postMessage(message: unknown) {
      if (
        message &&
        typeof message === 'object' &&
        'id' in message &&
        typeof message.id === 'string'
      ) {
        requests.get(message.id)?.resolve()
        requests.delete(message.id)
        if (message.id === shutdownId) {
          if ('ok' in message && message.ok === false)
            shutdownReceipt?.reject(new Error('Headless helper shutdown failed'))
          else shutdownReceipt?.resolve()
          return
        }
      }
      if (!process.connected) return
      let release: (() => void) | undefined
      try {
        release = retainMessage(message)
        const delivered = release
        process.send!(message, (error) => {
          delivered()
          if (error && !shutdown) fail(error)
        })
      } catch (error) {
        release?.()
        fail(error)
      }
    },
    on(_event: 'message', listener: (message: unknown) => void) {
      messages.on('message', listener)
    }
  }
  Object.defineProperty(process, 'parentPort', { value: parentPort })

  function stop(): Promise<void> {
    shutdown ??= Promise.resolve().then(async () => {
      await startup.promise
      if (worker) await worker.terminate()
      else if (hostStarted && (kind === 'exec' || kind === 'content' || kind === 'git')) {
        shutdownId = randomUUID()
        shutdownReceipt = Promise.withResolvers<void>()
        messages.emit('message', {
          type: kind === 'exec' ? 'background-exec:request' : 'file-watcher:request',
          id: shutdownId,
          method: 'shutdown',
          args: []
        })
        await shutdownReceipt.promise
        await Promise.all([...requests.values()].map((request) => request.promise))
        if (kind === 'exec') {
          const { childProcessRegistry } =
            await import('@/agent/shared/process/childProcessRegistry')
          const recovery = await childProcessRegistry.reapStale('background-exec', {
            ownerPid: process.pid
          })
          if (
            recovery.refused.length ||
            recovery.skipped.length ||
            childProcessRegistry.list('background-exec', process.pid).length
          )
            throw new Error('Disconnected headless background execution did not retire')
        }
      }
      process.exit(failure ? 1 : 0)
    })
    return shutdown
  }

  function requestStop(): void {
    void stop().catch((error) => {
      console.error(error)
      process.exit(1)
    })
  }

  process.on('message', (message: unknown) => {
    if (shutdown) return
    if (message && typeof message === 'object' && 'type' in message) {
      if (message.type === 'deepchat-headless:stop') {
        requestStop()
        return
      }
      if (message.type === 'deepchat-headless:rss' && 'id' in message) {
        parentPort.postMessage({
          type: 'deepchat-headless:rss',
          id: message.id,
          bytes: process.memoryUsage().rss
        })
        return
      }
      if (
        (message.type === 'background-exec:request' || message.type === 'file-watcher:request') &&
        'id' in message &&
        typeof message.id === 'string'
      )
        requests.set(message.id, Promise.withResolvers<void>())
    }
    messages.emit('message', message)
  })
  process.once('disconnect', requestStop)
  process.once('SIGTERM', requestStop)
  process.once('SIGINT', requestStop)

  try {
    switch (kind) {
      case 'exec': {
        process.env.DEEPCHAT_EXEC_UTILITY_HOST = '1'
        const { runBackgroundExecUtilityHostIfRequested } =
          await import('@/agent/shared/process/backgroundExecUtilityHost')
        runBackgroundExecUtilityHostIfRequested()
        break
      }
      case 'code': {
        // Keep parent IPC responsive when an asynchronous VM continuation blocks its Worker.
        worker = new Worker(fileURLToPath(import.meta.url), {
          workerData: 'code',
          resourceLimits: { maxOldGenerationSizeMb: 64 }
        })
        const ready = Promise.withResolvers<void>()
        worker.once('error', (error) => {
          ready.reject(error)
          fail(error)
        })
        worker.once('exit', (code) => {
          ready.reject(new Error(`Code worker exited during startup: ${code}`))
          if (!shutdown) process.exit(code)
        })
        const codePort = createCodePort(worker, fail)
        codePort.on('message', (message) => {
          parentPort.postMessage(message)
          if (
            message &&
            typeof message === 'object' &&
            'type' in message &&
            message.type === 'READY'
          )
            ready.resolve()
        })
        messages.on('message', (message) => codePort.postMessage(message))
        await ready.promise
        break
      }
      case 'content':
      case 'git': {
        process.env.DEEPCHAT_FILE_WATCHER_HOST = '1'
        process.env.DEEPCHAT_FILE_WATCHER_HOST_KIND = kind
        const { runFileWatcherUtilityHostIfRequested } =
          await import('@/platform/fileWatcher/fileWatcherUtilityHost')
        runFileWatcherUtilityHostIfRequested()
        break
      }
      case 'scheduler': {
        process.env.DEEPCHAT_CRON_SCHEDULER_HOST = '1'
        const { runSchedulerUtilityHostIfRequested } =
          await import('@/scheduler/schedulerUtilityHost')
        runSchedulerUtilityHostIfRequested()
        break
      }
      default:
        throw new Error(`Unknown headless helper kind: ${kind}`)
    }
    hostStarted = true
  } catch (error) {
    fail(error)
  } finally {
    startup.resolve()
  }
  if (!process.connected) requestStop()
  else if (!shutdown) parentPort.postMessage({ type: 'deepchat-headless:ready' })
}

if (isMainThread) await runHelper()
else {
  if (workerData !== 'code' || !workerParent) throw new Error('Invalid headless Code worker')
  Object.defineProperty(process, 'parentPort', {
    value: createCodePort(workerParent, (error) => {
      console.error(error)
      process.exit(1)
    })
  })
  process.env.DEEPCHAT_CODE_MODE_HOST = '1'
  const { runCodeModeUtilityHost } = await import('@/tool/codeMode/codeModeUtilityHost')
  runCodeModeUtilityHost()
}
