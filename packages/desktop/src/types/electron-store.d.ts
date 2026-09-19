declare module 'electron-store' {
  import Store from 'electron-store'

  interface Store<T> {
    get(key: string): T | undefined
    set(key: string, value: T): void
  }

  export default Store
}
