#!/usr/bin/env node
// Build-time fetch of Provider DB (aggregated all.json) into resources/model-db/providers.json

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_URL =
  'https://raw.githubusercontent.com/ThinkInAIXYZ/PublicProviderConf/refs/heads/dev/dist/all.json'

const log = (...args) => console.log('[fetch-provider-db]', ...args)
const warn = (...args) => console.warn('[fetch-provider-db]', ...args)
const error = (...args) => console.error('[fetch-provider-db]', ...args)

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true })
}

const PROVIDER_ID_REGEX = /^[a-z0-9][a-z0-9-_]*$/
const MODEL_ID_REGEX = /^[a-z0-9][a-z0-9\-_.:/]*$/
const isValidLowercaseProviderId = (id) =>
  typeof id === 'string' && id === id.toLowerCase() && PROVIDER_ID_REGEX.test(id)
const isValidLowercaseModelId = (id) =>
  typeof id === 'string' && id === id.toLowerCase() && MODEL_ID_REGEX.test(id)

function sanitizeAggregateJson(json) {
  if (!json || typeof json !== 'object') return null
  const providers = json.providers
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return null
  const out = { providers: {} }
  for (const [key, p] of Object.entries(providers)) {
    if (!p || typeof p !== 'object') continue
    const pid = p.id ?? key
    if (!isValidLowercaseProviderId(pid)) continue
    if (pid !== key) continue
    const models = Array.isArray(p.models) ? p.models : []
    const sanitizedModels = []
    for (const m of models) {
      if (!m || typeof m !== 'object') continue
      const mid = m.id
      if (!isValidLowercaseModelId(mid)) continue
      const rlimit = m.limit
      let limit
      if (rlimit && typeof rlimit === 'object') {
        const l = {}
        if (typeof rlimit.context === 'number' && Number.isFinite(rlimit.context) && rlimit.context >= 0)
          l.context = rlimit.context
        if (typeof rlimit.output === 'number' && Number.isFinite(rlimit.output) && rlimit.output >= 0)
          l.output = rlimit.output
        if (Object.keys(l).length) limit = l
      }
      let modalities
      const rmods = m.modalities
      if (rmods && typeof rmods === 'object') {
        const inp = Array.isArray(rmods.input) ? rmods.input.filter((v) => typeof v === 'string') : undefined
        const outArr = Array.isArray(rmods.output) ? rmods.output.filter((v) => typeof v === 'string') : undefined
        if (inp || outArr) modalities = { input: inp, output: outArr }
      }
      // reasoning (object in new schema; boolean legacy)
      let reasoning
      const r = m.reasoning
      if (typeof r === 'boolean') {
        reasoning = { supported: r }
      } else if (r && typeof r === 'object') {
        const rs = {}
        if (typeof r.supported === 'boolean') rs.supported = r.supported
        if (typeof r.default === 'boolean') rs.default = r.default
        if (r.budget && typeof r.budget === 'object') {
          const bd = {}
          if (typeof r.budget.default === 'number' && Number.isFinite(r.budget.default))
            bd.default = r.budget.default
          if (typeof r.budget.min === 'number' && Number.isFinite(r.budget.min))
            bd.min = r.budget.min
          if (typeof r.budget.max === 'number' && Number.isFinite(r.budget.max))
            bd.max = r.budget.max
          if (Object.keys(bd).length) rs.budget = bd
        }
        // effort / verbosity are nested under reasoning in upstream schema
        const effort = r.effort
        if (typeof effort === 'string' && ['minimal', 'low', 'medium', 'high'].includes(effort)) {
          rs.effort = effort
        }
        const verbosity = r.verbosity
        if (typeof verbosity === 'string' && ['low', 'medium', 'high'].includes(verbosity)) {
          rs.verbosity = verbosity
        }
        if (Object.keys(rs).length) reasoning = rs
      }

      // search (new schema)
      let search
      const s = m.search
      if (s && typeof s === 'object') {
        const so = {}
        if (typeof s.supported === 'boolean') so.supported = s.supported
        if (typeof s.default === 'boolean') so.default = s.default
        if (typeof s.forced_search === 'boolean') so.forced_search = s.forced_search
        if (typeof s.search_strategy === 'string') so.search_strategy = s.search_strategy
        if (Object.keys(so).length) search = so
      }

      sanitizedModels.push({
        id: mid,
        name: typeof m.name === 'string' ? m.name : undefined,
        display_name: typeof m.display_name === 'string' ? m.display_name : undefined,
        modalities,
        limit,
        temperature: typeof m.temperature === 'boolean' ? m.temperature : undefined,
        tool_call: typeof m.tool_call === 'boolean' ? m.tool_call : undefined,
        reasoning,
        search,
        attachment: typeof m.attachment === 'boolean' ? m.attachment : undefined,
        open_weights: typeof m.open_weights === 'boolean' ? m.open_weights : undefined,
        knowledge: typeof m.knowledge === 'string' ? m.knowledge : undefined,
        release_date: typeof m.release_date === 'string' ? m.release_date : undefined,
        last_updated: typeof m.last_updated === 'string' ? m.last_updated : undefined,
        cost: typeof m.cost === 'object' ? m.cost : undefined
      })
    }
    if (!sanitizedModels.length) continue
    const envArr = Array.isArray(p.env) ? p.env.filter((v) => typeof v === 'string') : undefined
    out.providers[pid] = {
      id: pid,
      name: typeof p.name === 'string' ? p.name : undefined,
      display_name: typeof p.display_name === 'string' ? p.display_name : undefined,
      api: typeof p.api === 'string' ? p.api : undefined,
      doc: typeof p.doc === 'string' ? p.doc : undefined,
      env: envArr,
      models: sanitizedModels
    }
  }
  if (Object.keys(out.providers).length === 0) return null
  return out
}

async function main() {
  const url = process.env.PROVIDER_DB_URL || DEFAULT_URL
  const outDir = path.resolve(process.cwd(), 'resources', 'model-db')
  const outFile = path.join(outDir, 'providers.json')
  const tmpFile = outFile + '.tmp'

  await ensureDir(outDir)

  let text
  try {
    log('Fetching', url)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    text = await res.text()
  } catch (e) {
    warn('Fetch failed:', e?.message || e)
    if (fs.existsSync(outFile)) {
      warn('Using existing providers.json snapshot')
      return
    }
    error('No existing snapshot found. Failing the build step.')
    process.exit(1)
  }

  if (text.length > 5 * 1024 * 1024) {
    error('Downloaded file too large (>5MB). Aborting.')
    if (!fs.existsSync(outFile)) process.exit(1)
    return
  }

  let json
  try {
    json = JSON.parse(text)
  } catch (e) {
    error('Invalid JSON:', e?.message || e)
    if (!fs.existsSync(outFile)) process.exit(1)
    return
  }

  const sanitized = sanitizeAggregateJson(json)
  if (!sanitized) {
    error('No valid providers after sanitization.')
    if (!fs.existsSync(outFile)) process.exit(1)
    return
  }

  try {
    await fsp.writeFile(tmpFile, JSON.stringify(sanitized, null, 2))
    try {
      await fsp.rename(tmpFile, outFile)
    } catch (e) {
      // Cross-platform replace fallback
      await fsp.rm(outFile, { force: true })
      await fsp.rename(tmpFile, outFile)
    }
    log('Saved to', outFile)
  } catch (e) {
    error('Write failed:', e?.message || e)
    if (!fs.existsSync(outFile)) process.exit(1)
  }
}

main().catch((e) => {
  error('Unexpected error:', e)
  process.exit(1)
})
