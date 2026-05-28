import {
  BackgroundExecSessionManager,
  type BackgroundExecRpcRequest,
  type BackgroundExecRpcResponse
} from './backgroundExecSessionManager'

const EXEC_UTILITY_HOST_ARG = '--deepchat-exec-utility-host'

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

function isExecUtilityHostRequest(): boolean {
  return (
    process.env.DEEPCHAT_EXEC_UTILITY_HOST === '1' || process.argv.includes(EXEC_UTILITY_HOST_ARG)
  )
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

function sendResponse(parentPort: ParentPort, response: BackgroundExecRpcResponse): void {
  parentPort.postMessage(response)
}

function isBackgroundExecRpcRequest(message: unknown): message is BackgroundExecRpcRequest {
  return (
    Boolean(message) &&
    typeof message === 'object' &&
    (message as BackgroundExecRpcRequest).type === 'background-exec:request'
  )
}

export function getParentPortMessagePayload(message: unknown): unknown {
  if (isBackgroundExecRpcRequest(message)) {
    return message
  }

  if (message && typeof message === 'object' && 'data' in message) {
    return (message as ParentPortMessageEvent).data
  }

  return message
}

async function handleRequest(
  manager: BackgroundExecSessionManager,
  parentPort: ParentPort,
  request: BackgroundExecRpcRequest
): Promise<void> {
  try {
    const target = manager as unknown as Record<string, (...args: unknown[]) => unknown>
    const method = target[request.method]
    if (typeof method !== 'function') {
      throw new Error(`Unknown background exec method: ${request.method}`)
    }

    const data = await method.apply(manager, request.args)
    sendResponse(parentPort, {
      type: 'background-exec:response',
      id: request.id,
      ok: true,
      data
    })
  } catch (error) {
    sendResponse(parentPort, {
      type: 'background-exec:response',
      id: request.id,
      ok: false,
      error: serializeError(error)
    })
  }
}

export function runBackgroundExecUtilityHostIfRequested(): boolean {
  if (!isExecUtilityHostRequest()) {
    return false
  }

  const parentPort = getParentPort()
  if (!parentPort) {
    throw new Error('Background exec utility host started without a parent port.')
  }

  const manager = new BackgroundExecSessionManager()
  const keepAliveIntervalId = setInterval(() => {}, 2 ** 31 - 1)
  parentPort.start?.()

  parentPort.on('message', (message) => {
    const request = getParentPortMessagePayload(message)
    if (!isBackgroundExecRpcRequest(request)) {
      return
    }
    void handleRequest(manager, parentPort, request)
  })

  process.once('beforeExit', () => {
    clearInterval(keepAliveIntervalId)
    void manager.shutdown()
  })

  return true
}
