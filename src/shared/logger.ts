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

// A development build is one that was not packaged. Vite replaces
// `import.meta.env.DEV` in renderer bundles; main and the Node sidecar fall back
// to NODE_ENV. This keeps the shared logger free of Electron imports so the same
// module runs in both runtimes.
const isDev =
  typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined'
    ? import.meta.env.DEV
    : process.env.NODE_ENV === 'development'

const debug = (...params: unknown[]): void => {
  if (isDev) originalConsole.debug(...params)
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
