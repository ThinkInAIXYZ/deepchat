import type { McpAppCsp } from '@shared/types/mcp'
import {
  INFOGRAPHIC_EXPORTED_METHOD,
  INFOGRAPHIC_EXPORT_METHOD,
  INFOGRAPHIC_RENDER_METHOD,
  INFOGRAPHIC_STATUS_METHOD,
  type HostViewKind
} from '@shared/hostViews'

type HostViewDefinition = {
  title: string
  document: string
  // Published path under /lib/ → file name in resources/cdn.
  libraries: ReadonlyMap<string, string>
  csp: McpAppCsp
}

// AntV runs inside the sandbox origin because it inserts SVG from the DSL into the live DOM
// without sanitizing it. An empty CSP keeps its remote resource loaders from reaching the network.
const INFOGRAPHIC_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
html,body{margin:0;background:transparent;color-scheme:light dark}
#root{width:100%}
#root svg{display:block;width:100%;height:auto}
</style>
<script src="/lib/infographic.js"></script>
</head>
<body>
<div id="root"></div>
<script>
(() => {
  'use strict'
  const root = document.getElementById('root')
  const pending = new Map()
  let nextId = 1
  let initialized = false
  let lastHeight = 0
  let instance = null
  let theme = ''
  const send = (message) => parent.postMessage(message, '*')
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      send({ jsonrpc: '2.0', id, method, params })
    })
  const report = () => {
    if (!initialized) return
    const height = Math.ceil(root.getBoundingClientRect().height)
    if (height !== lastHeight) {
      lastHeight = height
      send({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height } })
    }
  }
  let errored = false
  let rendered = false
  const render = (source, nextTheme) => {
    errored = false
    rendered = false
    try {
      if (!instance || theme !== nextTheme) {
        instance?.destroy()
        root.replaceChildren()
        theme = nextTheme
        instance = new AntVInfographic.Infographic({
          container: root,
          width: '100%',
          theme: nextTheme,
          editable: false
        })
        instance.on('error', () => { errored = true })
        instance.on('rendered', () => { rendered = true })
      }
      // AntV reports an invalid or incomplete DSL through the error event and skips rendering
      // instead of throwing.
      instance.render(source)
    } catch {
      errored = true
    }
    const ok = rendered && !errored
    send({ jsonrpc: '2.0', method: '${INFOGRAPHIC_STATUS_METHOD}', params: { ok } })
    report()
  }
  addEventListener('message', (event) => {
    if (event.source !== parent) return
    const message = event.data
    if (!message || message.jsonrpc !== '2.0') return
    if (message.method === '${INFOGRAPHIC_RENDER_METHOD}') {
      const params = message.params || {}
      if (typeof params.source === 'string') render(params.source, params.theme === 'dark' ? 'dark' : 'light')
      return
    }
    if (message.method === '${INFOGRAPHIC_EXPORT_METHOD}') {
      const svg = root.querySelector('svg')
      send({
        jsonrpc: '2.0',
        method: '${INFOGRAPHIC_EXPORTED_METHOD}',
        params: { svg: svg ? new XMLSerializer().serializeToString(svg) : null }
      })
      return
    }
    if (message.method === undefined && pending.has(message.id)) {
      const entry = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) entry.reject(message.error)
      else entry.resolve(message.result)
      return
    }
    if (message.id !== undefined && (message.method === 'ui/resource-teardown' || message.method === 'ping')) {
      send({ jsonrpc: '2.0', id: message.id, result: {} })
    }
  })
  new ResizeObserver(report).observe(root)
  request('ui/initialize', {
    appInfo: { name: 'infographic', version: '1.0.0' },
    appCapabilities: {},
    protocolVersion: '2026-01-26'
  })
    .then(() => {
      send({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} })
      initialized = true
      report()
    })
    .catch(() => {})
})()
</script>
</body>
</html>`

const HOST_VIEWS: Record<HostViewKind, HostViewDefinition> = {
  infographic: {
    title: 'Infographic',
    document: INFOGRAPHIC_DOCUMENT,
    libraries: new Map([['infographic.js', 'infographic.min.js']]),
    csp: {}
  }
}

export const getHostView = (kind: HostViewKind): HostViewDefinition => HOST_VIEWS[kind]
