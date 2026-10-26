const MAX_AUTH_RESPONSE_BYTES = 8 * 1024 * 1024

export async function readAuthResponse(response: Response, signal: AbortSignal): Promise<Response> {
  signal.throwIfAborted()
  if (Number(response.headers.get('content-length')) > MAX_AUTH_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new Error('Provider auth response exceeds the size limit')
  }
  if (!response.body) return response
  const reader = response.body.getReader()
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => undefined)
  }
  signal.addEventListener('abort', abort, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      size += value.byteLength
      if (size > MAX_AUTH_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('Provider auth response exceeds the size limit')
      }
      chunks.push(value)
    }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  } finally {
    signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}
