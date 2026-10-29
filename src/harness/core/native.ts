import { deserialize, serialize } from 'node:v8'
import {
  CORE_NATIVE_CALLS,
  CORE_NATIVE_QUEUED,
  CORE_VALUE_BYTES,
  isCoreNativeDrain,
  type CoreNativeMethod,
  type CorePayload
} from '@shared/harness/core'
import type { CorePayloadStore } from './payload'

export class CoreNativeCalls {
  private ordinary = 0
  private control = 0
  private queued = 0
  private queuedBytes = 0
  private changed = Promise.withResolvers<void>()
  private readonly active = new Set<Promise<unknown>>()

  constructor(
    private readonly store: CorePayloadStore,
    private readonly invoke: (
      method: CoreNativeMethod,
      payload: CorePayload
    ) => Promise<CorePayload>,
    private readonly isStopping: () => boolean
  ) {}

  call(method: CoreNativeMethod, args: unknown[]): Promise<unknown> {
    const operation = this.execute(method, args)
    this.active.add(operation)
    void operation.then(
      () => this.active.delete(operation),
      () => this.active.delete(operation)
    )
    return operation
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.active)
  }

  private async execute(method: CoreNativeMethod, args: unknown[]): Promise<unknown> {
    const control = isCoreNativeDrain(method, args)
    const assertActive = () => {
      if (this.isStopping() && !control) throw new Error('Core Native admission is stopping')
    }
    assertActive()
    const full = () => (control ? this.control >= 2 : this.ordinary >= CORE_NATIVE_CALLS - 2)
    if (full()) {
      if (this.queued >= CORE_NATIVE_QUEUED) throw new Error('Core Native request queue exceeded')
      const snapshot = (() => {
        const encoded = serialize(args)
        return { bytes: encoded.length, value: deserialize(encoded) as unknown[] }
      })()
      if (this.queuedBytes + snapshot.bytes > CORE_VALUE_BYTES)
        throw new Error('Core Native queued payload limit exceeded')
      args = snapshot.value
      this.queued++
      this.queuedBytes += snapshot.bytes
      try {
        while (full()) {
          await this.changed.promise
          assertActive()
        }
      } finally {
        this.queued--
        this.queuedBytes -= snapshot.bytes
      }
    }
    if (control) this.control++
    else this.ordinary++
    let ref: CorePayload | undefined
    try {
      ref = await this.store.encode(args)
      assertActive()
      return await this.store.decode(await this.invoke(method, ref))
    } finally {
      if (control) this.control--
      else this.ordinary--
      const changed = this.changed
      this.changed = Promise.withResolvers<void>()
      changed.resolve()
      if (ref) await this.store.release(ref)
    }
  }
}
