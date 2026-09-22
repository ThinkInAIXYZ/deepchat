import type http from 'node:http'
import path from 'node:path'
import { z } from 'zod'
import {
  SYNC_REPLICA_PREFIX,
  SYNC_PART_BYTES,
  SyncBatchManifestSchema,
  type SyncBatchManifest
} from '@shared/contracts/syncReplica'
import type { SyncReplicaStore } from './store'
import { SyncBatchFiles } from './batches'

const Query = z.object({ after: z.coerce.number().int().nonnegative().safe() })

export class SyncReplicaEndpoint {
  private notification: NodeJS.Timeout | null = null
  private readonly subscribers = new Map<string, Set<http.ServerResponse>>()
  private readonly uploads = new Map<string, SyncBatchManifest>()
  private readonly downloads = new Map<string, SyncBatchManifest>()
  private readonly active = new Set<string>()
  private readonly files: SyncBatchFiles
  private readonly unsubscribe: () => void

  constructor(
    private readonly deps: {
      store: SyncReplicaStore
      directory: string
      hostId(): string
      available(): boolean
    }
  ) {
    this.files = new SyncBatchFiles(path.join(deps.directory, 'batches'))
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
    const url = new URL(request.url ?? '/', 'http://localhost')
    const route = url.pathname.slice(SYNC_REPLICA_PREFIX.length)
    if (request.method === 'GET' && route === '/status') {
      const revision = this.deps.store.revision()
      json(200, {
        protocol: 2,
        hostId: this.deps.hostId(),
        replicaId: this.deps.store.replicaId,
        revision,
        writable
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
        json(200, { cursor: this.deps.store.cursor(replica) })
      } else if (route === '/download' && request.method === 'GET') {
        const { after } = Query.parse({ after: url.searchParams.get('after') })
        const batch = this.deps.store.export(after)
        const manifest = await this.files.prepare(batch)
        const previous = this.downloads.get(device)
        this.downloads.set(device, manifest)
        if (
          previous &&
          previous.id !== manifest.id &&
          ![...this.downloads.values()].some((value) => value.id === previous.id)
        )
          await this.files.discard(previous.id)
        json(200, manifest)
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
          JSON.parse((await this.body(request, 65536)).toString())
        )
        if (manifest.parts !== Math.ceil(manifest.size / SYNC_PART_BYTES) || manifest.parts === 0)
          throw new Error('Invalid parts')
        this.uploads.set(device, manifest)
        json(200, { missing: await this.files.missing(manifest) })
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
        // Revocation can occur while disk IO is pending; an erased upload loses permission to commit.
        if (this.uploads.get(device) !== manifest || !this.deps.available()) {
          json(403, {})
          return
        }
        const applied = await this.deps.store.apply(
          batch,
          () => this.uploads.get(device) === manifest && this.deps.available() && authorized()
        )
        if (applied) await this.files.discard(manifest.id, true)
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
