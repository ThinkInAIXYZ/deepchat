import { registerHooks } from 'node:module'

const FORBIDDEN_SPECIFIERS = new Set([
  'electron',
  'better-sqlite3',
  'better-sqlite3-multiple-ciphers',
  'node-pty'
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (FORBIDDEN_SPECIFIERS.has(specifier)) {
      // Report to stderr here (in-thread) so the interception stays observable even when the
      // caller swallows the rejection; exitCode set in-thread survives caught dynamic imports.
      console.error(`forbidden import intercepted: '${specifier}' is banned in the agent kernel`)
      process.exitCode = 1
      const error = new Error(
        `forbidden import intercepted: '${specifier}' is banned in the clean-Node agent kernel`
      )
      error.code = 'ERR_FORBIDDEN_IMPORT'
      throw error
    }
    return nextResolve(specifier, context)
  }
})
