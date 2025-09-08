import log from 'electron-log'
import { app } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'

// Configure log file path
// Use logger for recording instead of console
const userData = app?.getPath('userData') || ''
if (userData) {
  log.transports.file.resolvePathFn = () => path.join(userData, 'logs/main.log')
}

// Get logging switch status
let loggingEnabled = false

// Export method to set logging switch
export function setLoggingEnabled(enabled: boolean): void {
  loggingEnabled = enabled
  // If logging is disabled, set file log level to false
  log.transports.file.level = enabled ? 'info' : false
}

// Configure console logging
log.transports.console.level = is.dev ? 'debug' : 'info'

// Configure file logging
log.transports.file.level = 'info'
log.transports.file.maxSize = 1024 * 1024 * 10 // 10MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

// Create different level logging functions
const logger = {
  error: (...params: unknown[]) => log.error(...params),
  warn: (...params: unknown[]) => log.warn(...params),
  info: (...params: unknown[]) => log.info(...params),
  verbose: (...params: unknown[]) => log.verbose(...params),
  debug: (...params: unknown[]) => log.debug(...params),
  silly: (...params: unknown[]) => log.silly(...params),
  log: (...params: unknown[]) => log.info(...params)
}

// Intercept console methods and redirect to logger
function hookConsole() {
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
    trace: console.trace
  }

  // Replace console methods
  console.log = (...args: unknown[]) => {
    // Only log when logging is enabled or in development mode
    if (loggingEnabled || is.dev) {
      logger.info(...args)
    }
  }

  console.error = (...args: unknown[]) => {
    // Only log when logging is enabled or in development mode
    if (loggingEnabled || is.dev) {
      logger.error(...args)
    }
  }

  console.warn = (...args: unknown[]) => {
    // Only log when logging is enabled or in development mode
    if (loggingEnabled || is.dev) {
      logger.warn(...args)
    }
  }

  console.info = (...args: unknown[]) => {
    // Only log when logging is enabled or in development mode
    if (loggingEnabled || is.dev) {
      logger.info(...args)
    }
  }

  console.debug = (...args: unknown[]) => {
    // Only log when logging is enabled or in development mode
    if (loggingEnabled || is.dev) {
      logger.debug(...args)
    }
  }

  console.trace = (...args: unknown[]) => {
    // Only log when logging is enabled or in development mode
    if (loggingEnabled || is.dev) {
      logger.debug(...args)
    }
  }

  return originalConsole
}

// Export original console methods for restoration when needed
export const originalConsole = hookConsole()
export default logger
