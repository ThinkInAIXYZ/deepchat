/**
 * DeepChat MCP Node runtime.
 *
 * The root export is Node-only: it depends on `node:` builtins, `process.env`, Node stdio
 * transports and child-process lifecycle. It is not browser- or renderer-safe, and no subpath
 * promises a portable surface yet.
 */
export * from './client.js'
export * from './manager.js'
export * from './identity.js'
export * from './schemaValidation.js'
export * from './environmentBindings.js'
export * from './processEnvironment.js'
export * from './ports.js'
export * from './stdio.js'
