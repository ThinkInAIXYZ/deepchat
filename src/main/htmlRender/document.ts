import type { McpAppCsp } from '@shared/types/mcp'
import {
  HTML_RENDER_HOST_STYLE_SLOT,
  HTML_RENDER_SCRIPT_ERROR_METHOD,
  HTML_RENDER_SECTIONS_METHOD
} from '@shared/agentHtmlRenderTool'

// No remote hosts: pages must work offline and on intranets, so libraries come from /lib on the
// sandbox origin, which 'self' already allows.
export const HTML_RENDER_CSP: McpAppCsp = {}

export const HTML_RENDER_LIBRARIES: ReadonlyMap<string, string> = new Map([
  ['echarts.js', 'echarts.min.js']
])

const EXTERNAL_RESOURCE = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i
const DOCUMENT_TAG = /<(?:!doctype|html|head|body)\b/i

export const loadsExternalResource = (html: string): boolean => EXTERNAL_RESOURCE.test(html)

export const isDocumentMarkup = (html: string): boolean => DOCUMENT_TAG.test(html)

// Base64 payloads can contain "vh" by chance; skip long runs before matching units.
const BASE64_RUN = /[A-Za-z0-9+/=]{200,}/g
const VIEWPORT_HEIGHT_UNIT = /(?<![\w-])\d*\.?\d+(?:s|l|d)?vh\b/i

export const usesViewportHeightUnit = (html: string): boolean =>
  VIEWPORT_HEIGHT_UNIT.test(html.replace(BASE64_RUN, ''))

const BOOTSTRAP_STYLE = `<style>
html{background:transparent;padding:8px;color:var(--foreground);font-family:var(--font-sans,system-ui,sans-serif);color-scheme:light dark}
body{margin:0;background:transparent}
</style>`

// Minimal MCP Apps view handshake so the existing AppBridge host and sandbox proxy work unchanged.
// Sections wait for DOMContentLoaded so libraries loaded by the shell's <head> are defined, and
// their scripts are re-created because scripts parsed through innerHTML never run.
// Size reports come straight from ResizeObserver/load, not rAF: Chromium throttles rAF in
// cross-origin frames it considers hidden, so the first report could never arrive.
const BOOTSTRAP_SCRIPT = `<script>
(() => {
  'use strict'
  const root = document.documentElement
  const pending = new Map()
  let nextId = 1
  let initialized = false
  let lastHeight = 0
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
    if (height > 0 && height !== lastHeight) {
      lastHeight = height
      send({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height } })
    }
  }
  const domReady = new Promise((resolve) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resolve)
    else resolve()
  })
  const sectionHtml = new Map()
  const sectionSlots = new Map()
  let sectionQueue = Promise.resolve()
  const runScripts = async (slot) => {
    for (const inert of Array.from(slot.querySelectorAll('script'))) {
      const script = document.createElement('script')
      for (const attribute of Array.from(inert.attributes)) {
        script.setAttribute(attribute.name, attribute.value)
      }
      script.textContent = inert.textContent
      const loaded = script.src
        ? new Promise((resolve) => { script.onload = script.onerror = resolve })
        : null
      inert.replaceWith(script)
      if (loaded) await loaded
    }
  }
  const applySections = async (sections) => {
    for (const section of sections) {
      if (!section || typeof section.id !== 'string' || typeof section.html !== 'string') continue
      if (sectionHtml.get(section.id) === section.html) continue
      let slot = sectionSlots.get(section.id)
      if (!slot) {
        slot = document.createElement('div')
        slot.style.display = 'contents'
        slot.dataset.dcSection = section.id
        ;(document.querySelector('[data-dc-sections]') || document.body).appendChild(slot)
        sectionSlots.set(section.id, slot)
      }
      const template = document.createElement('template')
      template.innerHTML = section.html
      slot.replaceChildren(template.content)
      sectionHtml.set(section.id, section.html)
      await runScripts(slot)
    }
    const ids = new Set(sections.map((section) => section && section.id))
    for (const [id, slot] of sectionSlots) {
      if (ids.has(id)) continue
      slot.remove()
      sectionSlots.delete(id)
      sectionHtml.delete(id)
    }
  }
  addEventListener('message', (event) => {
    if (event.source !== parent) return
    const message = event.data
    if (!message || message.jsonrpc !== '2.0') return
    if (message.method === '${HTML_RENDER_SECTIONS_METHOD}') {
      const sections = Array.isArray(message.params?.sections) ? message.params.sections : []
      sectionQueue = sectionQueue
        .then(() => domReady)
        .then(() => applySections(sections))
        .catch(() => {})
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
  document.addEventListener('click', (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!anchor || event.defaultPrevented) return
    const href = anchor.getAttribute('href') || ''
    if (href.startsWith('#')) return
    event.preventDefault()
    if (/^https?:/i.test(anchor.href)) {
      request('ui/open-link', { url: anchor.href }).catch(() => {})
    }
  })
  let scriptErrorSent = false
  addEventListener('error', () => {
    if (scriptErrorSent) return
    scriptErrorSent = true
    send({ jsonrpc: '2.0', method: '${HTML_RENDER_SCRIPT_ERROR_METHOD}', params: {} })
  })
  new ResizeObserver(report).observe(root)
  addEventListener('load', report)
  request('ui/initialize', {
    appInfo: { name: 'html_render', version: '1.0.0' },
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
</script>`

// The renderer fills the slot with theme variables before the document is written, so page scripts
// that read CSS variables at parse time already see them.
const BOOTSTRAP = `${HTML_RENDER_HOST_STYLE_SLOT}${BOOTSTRAP_STYLE}${BOOTSTRAP_SCRIPT}`

export const buildHtmlRenderDocument = (html: string): string => {
  const head = /<head(?:\s[^>]*)?>/i.exec(html)
  if (head) {
    const at = head.index + head[0].length
    return `${html.slice(0, at)}${BOOTSTRAP}${html.slice(at)}`
  }
  const root = /<html(?:\s[^>]*)?>/i.exec(html)
  if (root) {
    const at = root.index + root[0].length
    return `${html.slice(0, at)}<head>${BOOTSTRAP}</head>${html.slice(at)}`
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  const at = doctype ? doctype[0].length : 0
  return `<!doctype html>${BOOTSTRAP}${html.slice(at)}`
}
