import {
  BackgroundExecSessionManager,
  type BackgroundExecRpcRequest,
  type BackgroundExecRpcResponse
} from './backgroundExecSessionManager'

const EXEC_UTILITY_HOST_ARG = '--deepchat-exec-utility-host'

type ParentPort = {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
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

  parentPort.on('message', (message) => {
    if (!message || typeof message !== 'object') {
      return
    }
    const request = message as BackgroundExecRpcRequest
    if (request.type !== 'background-exec:request') {
      return
    }
    void handleRequest(manager, parentPort, request)
  })

  process.once('beforeExit', () => {
    void manager.shutdown()
  })

  return true
}
