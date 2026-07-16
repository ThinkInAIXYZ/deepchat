export { bindCapability as createCapabilityFragment } from './support/memoryFakes'

export function createControlledPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

export function createMemoryDiagnosticsProbe() {
  const samples: Array<{ method: string; args: unknown[] }> = []
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      samples.push({ method, args })
    }
  return {
    samples,
    recordRecall: record('recordRecall'),
    recordExtraction: record('recordExtraction'),
    recordEmbedding: record('recordEmbedding'),
    recordMaintenance: record('recordMaintenance'),
    observeExtractionQueue: record('observeExtractionQueue'),
    observeEmbeddingBacklog: record('observeEmbeddingBacklog'),
    recordVectorOutcome: record('recordVectorOutcome'),
    recordProviderAdmissionDecision: record('recordProviderAdmissionDecision'),
    recordProviderRaceEvent: record('recordProviderRaceEvent')
  }
}

export function createMemoryServiceHarness<Fragments extends Record<string, object>>(
  fragments: Fragments
): Fragments & {
  compose<Names extends keyof Fragments>(names: readonly Names[]): Fragments[Names]
} {
  return {
    ...fragments,
    compose(names) {
      return Object.assign({}, ...names.map((name) => fragments[name])) as Fragments[Names]
    }
  }
}
