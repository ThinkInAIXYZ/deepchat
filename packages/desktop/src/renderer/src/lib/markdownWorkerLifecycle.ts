/**
 * Markdown Worker Lifecycle
 *
 * Provides idempotent lazy initialization for KaTeX, Mermaid, and the
 * stream-diffs highlight worker pool. Workers are created on first use rather
 * than during renderer startup, improving cold start performance.
 */

import {
  clearKaTeXWorker,
  clearMermaidWorker,
  setKaTeXWorker,
  setMermaidWorker,
  setStreamDiffsWorkerPool,
  terminateStreamDiffsWorkerPool,
  terminateWorker,
  type StreamDiffsWorkerPoolLike
} from 'markstream-vue'

// Dynamic worker imports - only loaded when needed
let KatexWorkerConstructor: (new () => Worker) | null = null
let MermaidWorkerConstructor: (new () => Worker) | null = null
let DiffsWorkerConstructor: (new () => Worker) | null = null

// Shared worker pool for stream-diffs highlighting. When absent, markstream
// keeps Shiki tokenization on the main thread as a graceful fallback.
let diffsWorkerPool: StreamDiffsWorkerPoolLike | null = null

// Keep the highlight pool small; the worker itself does the heavy Shiki work.
// Four workers cover the typical concurrent code blocks in a streaming chat
// without excessive memory.
const STREAM_DIFFS_POOL_SIZE = 4

// Matches the renderer's code-block `themes` prop in MarkdownRenderer.
const STREAM_DIFFS_THEME = { dark: 'vitesse-dark', light: 'vitesse-light' } as const

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
  terminateStreamDiffsWorkerPool()
  // markstream-vue's terminate calls pool.terminate(), which resets the
  // @pierre/diffs WorkerPoolManager (initialized=false, workers/caches
  // cleared), so the cached singleton is safely re-initialized on the next
  // mount rather than reused in a dead state.
  diffsWorkerPool = null
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
  DiffsWorkerConstructor = null
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
 * Dynamically load the stream-diffs highlight worker constructor.
 * Emitted as a separate asset (not inlined) because it bundles the Shiki
 * highlighter and is significantly larger than the KaTeX/Mermaid workers.
 */
async function loadDiffsWorkerConstructor(): Promise<void> {
  if (DiffsWorkerConstructor) {
    return
  }

  try {
    const module = await import('@pierre/diffs/worker/worker.js?worker')
    DiffsWorkerConstructor = module.default
  } catch (error) {
    console.error('Failed to load stream-diffs worker constructor:', error)
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
 * Ensure the stream-diffs worker pool is created and injected into markstream.
 * Idempotent and failure-isolated: without a pool, markstream falls back to
 * main-thread highlighting, so an injection failure must not break the rest
 * of the markdown worker lifecycle.
 */
async function ensureStreamDiffsWorkerPool(): Promise<void> {
  if (diffsWorkerPool) {
    return
  }

  try {
    await loadDiffsWorkerConstructor()

    const DiffsWorker = DiffsWorkerConstructor
    if (!DiffsWorker) {
      throw new Error('Diffs worker constructor not available after loading')
    }

    const { getOrCreateWorkerPoolSingleton } = await import('@pierre/diffs/worker')
    const pool = getOrCreateWorkerPoolSingleton({
      poolOptions: {
        poolSize: STREAM_DIFFS_POOL_SIZE,
        workerFactory: () => new DiffsWorker()
      },
      highlighterOptions: {
        theme: STREAM_DIFFS_THEME
      }
    })

    // Register with markstream before caching locally so a registration
    // failure leaves diffsWorkerPool null and the next call retries.
    setStreamDiffsWorkerPool(pool)
    diffsWorkerPool = pool
  } catch (error) {
    console.error('Failed to initialize stream-diffs worker pool:', error)
    // If the @pierre/diffs singleton was already created, clear it so the next
    // call builds a fresh pool instead of reusing a half-initialized one.
    try {
      const { terminateWorkerPoolSingleton } = await import('@pierre/diffs/worker')
      terminateWorkerPoolSingleton()
    } catch {
      // Teardown failure is non-fatal; the pool is retried on next mount.
    }
  }
}

/**
 * Ensure markdown workers are initialized.
 * Idempotent - workers are created only once on first call.
 *
 * @returns Promise that resolves when workers are ready
 */
export async function ensureMarkdownWorkers(): Promise<void> {
  // Always (re)try the stream-diffs pool even on the fast path so a transient
  // injection failure is retried on the next renderer mount.
  await ensureStreamDiffsWorkerPool()

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
    // Tear down the already-injected stream-diffs pool so a failed lifecycle
    // leaves no half-initialized state and the next call retries from scratch.
    terminateStreamDiffsWorkerPool()
    diffsWorkerPool = null
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
