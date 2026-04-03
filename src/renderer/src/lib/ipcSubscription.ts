type IpcListener = (...args: any[]) => void

type IpcRegistration = {
  channel: string
  listener: IpcListener
}

function resolveIpcRenderer() {
  return window?.electron?.ipcRenderer
}

export function createIpcSubscriptionScope() {
  const registrations: IpcRegistration[] = []

  const on = (channel: string, listener: IpcListener) => {
    const ipcRenderer = resolveIpcRenderer()
    if (!ipcRenderer) {
      return
    }

    ipcRenderer.on(channel, listener)
    registrations.push({ channel, listener })
  }

  const cleanup = () => {
    const ipcRenderer = resolveIpcRenderer()
    if (!ipcRenderer) {
      registrations.length = 0
      return
    }

    for (const registration of registrations.splice(0)) {
      if (typeof ipcRenderer.removeListener === 'function') {
        ipcRenderer.removeListener(registration.channel, registration.listener)
      }
    }
  }

  return {
    on,
    cleanup
  }
}
