import { DownloadItem, Session } from 'electron'
import { nanoid } from 'nanoid'
import { BrowserWindowManager } from '../browserContext/BrowserWindowManager'
import { ElectronPageAdapter } from './ElectronPageAdapter'

export interface DownloadInfo {
  id: string
  url: string
  filename: string
  mimeType?: string
  totalBytes: number
  receivedBytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  savePath?: string
  updatedAt: number
}

export interface BrowserAdapterOptions {
  showWindow?: boolean
}

export interface PageSummary {
  id: number
  url: string
  title: string
  isActive: boolean
}

/**
 * Adapter that mimics a Puppeteer-like browser interface on top of Electron BrowserWindows.
 */
export class ElectronBrowserAdapter {
  private readonly windowManager: BrowserWindowManager
  private readonly pages = new Map<number, ElectronPageAdapter>()
  private activePageId: number | null = null
  private downloadSession?: Session
  private readonly downloads = new Map<string, DownloadInfo>()

  constructor(options?: BrowserAdapterOptions) {
    this.windowManager = new BrowserWindowManager({ showWindow: options?.showWindow })
  }

  async newPage(initialUrl?: string): Promise<ElectronPageAdapter> {
    const { window, id } = this.windowManager.createWindow()
    this.attachDownloadListener(window.webContents.session)

    const page = new ElectronPageAdapter(window)
    this.pages.set(id, page)
    this.activePageId = id

    window.on('focus', () => {
      this.activePageId = id
    })

    window.on('closed', () => {
      this.pages.delete(id)
      if (this.activePageId === id) {
        const [first] = this.pages.keys()
        this.activePageId = typeof first === 'number' ? first : null
      }
    })

    if (initialUrl) {
      await page.goto(initialUrl)
    }

    return page
  }

  pagesList(): ElectronPageAdapter[] {
    return Array.from(this.pages.values())
  }

  getActivePage(): ElectronPageAdapter | undefined {
    if (this.activePageId !== null) {
      const page = this.pages.get(this.activePageId)
      if (page && !page.isDestroyed()) {
        return page
      }
    }

    const firstPage = this.pages.values().next().value as ElectronPageAdapter | undefined
    return firstPage && !firstPage.isDestroyed() ? firstPage : undefined
  }

  getPageById(id: number): ElectronPageAdapter | undefined {
    const page = this.pages.get(id)
    if (page?.isDestroyed()) return undefined
    return page
  }

  setActivePage(id: number): ElectronPageAdapter | undefined {
    const page = this.getPageById(id)
    if (page) {
      this.activePageId = id
      page.focus()
    }
    return page
  }

  async closePage(id?: number): Promise<void> {
    const targetId = id ?? this.activePageId
    if (targetId === null || targetId === undefined) return
    const page = this.pages.get(targetId)
    if (!page) return
    page.close()
    this.pages.delete(targetId)
    if (this.activePageId === targetId) {
      const [first] = this.pages.keys()
      this.activePageId = typeof first === 'number' ? first : null
    }
  }

  async close(): Promise<void> {
    const ids = Array.from(this.pages.keys())
    for (const id of ids) {
      await this.closePage(id)
    }
    this.windowManager.destroyAll()
    if (this.downloadSession) {
      this.downloadSession.removeListener('will-download', this.handleWillDownload)
    }
  }

  listPages(): PageSummary[] {
    return Array.from(this.pages.values()).map((page) => ({
      id: page.id,
      url: page.url,
      title: page.title,
      isActive: page.id === this.activePageId
    }))
  }

  listDownloads(): DownloadInfo[] {
    return Array.from(this.downloads.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private attachDownloadListener(session: Session): void {
    if (this.downloadSession === session) {
      return
    }
    if (this.downloadSession) {
      this.downloadSession.removeListener('will-download', this.handleWillDownload)
    }
    this.downloadSession = session
    this.downloadSession.on('will-download', this.handleWillDownload)
  }

  private handleWillDownload = (_event: Electron.Event, item: DownloadItem): void => {
    const id = nanoid()
    const record: DownloadInfo = {
      id,
      url: item.getURL(),
      filename: item.getFilename(),
      mimeType: item.getMimeType(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: item.getReceivedBytes(),
      state: 'progressing',
      updatedAt: Date.now()
    }

    this.downloads.set(id, record)

    item.on('updated', (_event, state) => {
      record.receivedBytes = item.getReceivedBytes()
      record.totalBytes = item.getTotalBytes()
      record.state = state === 'interrupted' ? 'interrupted' : 'progressing'
      record.updatedAt = Date.now()
      this.downloads.set(id, { ...record })
    })

    item.on('done', (_event, state) => {
      record.receivedBytes = item.getReceivedBytes()
      record.totalBytes = item.getTotalBytes()
      record.savePath = item.getSavePath()
      record.state =
        state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      record.updatedAt = Date.now()
      this.downloads.set(id, { ...record })
    })
  }
}
