import { FileWatcherHost } from './watcherHost'
import type { FileWatcherRpcRequest, FileWatcherRpcResponse } from './watcherTypes'

const FILE_WATCHER_HOST_ARG = '--deepchat-file-watcher-host'

type ParentPort = {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
  start?(): void
}

type ParentPortMessageEvent = {
  data?: unknown
}

function getParentPort(): ParentPort | null {
  const maybeProcess = process as NodeJS.Process & {
    parentPort?: ParentPort
  }
  return maybeProcess.parentPort ?? null
}

function isFileWatcherHostRequest(): boolean {
  return (
    process.env.DEEPCHAT_FILE_WATCHER_HOST === '1' || process.argv.includes(FILE_WATCHER_HOST_ARG)
  )
}

function getParentPortMessagePayload(message: unknown): unknown {
  if (isFileWatcherRpcRequest(message)) {
    return message
  }

  if (message && typeof message === 'object' && 'data' in message) {
    return (message as ParentPortMessageEvent).data
  }

  return message
}

function serializeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    }
  }

  return {
    message: String(error)
  }
}

function isFileWatcherRpcRequest(message: unknown): message is FileWatcherRpcRequest {
  return (
    Boolean(message) &&
    typeof message === 'object' &&
    (message as FileWatcherRpcRequest).type === 'file-watcher:request'
  )
}

function sendResponse(parentPort: ParentPort, response: FileWatcherRpcResponse): void {
  parentPort.postMessage(response)
}

async function handleRequest(
  host: FileWatcherHost,
  parentPort: ParentPort,
  request: FileWatcherRpcRequest
): Promise<void> {
  try {
    const target = host as unknown as Record<string, (...args: unknown[]) => unknown>
    const method = target[request.method]
    if (typeof method !== 'function') {
      throw new Error(`Unknown file watcher method: ${request.method}`)
    }

    const data = await method.apply(host, request.args)
    sendResponse(parentPort, {
      type: 'file-watcher:response',
      id: request.id,
      ok: true,
      data
    })
  } catch (error) {
    sendResponse(parentPort, {
      type: 'file-watcher:response',
      id: request.id,
      ok: false,
      error: serializeError(error)
    })
  }
}

export function runFileWatcherUtilityHostIfRequested(): boolean {
  if (!isFileWatcherHostRequest()) {
    return false
  }

  const parentPort = getParentPort()
  if (!parentPort) {
    throw new Error('File watcher utility host started without a parent port.')
  }

  const host = new FileWatcherHost({
    postMessage: (message) => parentPort.postMessage(message)
  })
  const keepAliveIntervalId = setInterval(() => {}, 2 ** 31 - 1)
  parentPort.start?.()

  parentPort.on('message', (message) => {
    const request = getParentPortMessagePayload(message)
    if (!isFileWatcherRpcRequest(request)) {
      return
    }
    void handleRequest(host, parentPort, request)
  })

  process.once('beforeExit', () => {
    clearInterval(keepAliveIntervalId)
    void host.shutdown()
  })

  return true
}
