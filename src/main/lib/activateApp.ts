import { app } from 'electron'

export function ensureRegularAppOnMac(): void {
  if (process.platform !== 'darwin') {
    return
  }

  app.setActivationPolicy('regular')
  app.dock?.show()
}

export function activateAppOnMac(): void {
  if (process.platform !== 'darwin') {
    return
  }

  ensureRegularAppOnMac()
  app.focus({ steal: true })
}
