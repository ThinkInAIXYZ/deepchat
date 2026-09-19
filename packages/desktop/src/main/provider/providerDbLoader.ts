import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { ProviderDbLoader as CoreProviderDbLoader } from '@deepchat/provider/providerDbLoader'
export type {
  ProviderDbRefreshResult,
  ProviderDbCatalogChange,
  ProviderDbCatalogListener
} from '@deepchat/provider/providerDbLoader'

export class ProviderDbLoader extends CoreProviderDbLoader {
  constructor() {
    const userData = process.env.DEEPCHAT_E2E_USER_DATA_DIR?.trim() || app.getPath('userData')
    const directory = path.join(userData, 'provider-db')
    try {
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true })
    } catch {}
    const cache = path.join(directory, 'providers.json')
    const meta = path.join(directory, 'meta.json')
    const read = (file: string): string | null => {
      try {
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
      } catch {
        return null
      }
    }
    const write = (file: string, value: string): void => {
      fs.writeFileSync(file + '.tmp', value, 'utf8')
      fs.renameSync(file + '.tmp', file)
    }
    super({
      readBuiltIn: () =>
        read(path.join(app.getAppPath(), 'resources', 'model-db', 'providers.json')),
      readCache: () => read(cache),
      readMeta: () => read(meta),
      writeCache: (value) => write(cache, value),
      writeMeta: (value) => write(meta, value),
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
      ttlHours: () => Number(process.env.PROVIDER_DB_TTL_HOURS || 4)
    })
  }
}
export const providerDbLoader = new ProviderDbLoader()
