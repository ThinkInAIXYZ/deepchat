/**
 * The small parent-port surface shared by DeepChat utility hosts.
 *
 * Electron exposes it as `process.parentPort`; a plain Node child process uses
 * `process.send` and `process.on('message')` instead. Keeping the adaptation here
 * lets the utility hosts run unchanged under either runtime.
 */
export type UtilityParentPort = {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
  start?(): void
}

export function getUtilityParentPort(): UtilityParentPort | null {
  const maybeProcess = process as NodeJS.Process & {
    parentPort?: UtilityParentPort
  }
  if (maybeProcess.parentPort) {
    return maybeProcess.parentPort
  }
  if (typeof process.send !== 'function') {
    return null
  }

  return {
    postMessage(message) {
      process.send?.(message)
    },
    on(event, listener) {
      process.on(event, listener)
    }
  }
}
