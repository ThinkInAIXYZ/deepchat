import fs from 'fs/promises'
import path from 'path'

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
const OUTPUT_DIR = path.resolve(process.cwd(), 'resources', 'acp-registry')
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'registry.json')
const ICON_OUTPUT_DIR = path.join(OUTPUT_DIR, 'icons')
const ICON_TMP_DIR = path.join(OUTPUT_DIR, '.icons-tmp')
const ACP_REGISTRY_ICON_PREFIX = 'https://cdn.agentclientprotocol.com/registry/'
const SAFE_ICON_ID_PATTERN = /^[A-Za-z0-9._-]+$/

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

  await Promise.all(
    iconAgents.map(async (agent) => {
      const safeAgentId = sanitizeAgentId(agent.id)
      const response = await fetch(agent.icon)
      if (!response.ok) {
        throw new Error(`Failed to fetch ACP icon ${agent.id}: ${response.status} ${response.statusText}`)
      }

      const text = await response.text()
      await fs.writeFile(path.join(ICON_TMP_DIR, `${safeAgentId}.svg`), text, 'utf-8')
    })
  )

  return iconAgents.length
}

const commitStagedIcons = async () => {
  await fs.rm(ICON_OUTPUT_DIR, { recursive: true, force: true })
  await fs.rename(ICON_TMP_DIR, ICON_OUTPUT_DIR)
}

const main = async () => {
  const response = await fetch(REGISTRY_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch ACP registry: ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
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
