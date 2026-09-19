// Legacy Main diagnostics remain console-only until their owners are migrated or removed. Persisted
// diagnostics must go through the typed Main logger; arbitrary values must never reach a file sink.
export const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
  trace: console.trace.bind(console)
}

// Verbose output is off until a host entry enables it explicitly, so this module stays free of
// Electron/process detection and remains usable from a plain Node runtime.
let verboseEnabled = false

export function setVerboseLoggingEnabled(enabled: boolean): void {
  verboseEnabled = enabled
}

const debug = (...params: unknown[]): void => {
  if (verboseEnabled) originalConsole.debug(...params)
}

const logger = {
  error: originalConsole.error,
  warn: originalConsole.warn,
  info: originalConsole.info,
  verbose: debug,
  debug,
  silly: debug,
  log: originalConsole.info
}

export default logger
