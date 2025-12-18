import {
  session as electronSession,
  type DownloadItem,
  type Session,
  type WebContents
} from 'electron'
import { nanoid } from 'nanoid'
import type { DownloadInfo } from '@shared/types/browser'

type PendingDownloadRequest = {
  url: string
  savePath?: string
  resolve: (info: DownloadInfo) => void
  reject: (error: unknown) => void
  timer: NodeJS.Timeout
  requestedAt: number
}

export class DownloadManager {
  private downloads = new Map<string, DownloadInfo>()
  private pendingRequests = new Map<Session, PendingDownloadRequest[]>()
  private sessionHandlers = new Map<
    Session,
    (event: Electron.Event, item: DownloadItem, webContents: WebContents) => void
  >()

  constructor() {
    this.ensureSessionListener(electronSession.defaultSession)
  }

  async downloadFile(
    url: string,
    savePath?: string,
    webContents?: WebContents
  ): Promise<DownloadInfo> {
    const electronSessionRef = webContents?.session ?? electronSession.defaultSession
    this.ensureSessionListener(electronSessionRef)

    return await new Promise<DownloadInfo>((resolve, reject) => {
      let pendingRequest: PendingDownloadRequest | null = null

      const timer = setTimeout(() => {
        if (pendingRequest) {
          this.removePendingRequest(electronSessionRef, pendingRequest)
        }
        reject(new Error('Download did not start in time'))
      }, 10_000)

      pendingRequest = {
        url,
        savePath,
        resolve,
        reject,
        timer,
        requestedAt: Date.now()
      }

      if (!pendingRequest) {
        clearTimeout(timer)
        reject(new Error('Failed to create download request'))
        return
      }

      this.enqueuePendingRequest(electronSessionRef, pendingRequest)

      try {
        electronSessionRef.downloadURL(url)
      } catch (error) {
        clearTimeout(timer)
        if (pendingRequest) {
          this.removePendingRequest(electronSessionRef, pendingRequest)
        }
        reject(error)
      }
    })
  }

  listDownloads(): DownloadInfo[] {
    return Array.from(this.downloads.values())
  }

  getDownload(downloadId: string): DownloadInfo | undefined {
    return this.downloads.get(downloadId)
  }

  destroy(): void {
    for (const [session, handler] of this.sessionHandlers.entries()) {
      session.removeListener('will-download', handler)
    }
    this.sessionHandlers.clear()

    for (const requests of this.pendingRequests.values()) {
      requests.forEach((pending) => clearTimeout(pending.timer))
    }
    this.pendingRequests.clear()
  }

  private ensureSessionListener(session: Session): void {
    if (this.sessionHandlers.has(session)) {
      return
    }

    const handler = (_event: Electron.Event, item: DownloadItem) =>
      this.handleWillDownload(session, item)

    session.on('will-download', handler)
    this.sessionHandlers.set(session, handler)
  }

  private enqueuePendingRequest(session: Session, pendingRequest: PendingDownloadRequest): void {
    const queue = this.pendingRequests.get(session) ?? []
    queue.push(pendingRequest)
    this.pendingRequests.set(session, queue)
  }

  private removePendingRequest(session: Session, pendingRequest: PendingDownloadRequest): void {
    const queue = this.pendingRequests.get(session)
    if (!queue) return

    const index = queue.indexOf(pendingRequest)
    if (index !== -1) {
      queue.splice(index, 1)
    }

    if (queue.length === 0) {
      this.pendingRequests.delete(session)
    }
  }

  private handleWillDownload(session: Session, item: DownloadItem): void {
    const queue = this.pendingRequests.get(session)
    if (!queue || queue.length === 0) {
      return
    }

    const itemUrl = item.getURL()
    const now = Date.now()
    const exactMatchIndex = queue.findIndex((pending) => pending.url === itemUrl)
    const fallbackIndex =
      exactMatchIndex !== -1
        ? exactMatchIndex
        : queue.findIndex((pending) => now - pending.requestedAt < 15_000)

    if (fallbackIndex === -1) {
      return
    }

    const [pendingRequest] = queue.splice(fallbackIndex, 1)
    if (queue.length === 0) {
      this.pendingRequests.delete(session)
    }

    clearTimeout(pendingRequest.timer)
    this.startTrackingDownload(item, pendingRequest)
  }

  private startTrackingDownload(item: DownloadItem, pendingRequest: PendingDownloadRequest): void {
    const id = nanoid(10)
    const info: DownloadInfo = {
      id,
      url: item.getURL(),
      filePath: pendingRequest.savePath,
      mimeType: item.getMimeType(),
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      status: 'pending'
    }

    if (pendingRequest.savePath) {
      item.setSavePath(pendingRequest.savePath)
    }

    this.downloads.set(id, info)

    const finalizeDownload = (status: DownloadInfo['status'], error?: string) => {
      const existing = this.downloads.get(id)
      if (!existing) {
        pendingRequest.reject(new Error('Download info missing on completion'))
        return
      }

      const updated: DownloadInfo = {
        ...existing,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        filePath: item.getSavePath(),
        status
      }

      if (error) {
        updated.error = error
      } else {
        delete updated.error
      }

      this.downloads.set(id, updated)
      pendingRequest.resolve({ ...updated })
    }

    item.on('updated', (_updateEvent, state) => {
      const existing = this.downloads.get(id)
      if (!existing) return
      existing.receivedBytes = item.getReceivedBytes()
      existing.totalBytes = item.getTotalBytes()
      existing.status = state === 'interrupted' ? 'failed' : 'in-progress'
      this.downloads.set(id, { ...existing })
    })

    item.once('done', (_doneEvent, state) => {
      if (state === 'completed') {
        finalizeDownload('completed')
        return
      }

      finalizeDownload('failed', state)
    })
  }
}
