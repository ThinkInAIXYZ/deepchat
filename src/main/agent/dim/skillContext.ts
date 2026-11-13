import { createHash } from 'node:crypto'
import type { SkillServicePort } from '@shared/types/skill'
import type { JsonValue } from '@shared/contracts/json'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimProductContextReply } from './productGateway'
import type { DimSessionRef } from './sessionConnection'
import type { DimSkillCatalog } from './skillCatalog'

interface SkillContextOptions {
  skills: Pick<SkillServicePort, 'getMetadataList' | 'getActiveSkills' | 'viewSkillForAgent'>
  session(id: string): { agentId: string; projectDir?: string | null } | null | undefined
  catalog: Pick<DimSkillCatalog, 'publish'>
}
const MAX_BYTES = 4 * 1024 * 1024
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

/** DeepChat owns private assignments and selection. dim owns loading/execution tools and context. */
export class DimSkillContext {
  constructor(private readonly options: SkillContextOptions) {}

  async contribute(
    binding: Readonly<DimSessionBinding>,
    signal: AbortSignal,
    ref: DimSessionRef = { sessionId: binding.dimSessionId, branchId: binding.branchId }
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
    const metadata = await this.options.skills.getMetadataList(agentId, { conversationId: id })
    check()
    const catalog = metadata.map(({ name, description, path, skillRoot }) => ({
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
    const currentCatalog = currentMetadata.map(({ name, description, path, skillRoot }) => ({
      name,
      description,
      path,
      skillRoot
    }))
    const serialized = JSON.stringify(catalog, null, 2)
    if (serialized !== JSON.stringify(currentCatalog, null, 2))
      throw new Error('Assigned skill catalog changed during context preparation')
    if (!catalog.length) return { messages: [], receipts: [] }
    if (Buffer.byteLength(serialized) > MAX_BYTES)
      throw new Error('Assigned skill catalog exceeds the transport limit')
    const receipt = await this.options.catalog.publish(ref, serialized, signal)
    check()
    const finalActive = await this.options.skills.getActiveSkills(id)
    check()
    const finalMetadata = await this.options.skills.getMetadataList(agentId, { conversationId: id })
    check()
    if (
      JSON.stringify(active) !== JSON.stringify(finalActive) ||
      serialized !==
        JSON.stringify(
          finalMetadata.map(({ name, description, path, skillRoot }) => ({
            name,
            description,
            path,
            skillRoot
          })),
          null,
          2
        )
    )
      throw new Error('Assigned skill catalog changed during publication')
    const content = [
      `Agent skills catalog: ${JSON.stringify(receipt.path)}`,
      'Use dim read for the catalog and applicable SKILL.md; dim exec runs bundled scripts.',
      ...(bodies.length ? ['Selected instructions are already loaded:'] : []),
      ...bodies
    ].join('\n\n')
    if (Buffer.byteLength(content) > MAX_BYTES)
      throw new Error('Assigned skills exceed the context transport limit')
    return {
      messages: [{ role: 'user', content }],
      receipts: [{ source: 'deepchat/skills', version: 2, ...receipt, selected }]
    }
  }
}
