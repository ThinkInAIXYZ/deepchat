import { webFrame } from 'electron'
import { exposeElectronAPI } from '@electron-toolkit/preload'

exposeElectronAPI()

window.addEventListener('DOMContentLoaded', () => {
  webFrame.setVisualZoomLevelLimits(1, 1)
  webFrame.setZoomFactor(1)
})
