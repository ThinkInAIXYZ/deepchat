import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(rootDir, 'test/fixtures/memory/retrieval-v1.json')
const subsetDefinitions = [
  ['exact', (index) => `Project Atlas retention policy ${index}`, (index) => `Project Atlas retention policy ${index} is enabled.`],
  ['cjk', (index) => `偏好简洁中文回答${index}`, (index) => `用户偏好简洁中文回答${index}，避免冗长铺垫。`],
  ['path', (index) => `/workspace/services/api${index}/config.yaml`, (index) => `Deployment settings live at /workspace/services/api${index}/config.yaml.`],
  ['code', (index) => `resolveAgentCache${index}`, (index) => `The helper resolveAgentCache${index} invalidates stale entries.`],
  ['semantic', (index) => ['incident', 'login', 'slowness', 'prune', 'invoice', 'release', 'memoization', 'localtime', 'brief', 'snapshot'][index - 1], (index) => ['Outage', 'Auth', 'Latency', 'Cleanup', 'Billing', 'Deploy', 'Cache', 'Timezone', 'Concise', 'Backup'][index - 1]],
  ['mixed', (index) => `修复 Redis session timeout ${index}`, (index) => `修复 Redis session timeout ${index} 时保留审计记录。`]
]

const fixture = {
  version: 1,
  vectorProfile: { id: 'deterministic-lexicon-v1', dimensions: 128, normalized: true },
  corpus: [],
  queries: []
}

for (const [subset, queryText, corpusText] of subsetDefinitions) {
  for (let index = 1; index <= 10; index += 1) {
    const suffix = String(index).padStart(2, '0')
    const agentId = index % 2 === 0 ? 'agent-beta' : 'agent-alpha'
    const otherAgentId = agentId === 'agent-alpha' ? 'agent-beta' : 'agent-alpha'
    const relevantId = `${subset}-${suffix}-relevant`
    const secondaryRelevantId = `${subset}-${suffix}-secondary-relevant`
    const hasMultipleRelevant = subset === 'exact' && index === 1
    const text = corpusText(index)
    fixture.queries.push({
      id: `${subset}-${suffix}`,
      agentId,
      text: queryText(index),
      subsets: [subset],
      relevantIds: hasMultipleRelevant ? [relevantId, secondaryRelevantId] : [relevantId]
    })
    fixture.corpus.push(
      { id: relevantId, agentId, kind: 'semantic', content: text, importance: 0.8 },
      { id: `${subset}-${suffix}-cross-agent`, agentId: otherAgentId, kind: 'semantic', content: text, importance: 0.9 },
      hasMultipleRelevant
        ? {
            id: secondaryRelevantId,
            agentId,
            kind: 'episodic',
            content: text,
            importance: 0.7
          }
        : {
            id: `${subset}-${suffix}-distractor-a`,
            agentId,
            kind: 'episodic',
            content: `Unrelated gardening note ${subset} ${index} about soil and watering.`,
            importance: 0.4
          },
      { id: `${subset}-${suffix}-distractor-b`, agentId, kind: 'reflection', content: `General retrospective ${subset} ${index} without the requested detail.`, importance: 0.3 }
    )
  }
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`Wrote ${fixture.corpus.length} corpus rows and ${fixture.queries.length} queries to ${outputPath}`)
