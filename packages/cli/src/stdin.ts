import { CliClientError, CLI_EXIT_CODES } from './errors'

export const MAX_CLI_STDIN_BYTES = 4 * 1024 * 1024

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new CliClientError('cancelled', 'CLI input was cancelled', CLI_EXIT_CODES.cancelled)
}

export async function readBoundedUtf8Stdin(
  stream: NodeJS.ReadableStream,
  signal: AbortSignal,
  maxBytes = MAX_CLI_STDIN_BYTES
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Invalid CLI stdin byte limit')
  }
  if (signal.aborted) throw abortReason(signal)

  const chunks: Buffer[] = []
  let size = 0
  const destroy = (error: Error) => {
    const destroyable = stream as NodeJS.ReadableStream & { destroy?: (error?: Error) => void }
    destroyable.destroy?.(error)
  }
  const onAbort = () => destroy(abortReason(signal))
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    for await (const rawChunk of stream as AsyncIterable<string | Uint8Array>) {
      if (signal.aborted) throw abortReason(signal)
      const chunk = Buffer.from(rawChunk)
      size += chunk.length
      if (size > maxBytes) {
        throw new CliClientError(
          'body_too_large',
          'Standard input exceeds the CLI byte limit',
          CLI_EXIT_CODES.usage
        )
      }
      chunks.push(chunk)
    }
  } catch (error) {
    if (signal.aborted) throw abortReason(signal)
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))
  } catch {
    throw new CliClientError(
      'invalid_request',
      'Standard input is not valid UTF-8',
      CLI_EXIT_CODES.usage
    )
  }
}
