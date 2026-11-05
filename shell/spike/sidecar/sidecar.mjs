#!/usr/bin/env node
/**
 * Sidecar prototype for the mygo shell.
 *
 * It speaks the same shape as DeepChat's typed bridge: one JSON request per line
 * on stdin, one JSON response per line on stdout, correlated by id. The real
 * sidecar will host the existing main-process services; this one answers the few
 * routes the spike needs so the renderer can boot with real values instead of
 * empty objects.
 */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const routeLog = process.env.SPIKE_ROUTE_LOG

const state = {
  language: 'zh-CN',
  theme: 'system',
  themeSource: 'system',
  isDark: false,
  windowId: 1,
  webContentsId: 1
}

const handlers = {
  'config.getLanguage': () => ({
    language: state.language,
    requestedLanguage: state.language,
    locale: state.language,
    direction: 'ltr',
    version: 1
  }),
  'config.setLanguage': (input) => {
    state.language = typeof input?.language === 'string' ? input.language : state.language
    return { language: state.language, version: Date.now() }
  },
  'config.getTheme': () => ({
    theme: state.theme,
    isDark: state.isDark,
    version: 1
  }),
  'config.setTheme': (input) => {
    state.theme = input?.theme ?? state.theme
    state.themeSource = state.theme
    state.isDark = state.theme === 'dark'
    return { theme: state.theme, isDark: state.isDark, version: Date.now() }
  },
  'config.getEntireConfig': () => ({
    config: {
      appTheme: state.theme,
      language: state.language,
      notificationsEnabled: true
    }
  }),
  'window.getRuntimeIdentity': () => ({
    windowId: state.windowId,
    webContentsId: state.webContentsId
  }),
  'window.getCurrentState': () => ({
    windowId: state.windowId,
    exists: true,
    isMaximized: false,
    isFullScreen: false,
    isFocused: true
  }),
  'sessions.list': () => ({ sessions: [], total: 0 }),
  'project.listRecent': () => ({ projects: [] }),
  'agents.list': () => ({ agents: [] })
}

const reply = (payload) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

// Events are unsolicited lines: {"event": name, "payload": ...}. The spike
// forwards them to every page, which is what DeepChat's streaming path needs.
const emit = (event, payload) => {
  process.stdout.write(`${JSON.stringify({ event, payload })}\n`)
}

// After a few seconds, switch the renderer to dark mode through the same typed
// event DeepChat uses, so the spike can prove real events reach the real store.
setTimeout(() => {
  emit('config.theme.changed', { theme: 'dark', isDark: true, version: Date.now() })
}, 4000).unref?.()

let tick = 0
const ticker = setInterval(() => {
  tick += 1
  emit('spike.tick', { sequence: tick, at: Date.now() })
}, 1000)
ticker.unref?.()

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let request
  try {
    request = JSON.parse(trimmed)
  } catch (error) {
    reply({ error: `bad request: ${String(error)}` })
    return
  }

  if (routeLog) {
    appendFileSync(
      routeLog,
      `${JSON.stringify({ route: request.route, input: request.input ?? null, known: Boolean(handlers[request.route]) })}\n`
    )
  }

  const handler = handlers[request.route]
  if (!handler) {
    // The spike reports unknown routes so the report can list what the renderer still needs.
    reply({ id: request.id, result: {} })
    return
  }

  try {
    reply({ id: request.id, result: handler(request.input) })
  } catch (error) {
    reply({ id: request.id, error: String(error) })
  }
})

rl.on('close', () => process.exit(0))
