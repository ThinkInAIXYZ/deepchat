import { defineConfig } from 'vite'
import { createPreloadConfig } from './vite.preload.config'

export default defineConfig(
  createPreloadConfig('src/preload/goSplashApi.ts', 'splash.js', 'DeepchatSplash')
)
