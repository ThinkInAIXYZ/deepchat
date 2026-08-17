export const SPLASH_DEBUG_MODE_CHANNEL = 'splash:debug-mode'

export const SPLASH_DEBUG_MODES = ['loading', 'system-unlock', 'unlock', 'recovery'] as const

export type SplashDebugMode = (typeof SPLASH_DEBUG_MODES)[number]
