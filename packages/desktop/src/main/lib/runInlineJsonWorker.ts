import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'

type InlineJsonWorkerResponse<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error: {
        message: string
        stack?: string
      }
    }

type RunInlineJsonWorkerOptions<TInput> = {
  name: string
  source: string
  input: TInput
  signal?: AbortSignal
}

function createAbortError(name: string): Error {
  const error = new Error(`Inline worker "${name}" was cancelled`)
  error.name = 'AbortError'
  return error
}

export async function runInlineJsonWorker<TInput, TOutput>({
  name,
  source,
  input,
  signal
}: RunInlineJsonWorkerOptions<TInput>): Promise<TOutput> {
  if (signal?.aborted) {
    throw createAbortError(name)
  }

  return await new Promise<TOutput>((resolve, reject) => {
    let settled = false
    const wrappedSource = `
const { createRequire } = require('node:module')
globalThis.__inlineWorkerRequire = createRequire(${JSON.stringify(fileURLToPath(import.meta.url))})
${source}
`

    const worker = new Worker(wrappedSource, {
      eval: true,
      name,
      workerData: input
    })

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', handleAbort)
      }
      worker.removeAllListeners()
    }

    const settleResolve = (value: TOutput) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(value)
    }

    const settleReject = (error: unknown) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }

    const handleAbort = () => {
      worker
        .terminate()
        .catch(() => {})
        .finally(() => {
          settleReject(createAbortError(name))
        })
    }

    worker.once('message', (response: InlineJsonWorkerResponse<TOutput>) => {
      if (!response || typeof response !== 'object') {
        settleReject(new Error(`Inline worker "${name}" returned an invalid response`))
        return
      }

      if (!response.ok) {
        const error = new Error(response.error.message)
        error.name = 'WorkerError'
        if (response.error.stack) {
          error.stack = response.error.stack
        }
        settleReject(error)
        return
      }

      settleResolve(response.data)
    })

    worker.once('error', (error) => {
      settleReject(error)
    })

    worker.once('exit', (code) => {
      if (!settled && code !== 0) {
        settleReject(new Error(`Inline worker "${name}" exited with code ${code}`))
      }
    })

    if (signal) {
      signal.addEventListener('abort', handleAbort, { once: true })
    }
  })
}
