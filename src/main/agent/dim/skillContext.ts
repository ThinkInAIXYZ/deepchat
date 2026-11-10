import { createHash } from 'node:crypto'
import type { SkillServicePort } from '@shared/types/skill'
import type { JsonValue } from '@shared/contracts/json'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimProductContextReply } from './productGateway'

interface SkillContextOptions {
  skills: Pick<SkillServicePort, 'getMetadataList' | 'getActiveSkills' | 'viewSkillForAgent'>
  session(id: string): { agentId: string; projectDir?: string | null } | null | undefined
}
const MAX_BYTES = 4 * 1024 * 1024
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

/** DeepChat owns private assignments and selection. dim owns loading/execution tools and context. */
export class DimSkillContext {
  constructor(private readonly options: SkillContextOptions) {}

  async contribute(
    binding: Readonly<DimSessionBinding>,
    signal: AbortSignal
  ): Promise<DimProductContextReply> {
    const id = binding.sessionId
    const row = this.options.session(id)
    if (!row) throw new Error('Skill context belongs to a closed desktop session')
    const { agentId, projectDir } = row
    const check = () => {
      signal.throwIfAborted()
      const current = this.options.session(id)
      if (!current || current.agentId !== agentId || current.projectDir !== projectDir)
        throw new Error('Skill context belongs to a replaced Agent or workspace')
    }
    check()
    const active = await this.options.skills.getActiveSkills(id)
    check()
    if (!active.length) return { messages: [], receipts: [] }
    const metadata = await this.options.skills.getMetadataList(agentId, { conversationId: id })
    check()
    const catalog = metadata
      .filter(({ name }) => active.includes(name))
      .map(({ name, description, path, skillRoot }) => ({
        name,
        description,
        path,
        skillRoot
      }))
    const selected: JsonValue[] = []
    const bodies: string[] = []
    let bytes = 0
    for (const name of active) {
      const entry = catalog.find((entry) => entry.name === name)
      if (!entry) throw new Error('Selected skill is no longer available to this Agent')
      const view = await this.options.skills.viewSkillForAgent(agentId, name, {
        conversationId: id
      })
      check()
      if (!view.success || !view.content || view.skillRoot !== entry.skillRoot)
        throw new Error('Selected skill changed or cannot be loaded safely')
      // A transport bound only. Never truncate selected instructions; native context owns tokens.
      bytes += Buffer.byteLength(view.content)
      if (bytes > MAX_BYTES) throw new Error('Selected skills exceed the context transport limit')
      bodies.push(
        `$skill: ${name}\n<dim-skill name=${JSON.stringify(name)}>\n${view.content}\n</dim-skill>`
      )
      selected.push({ name, skillRoot: entry.skillRoot, contentHash: hash(view.content) })
    }
    const currentActive = await this.options.skills.getActiveSkills(id)
    check()
    if (JSON.stringify(active) !== JSON.stringify(currentActive))
      throw new Error('Skill selection changed during context preparation')
    const currentMetadata = await this.options.skills.getMetadataList(agentId, {
      conversationId: id
    })
    check()
    const currentCatalog = currentMetadata
      .filter(({ name }) => active.includes(name))
      .map(({ name, description, path, skillRoot }) => ({
        name,
        description,
        path,
        skillRoot
      }))
    const serialized = JSON.stringify(catalog)
    if (serialized !== JSON.stringify(currentCatalog))
      throw new Error('Assigned skill catalog changed during context preparation')
    if (!catalog.length) return { messages: [], receipts: [] }
    const content = [
      'DeepChat-selected skills for the current Agent and workspace:',
      serialized,
      'The selected skills below are already loaded. Follow their applicable instructions. Use dim read for their listed files and dim exec for scripts; paths are relative to each skill root. Tool permissions still come from dim.',
      ...bodies
    ].join('\n\n')
    if (Buffer.byteLength(content) > MAX_BYTES)
      throw new Error('Assigned skills exceed the context transport limit')
    return {
      messages: [{ role: 'user', content }],
      receipts: [{ source: 'deepchat/skills', version: 1, catalogHash: hash(serialized), selected }]
    }
  }
}
