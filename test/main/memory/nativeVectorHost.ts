import { app } from 'electron'
import type { MemoryVectorHost } from '@/memory/infra/legacyVssLoader'

export const nativeVectorHost: MemoryVectorHost = {
  get appPath() {
    return app.getAppPath()
  },
  get userDataPath() {
    return app.getPath('userData')
  },
  get isPackaged() {
    return app.isPackaged
  }
}
