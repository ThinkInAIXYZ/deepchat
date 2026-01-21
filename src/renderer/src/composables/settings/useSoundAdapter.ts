import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS } from '@/events'

type Unsubscribe = () => void

const noopUnsubscribe: Unsubscribe = () => undefined

export type SoundAdapter = {
  getSoundEnabled: () => Promise<boolean>
  setSoundEnabled: (enabled: boolean) => Promise<void>
  onSoundEnabledChanged: (handler: (enabled: boolean) => void) => Unsubscribe
}

export function useSoundAdapter(): SoundAdapter {
  const configPresenter = usePresenter('configPresenter')

  const subscribe = (handler: (enabled: boolean) => void): Unsubscribe => {
    if (!window?.electron?.ipcRenderer) return noopUnsubscribe

    const listener = (_event: unknown, enabled: boolean) => {
      handler(enabled)
    }

    window.electron.ipcRenderer.on(CONFIG_EVENTS.SOUND_ENABLED_CHANGED, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(CONFIG_EVENTS.SOUND_ENABLED_CHANGED, listener)
    }
  }

  return {
    getSoundEnabled: () => Promise.resolve(configPresenter.getSoundEnabled()),
    setSoundEnabled: (enabled: boolean) =>
      Promise.resolve(configPresenter.setSoundEnabled(enabled)),
    onSoundEnabledChanged: (handler) => subscribe(handler)
  }
}
