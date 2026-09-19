export async function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return await promise
  }

  // Observe the source before checking the signal. The caller may have created the promise in an
  // expression that synchronously aborted the signal, and that source can still reject later.
  void promise.catch(() => undefined)
  signal.throwIfAborted()

  let abortListener: (() => void) | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abortListener = () => {
          try {
            signal.throwIfAborted()
          } catch (error) {
            reject(error)
          }
        }
        signal.addEventListener('abort', abortListener, { once: true })
        if (signal.aborted) abortListener()
      })
    ])
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener)
  }
}
