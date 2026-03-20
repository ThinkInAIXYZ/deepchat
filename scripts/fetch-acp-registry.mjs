import fs from 'fs/promises'
import path from 'path'

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
const OUTPUT_PATH = path.resolve(process.cwd(), 'resources', 'acp-registry', 'registry.json')

const main = async () => {
  const response = await fetch(REGISTRY_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch ACP registry: ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  const parsed = JSON.parse(text)

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
  console.log(`[fetch-acp-registry] wrote ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error('[fetch-acp-registry] failed:', error)
  process.exitCode = 1
})
