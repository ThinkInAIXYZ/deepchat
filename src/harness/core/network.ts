import { setGlobalDispatcher } from 'undici'
import { applyProxyEnvironment, createGlobalFetchDispatcher } from '@/platform/fetchDispatcher'
import { CoreProxySnapshotSchema, type CoreProxySnapshot } from '@shared/harness/desktop'

type Dispatcher = ReturnType<typeof createGlobalFetchDispatcher>

export class CoreHttp {
  private snapshot: CoreProxySnapshot | undefined
  private current: Dispatcher | undefined
  private readonly retiring = new Map<Dispatcher, Promise<void>>()
  private closing: Promise<void> | undefined

  constructor(private readonly failed: (error: unknown) => void) {}

  apply(input: CoreProxySnapshot): void {
    if (this.closing) throw new Error('Core HTTP is stopping')
    const snapshot = CoreProxySnapshotSchema.parse(input)
    if (this.snapshot && snapshot.version < this.snapshot.version) return
    if (this.snapshot && snapshot.version === this.snapshot.version) {
      if (
        snapshot.proxyUrl !== this.snapshot.proxyUrl ||
        snapshot.noProxy !== this.snapshot.noProxy
      )
        throw new Error('Native proxy changed without a revision')
      return
    }
    if (
      this.snapshot &&
      snapshot.proxyUrl === this.snapshot.proxyUrl &&
      snapshot.noProxy === this.snapshot.noProxy
    ) {
      this.snapshot = snapshot
      return
    }
    const next = createGlobalFetchDispatcher(
      snapshot.proxyUrl === null
        ? undefined
        : {
            httpProxy: snapshot.proxyUrl,
            httpsProxy: snapshot.proxyUrl,
            noProxy: snapshot.noProxy
          }
    )
    const previous = this.current
    setGlobalDispatcher(next)
    applyProxyEnvironment(snapshot.proxyUrl, snapshot.noProxy)
    this.current = next
    this.snapshot = snapshot
    if (previous) {
      const retirement = previous
        .close()
        .catch(async () => await previous.destroy())
        .then(() => {
          this.retiring.delete(previous)
        })
      this.retiring.set(previous, retirement)
      void retirement.catch((error) => {
        if (!this.closing) this.failed(error)
      })
    }
  }

  getProxyUrl(): string | null {
    if (!this.snapshot || this.closing) throw new Error('Core HTTP is unavailable')
    return this.snapshot.proxyUrl
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    const dispatchers = [...this.retiring.keys(), ...(this.current ? [this.current] : [])]
    this.closing = (async () => {
      const results = await Promise.allSettled(
        dispatchers.map(
          async (dispatcher) => await dispatcher.destroy(new Error('Core HTTP is stopping'))
        )
      )
      await Promise.allSettled(this.retiring.values())
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : []
      )
      if (errors.length) throw new AggregateError(errors, 'Core HTTP did not retire')
      this.retiring.clear()
      this.current = undefined
    })()
    return this.closing
  }
}
