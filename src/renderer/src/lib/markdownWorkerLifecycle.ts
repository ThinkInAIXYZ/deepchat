/**
 * Markdown Worker Lifecycle
 *
 * Provides idempotent lazy initialization for KaTeX and Mermaid web workers.
 * Workers are created on first use rather than during renderer startup,
 * improving cold start performance.
 */

import {
  clearKaTeXWorker,
  clearMermaidWorker,
  setKaTeXWorker,
  setMermaidWorker,
  terminateWorker
} from 'markstream-vue'

// Dynamic worker imports - only loaded when needed
let KatexWorkerConstructor: (new () => Worker) | null = null
let MermaidWorkerConstructor: (new () => Worker) | null = null

interface MarkdownWorkers {
  katex: Worker
  mermaid: Worker
}

const globalScope = globalThis as typeof globalThis & {
  __markdownWorkers?: MarkdownWorkers
}

let initialized = false
let cleanupRegistered = false

/**
 * Tear down any live workers and reset the markstream-vue bindings.
 * Shared by the beforeunload handler and the test reset helper so both paths
 * release the same resources instead of merely flipping module flags.
 */
function cleanupMarkdownWorkers(): void {
  const workers = globalScope.__markdownWorkers
  if (workers) {
    workers.katex.terminate()
    workers.mermaid.terminate()
    globalScope.__markdownWorkers = undefined
  }
  clearKaTeXWorker()
  clearMermaidWorker()
  terminateWorker()
  initialized = false
}

/**
 * Reset lifecycle state for testing.
 *
 * Actually terminates live workers and removes the registered beforeunload
 * listener so subsequent tests start from a clean lifecycle instead of reusing
 * leaked workers/listeners.
 * @internal
 */
export function _resetForTesting(): void {
  cleanupMarkdownWorkers()
  if (cleanupRegistered) {
    window.removeEventListener('beforeunload', cleanupMarkdownWorkers)
    cleanupRegistered = false
  }
  KatexWorkerConstructor = null
  MermaidWorkerConstructor = null
}

/**
 * Dynamically load worker constructors.
 * Uses Vite's ?worker&inline syntax for bundling.
 */
async function loadWorkerConstructors(): Promise<void> {
  if (KatexWorkerConstructor && MermaidWorkerConstructor) {
    return
  }

  try {
    const [katexModule, mermaidModule] = await Promise.all([
      import('markstream-vue/workers/katexRenderer.worker?worker&inline'),
      import('markstream-vue/workers/mermaidParser.worker?worker&inline')
    ])

    KatexWorkerConstructor = katexModule.default
    MermaidWorkerConstructor = mermaidModule.default
  } catch (error) {
    console.error('Failed to load markdown worker constructors:', error)
    throw error
  }
}

/**
 * Register cleanup handler for page unload.
 * Idempotent - only registers once.
 */
function registerCleanup(): void {
  if (cleanupRegistered) {
    return
  }

  cleanupRegistered = true

  window.addEventListener('beforeunload', cleanupMarkdownWorkers)
}

/**
 * Ensure markdown workers are initialized.
 * Idempotent - workers are created only once on first call.
 *
 * @returns Promise that resolves when workers are ready
 */
export async function ensureMarkdownWorkers(): Promise<void> {
  // Already initialized - fast path
  if (initialized && globalScope.__markdownWorkers) {
    return
  }

  // Another call is initializing - wait for it
  if (globalScope.__markdownWorkers) {
    initialized = true
    return
  }

  try {
    // Load worker constructors dynamically
    await loadWorkerConstructors()

    if (!KatexWorkerConstructor || !MermaidWorkerConstructor) {
      throw new Error('Worker constructors not available after loading')
    }

    // Create workers (guarded by globalThis for duplicate prevention)
    if (!globalScope.__markdownWorkers) {
      const katex = new KatexWorkerConstructor()
      const mermaid = new MermaidWorkerConstructor()
      globalScope.__markdownWorkers = { katex, mermaid }

      // Register with markstream-vue library
      setKaTeXWorker(katex)
      setMermaidWorker(mermaid)
    }

    initialized = true

    // Register cleanup handler
    registerCleanup()
  } catch (error) {
    console.error('Failed to initialize markdown workers:', error)
    throw error
  }
}

/**
 * Check if markdown workers are currently initialized.
 * Useful for testing and diagnostics.
 */
export function areMarkdownWorkersInitialized(): boolean {
  return initialized && !!globalScope.__markdownWorkers
}
