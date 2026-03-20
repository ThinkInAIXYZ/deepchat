import fs from 'fs/promises'
import path from 'path'

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
const OUTPUT_DIR = path.resolve(process.cwd(), 'resources', 'acp-registry')
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'registry.json')
const ICON_OUTPUT_DIR = path.join(OUTPUT_DIR, 'icons')
const ICON_TMP_DIR = path.join(OUTPUT_DIR, '.icons-tmp')
const ACP_REGISTRY_ICON_PREFIX = 'https://cdn.agentclientprotocol.com/registry/'

const isCacheableRegistryIcon = (icon) =>
  typeof icon === 'string' &&
  icon.startsWith(ACP_REGISTRY_ICON_PREFIX) &&
  icon.endsWith('.svg')

const writeManifest = async (parsed) => {
  const tmpPath = `${OUTPUT_PATH}.tmp`
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  await fs.writeFile(tmpPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
  await fs.rename(tmpPath, OUTPUT_PATH)
}

const downloadIcons = async (parsed) => {
  const iconAgents = Array.isArray(parsed.agents)
    ? parsed.agents.filter((agent) => agent?.id && isCacheableRegistryIcon(agent.icon))
    : []

  await fs.rm(ICON_TMP_DIR, { recursive: true, force: true })
  await fs.mkdir(ICON_TMP_DIR, { recursive: true })

  await Promise.all(
    iconAgents.map(async (agent) => {
      const response = await fetch(agent.icon)
      if (!response.ok) {
        throw new Error(`Failed to fetch ACP icon ${agent.id}: ${response.status} ${response.statusText}`)
      }

      const text = await response.text()
      await fs.writeFile(path.join(ICON_TMP_DIR, `${agent.id}.svg`), text, 'utf-8')
    })
  )

  await fs.rm(ICON_OUTPUT_DIR, { recursive: true, force: true })
  await fs.rename(ICON_TMP_DIR, ICON_OUTPUT_DIR)

  return iconAgents.length
}

const main = async () => {
  const response = await fetch(REGISTRY_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch ACP registry: ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  const parsed = JSON.parse(text)

  await writeManifest(parsed)
  const iconCount = await downloadIcons(parsed)

  console.log(`[fetch-acp-registry] wrote ${OUTPUT_PATH}`)
  console.log(`[fetch-acp-registry] wrote ${iconCount} icons to ${ICON_OUTPUT_DIR}`)
}

main().catch((error) => {
  console.error('[fetch-acp-registry] failed:', error)
  process.exitCode = 1
})
