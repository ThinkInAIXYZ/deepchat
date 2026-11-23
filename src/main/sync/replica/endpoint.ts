import type http from 'node:http'
import path from 'node:path'
import { z } from 'zod'
import {
  SYNC_REPLICA_PREFIX,
  SYNC_PART_BYTES,
  SYNC_MAX_BATCH_BYTES,
  SyncBatchManifestSchema,
  type SyncBatchManifest
} from '@shared/contracts/syncReplica'
import type { SyncReplicaStore } from './store'
import { SyncBatchFiles } from './batches'
import { SyncNativeBatches, type SyncReplicaNativePort } from './nativeBatches'

const Query = z.object({ after: z.coerce.number().int().nonnegative().safe() })

export class SyncReplicaEndpoint {
  private notification: NodeJS.Timeout | null = null
  private readonly subscribers = new Map<string, Set<http.ServerResponse>>()
  private readonly uploads = new Map<string, SyncBatchManifest>()
  private readonly downloads = new Map<string, SyncBatchManifest>()
  private readonly active = new Set<string>()
  private readonly native: SyncNativeBatches
  private readonly files: SyncBatchFiles
  private readonly unsubscribe: () => void

  constructor(
    private readonly deps: {
      store: SyncReplicaStore
      native?: SyncReplicaNativePort
      directory: string
      hostId(): string
      available(): boolean
    }
  ) {
    this.files = new SyncBatchFiles(path.join(deps.directory, 'batches'))
    this.native = new SyncNativeBatches(path.join(deps.directory, 'replica-native'), deps.native)
    this.unsubscribe = deps.store.subscribe(() => {
      if (this.notification) return
      this.notification = setTimeout(() => {
        this.notification = null
        this.notify()
      }, 250)
      this.notification.unref()
    })
  }

  private notify(): void {
    if (!this.deps.available()) return
    for (const responses of this.subscribers.values()) {
      for (const response of responses) {
        if (
          !response.write(`data: ${JSON.stringify({ revision: this.deps.store.revision() })}\n\n`)
        )
          response.destroy()
      }
    }
  }

  revoke(device: string): void {
    for (const response of this.subscribers.get(device) ?? []) response.destroy()
    this.subscribers.delete(device)
    this.uploads.delete(device)
    this.downloads.delete(device)
  }

  stop(): void {
    if (this.notification) clearTimeout(this.notification)
    this.notification = null
    for (const device of this.subscribers.keys()) this.revoke(device)
    this.uploads.clear()
    this.downloads.clear()
  }

  close(): void {
    this.stop()
    this.unsubscribe()
  }

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    device: string,
    replicaId: string | null,
    authorized: () => boolean
  ): Promise<void> {
    const json = (status: number, value: unknown) => {
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      })
      response.end(JSON.stringify(value))
    }
    if (!this.deps.available()) {
      json(409, { error: 'unavailable' })
      return
    }
    const writable = authorized()
    if (!writable) {
      json(403, { error: 'writeConsentRequired' })
      return
    }
    if (!replicaId) {
      json(403, { error: 'rePairRequired' })
      return
    }
    const url = new URL(request.url ?? '/', 'http://localhost')
    const route = url.pathname.slice(SYNC_REPLICA_PREFIX.length)
    if (request.method === 'GET' && route === '/status') {
      const revision = this.deps.store.revision()
      json(200, {
        protocol: 2,
        hostId: this.deps.hostId(),
        replicaId: this.deps.store.replicaId,
        revision,
        writable,
        nativeProfiles: this.deps.native ? 1 : undefined
      })
      return
    }
    if (request.method === 'GET' && route === '/events') {
      this.revokeStream(device)
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no'
      })
      this.subscribers.set(device, new Set([response]))
      response.write(`data: ${JSON.stringify({ revision: this.deps.store.revision() })}\n\n`)
      const timer = setInterval(() => {
        if (!authorized() || !response.write(': heartbeat\n\n')) response.destroy()
      }, 25_000)
      timer.unref()
      response.once('close', () => {
        clearInterval(timer)
        this.subscribers.get(device)?.delete(response)
      })
      return
    }
    if (this.active.size > 0) {
      json(409, { error: 'busy' })
      return
    }
    this.active.add(device)
    try {
      if (route === '/cursor' && request.method === 'GET') {
        const replica = z.string().min(1).max(512).parse(url.searchParams.get('replica'))
        if (replica !== replicaId) {
          json(403, { error: 'replicaMismatch' })
          return
        }
        json(200, { cursor: this.deps.store.cursor(replica) })
      } else if (route === '/download' && request.method === 'GET') {
        const { after } = Query.parse({ after: url.searchParams.get('after') })
        const batch = this.deps.store.export(after)
        const manifest = await this.native.attach(batch, await this.files.prepare(batch))
        const previous = this.downloads.get(device)
        this.downloads.set(device, manifest)
        await this.native.prune(
          new Set(
            [...this.uploads.values(), ...this.downloads.values()].flatMap((value) =>
              value.nativeProfile ? [value.nativeProfile.id] : []
            )
          )
        )
        if (
          previous &&
          previous.id !== manifest.id &&
          ![...this.downloads.values()].some((value) => value.id === previous.id)
        ) {
          await this.files.discard(previous.id)
          await this.native.discard(previous)
        }
        json(200, manifest)
      } else if (route === '/native-part' && request.method === 'GET') {
        const manifest = this.downloads.get(device)
        if (!manifest?.nativeProfile || manifest.id !== url.searchParams.get('id')) {
          json(404, {})
          return
        }
        const data = await this.native.files.part(
          manifest.nativeProfile,
          Number(url.searchParams.get('file')),
          Number(url.searchParams.get('part'))
        )
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': data.length
        })
        response.end(data)
      } else if (route === '/part' && request.method === 'GET') {
        const id = url.searchParams.get('id')
        const manifest = this.downloads.get(device)
        if (!manifest || manifest.id !== id) {
          json(404, {})
          return
        }
        const part = await this.files.part(id!, Number(url.searchParams.get('part')))
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': part.length
        })
        response.end(part)
      } else if (route === '/upload' && request.method === 'POST') {
        const manifest = SyncBatchManifestSchema.parse(
          JSON.parse((await this.body(request, SYNC_MAX_BATCH_BYTES)).toString())
        )
        if (manifest.replicaId !== replicaId) {
          json(403, { error: 'replicaMismatch' })
          return
        }
        if (manifest.parts !== Math.ceil(manifest.size / SYNC_PART_BYTES) || manifest.parts === 0)
          throw new Error('Invalid parts')
        if (manifest.nativeProfile && !this.deps.native)
          throw new Error('sync.tunnel.error.automaticUnsupported')
        this.uploads.set(device, manifest)
        json(200, {
          missing: await this.files.missing(manifest),
          nativeMissing: manifest.nativeProfile
            ? await this.native.files.missing(manifest.nativeProfile)
            : []
        })
      } else if (route === '/native-part' && request.method === 'POST') {
        const manifest = this.uploads.get(device)
        if (!manifest?.nativeProfile || manifest.id !== url.searchParams.get('id')) {
          json(409, {})
          return
        }
        await this.native.files.receive(
          manifest.nativeProfile,
          Number(url.searchParams.get('file')),
          Number(url.searchParams.get('part')),
          await this.body(request, SYNC_PART_BYTES)
        )
        json(200, {})
      } else if (route === '/part' && request.method === 'POST') {
        const manifest = this.uploads.get(device)
        if (!manifest || manifest.id !== url.searchParams.get('id')) {
          json(409, {})
          return
        }
        await this.files.receive(
          manifest,
          Number(url.searchParams.get('part')),
          await this.body(request, SYNC_PART_BYTES)
        )
        json(200, {})
      } else if (route === '/commit' && request.method === 'POST') {
        const manifest = this.uploads.get(device)
        if (!manifest || manifest.id !== url.searchParams.get('id')) {
          json(409, {})
          return
        }
        const cursor = this.deps.store.cursor(manifest.replicaId)
        if (cursor >= manifest.through) {
          json(200, { cursor })
          return
        }
        const batch = await this.files.assemble(manifest)
        if (batch.replicaId !== replicaId) {
          json(403, { error: 'replicaMismatch' })
          return
        }
        // Revocation can occur while disk IO is pending; an erased upload loses permission to commit.
        if (this.uploads.get(device) !== manifest || !this.deps.available()) {
          json(403, {})
          return
        }
        const applied = await this.native.apply(
          this.deps.store,
          batch,
          manifest,
          () => this.uploads.get(device) === manifest && this.deps.available() && authorized()
        )
        if (applied) {
          await this.files.discard(manifest.id, true)
          await this.native.discard(manifest)
        }
        json(applied ? 200 : 409, {
          cursor: this.deps.store.cursor(batch.replicaId),
          busy: !applied
        })
      } else json(404, {})
    } catch (error) {
      if (!response.headersSent)
        json(400, {
          error:
            error instanceof Error && error.message.startsWith('sync.')
              ? error.message
              : 'invalidBatch'
        })
      else response.destroy()
    } finally {
      this.active.delete(device)
    }
  }

  private revokeStream(device: string): void {
    for (const response of this.subscribers.get(device) ?? []) response.destroy()
    this.subscribers.delete(device)
  }

  private async body(request: http.IncomingMessage, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk)
      size += buffer.length
      if (size > limit) throw new Error('Sync body too large')
      chunks.push(buffer)
    }
    return Buffer.concat(chunks)
  }
}
