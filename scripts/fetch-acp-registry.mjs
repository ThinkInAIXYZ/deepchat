import fs from 'node:fs/promises'
import { request } from 'node:https'
import path from 'node:path'
import { URL } from 'node:url'

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
const OUTPUT_DIR = path.resolve(process.cwd(), 'resources', 'acp-registry')
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'registry.json')
const ICON_OUTPUT_DIR = path.join(OUTPUT_DIR, 'icons')
const ICON_TMP_DIR = path.join(OUTPUT_DIR, '.icons-tmp')
const ACP_REGISTRY_ICON_PREFIX = 'https://cdn.agentclientprotocol.com/registry/'
const SAFE_ICON_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const REQUEST_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 5
const USER_AGENT = 'DeepChat build registry fetcher'

const fetchText = (url, redirectCount = 0) =>
  new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const req = request(
      parsedUrl,
      {
        headers: {
          accept: 'application/json,image/svg+xml,text/plain,*/*',
          'user-agent': USER_AGENT
        }
      },
      (response) => {
        const statusCode = response.statusCode ?? 0
        const location = response.headers.location
        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume()
          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error(`Too many redirects while fetching ${url}`))
            return
          }
          resolve(fetchText(new URL(location, parsedUrl).toString(), redirectCount + 1))
          return
        }

        const chunks = []
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8')
          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new Error(
                `Failed to fetch ${url}: ${statusCode} ${response.statusMessage ?? ''}`.trim()
              )
            )
            return
          }
          resolve(text)
        })
      }
    )

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Timed out fetching ${url}`))
    })
    req.on('error', reject)
    req.end()
  })

const getCacheableIconAgents = (parsed) =>
  Array.isArray(parsed.agents)
    ? parsed.agents.filter((agent) => agent?.id && isCacheableRegistryIcon(agent.icon))
    : []

const hasLocalSnapshot = async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf-8'))
    const expectedIcons = getCacheableIconAgents(parsed).map((agent) => `${sanitizeAgentId(agent.id)}.svg`)
    const localIcons = new Set(await fs.readdir(ICON_OUTPUT_DIR))

    return expectedIcons.every((iconName) => localIcons.has(iconName))
  } catch {
    return false
  }
}

const isCacheableRegistryIcon = (icon) =>
  typeof icon === 'string' &&
  icon.startsWith(ACP_REGISTRY_ICON_PREFIX) &&
  icon.endsWith('.svg')

const sanitizeAgentId = (agentId) => {
  const normalized = typeof agentId === 'string' ? agentId.trim() : ''
  if (!normalized || !SAFE_ICON_ID_PATTERN.test(normalized)) {
    throw new Error(`Unsafe ACP agent id for icon cache: ${agentId}`)
  }
  return normalized
}

const writeManifest = async (parsed) => {
  const tmpPath = `${OUTPUT_PATH}.tmp`
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  await fs.writeFile(tmpPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
  await fs.rename(tmpPath, OUTPUT_PATH)
}

const stageIcons = async (parsed) => {
  const iconAgents = getCacheableIconAgents(parsed)
  await fs.rm(ICON_TMP_DIR, { recursive: true, force: true })
  await fs.mkdir(ICON_TMP_DIR, { recursive: true })

  for (const agent of iconAgents) {
    const safeAgentId = sanitizeAgentId(agent.id)
    const text = await fetchText(agent.icon)
    await fs.writeFile(path.join(ICON_TMP_DIR, `${safeAgentId}.svg`), text, 'utf-8')
  }

  return iconAgents.length
}

const commitStagedIcons = async () => {
  await fs.rm(ICON_OUTPUT_DIR, { recursive: true, force: true })
  await fs.rename(ICON_TMP_DIR, ICON_OUTPUT_DIR)
}

const main = async () => {
  console.log(`[fetch-acp-registry] Fetching ${REGISTRY_URL}`)
  const text = await fetchText(REGISTRY_URL)
  const parsed = JSON.parse(text)

  const iconCount = await stageIcons(parsed)
  await writeManifest(parsed)
  await commitStagedIcons()

  console.log(`[fetch-acp-registry] wrote ${OUTPUT_PATH}`)
  console.log(`[fetch-acp-registry] wrote ${iconCount} icons to ${ICON_OUTPUT_DIR}`)
}

main().catch((error) => {
  fs.rm(ICON_TMP_DIR, { recursive: true, force: true }).catch(() => undefined)
  hasLocalSnapshot()
    .then((cached) => {
      if (cached) {
        console.warn('[fetch-acp-registry] failed:', error)
        console.warn('[fetch-acp-registry] using existing local snapshot')
        return
      }

      console.error('[fetch-acp-registry] failed:', error)
      process.exitCode = 1
    })
    .catch(() => {
      console.error('[fetch-acp-registry] failed:', error)
      process.exitCode = 1
    })
})
