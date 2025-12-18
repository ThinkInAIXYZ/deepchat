import { session as electronSession, type DownloadItem, type WebContents } from 'electron'
import { nanoid } from 'nanoid'
import type { DownloadInfo } from '@shared/types/browser'

export class DownloadManager {
  private downloads = new Map<string, DownloadInfo>()

  async downloadFile(
    url: string,
    savePath?: string,
    webContents?: WebContents
  ): Promise<DownloadInfo> {
    const electronSessionRef = webContents?.session ?? electronSession.defaultSession

    return await new Promise<DownloadInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        electronSessionRef.removeListener('will-download', handler)
        reject(new Error('Download did not start in time'))
      }, 10_000)

      const handler = (_event: Electron.Event, item: DownloadItem) => {
        clearTimeout(timer)
        electronSessionRef.removeListener('will-download', handler)
        const id = nanoid(10)
        const info: DownloadInfo = {
          id,
          url: item.getURL(),
          filePath: savePath,
          mimeType: item.getMimeType(),
          receivedBytes: 0,
          totalBytes: item.getTotalBytes(),
          status: 'pending'
        }

        if (savePath) {
          item.setSavePath(savePath)
        }

        this.downloads.set(id, info)

        const finalizeDownload = (status: DownloadInfo['status'], error?: string) => {
          const existing = this.downloads.get(id)
          if (!existing) {
            reject(new Error('Download info missing on completion'))
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
          resolve({ ...updated })
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

      electronSessionRef.once('will-download', handler)

      try {
        electronSessionRef.downloadURL(url)
      } catch (error) {
        clearTimeout(timer)
        electronSessionRef.removeListener('will-download', handler)
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
}
