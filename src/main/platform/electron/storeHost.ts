import ElectronStore from 'electron-store'
import type { StoreHost, StoreHostOptions } from '../storeHost'
import type { StoreLike } from '@/config/storeLike'

export const electronStoreHost: StoreHost = {
  create<TStore extends Record<string, any>>(options: StoreHostOptions<TStore>): StoreLike<TStore> {
    return new ElectronStore<TStore>({
      name: options.name,
      ...(options.defaults === undefined ? {} : { defaults: options.defaults }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd })
    }) as unknown as StoreLike<TStore>
  }
}
