import { createSplashApi } from './splashApi'
import { configGetLanguageRoute } from '@shared/contracts/routes/config.routes'
import type { DeepchatBridge } from '@shared/contracts/bridge'

type NativeEvent = {
  name?: unknown
  payload?: unknown
}

type NativeGlobal = Window & {
  deepchat: DeepchatBridge
  mygo: {
    call(method: string, ...args: unknown[]): Promise<unknown>
    on(event: string, listener: (payload: NativeEvent) => void): () => void
  }
}

const target = window as unknown as NativeGlobal
const splashApi = createSplashApi({
  on: (channel, listener) =>
    target.mygo.on('deepchat.event', (event) => {
      if (event?.name === channel) {
        listener(event.payload)
      }
    }),
  send: (channel, payload) => {
    void target.mygo
      .call('Bridge.SplashChannel', channel, JSON.stringify(payload))
      .catch((error) => {
        // Never log request payloads: unlock and recovery inputs contain passwords.
        console.error(`[Splash] native command failed: ${channel}`, error)
      })
  },
  getLanguageState: () => target.deepchat.invoke(configGetLanguageRoute.name, {})
})

Object.defineProperty(target, 'deepchatSplash', {
  value: splashApi,
  configurable: false,
  enumerable: true,
  writable: false
})
