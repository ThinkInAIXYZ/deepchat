import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type { Agent } from '@shared/types/agent-interface'
import type {
  AgentSkillImportPreview,
  AgentSkillImportPreviewItem,
  AgentSkillImportResult,
  AgentSkillImportSelection,
  AgentSkillImportSource,
  AgentSkillImportSourceInfo
} from '@shared/types/agentSkillImport'
import type { SkillInstallOptions, SkillServicePort } from '@shared/types/skill'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'
import type { CanonicalSkill, SkillSyncServicePort } from '@shared/types/skillSync'
import { formatConverter } from './sync/formatConverter'
import { isFilenameSafe } from './sync/security'

const IMPORTABLE_AGENT_TYPE = 'deepchat'
const IMPORTABLE_SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

export interface AgentSkillImportAgentPort {
  listAgents(): Promise<Agent[]>
  getAgent(agentId: string): Promise<Agent | null>
}

export interface AgentSkillImportServiceDependencies {
  agents: AgentSkillImportAgentPort
  skills: Pick<
    SkillServicePort,
    | 'getSkillsDir'
    | 'getUnifiedSkillCatalog'
    | 'installImportedSkillForAgent'
    | 'refreshAgentCatalog'
  >
  external: Pick<SkillSyncServicePort, 'scanExternalTools' | 'previewImport'>
}

type ResolvedImportItem = {
  preview: AgentSkillImportPreviewItem
  sourcePath?: string
  canonicalSkill?: CanonicalSkill
}

type NormalizedImportSelection = {
  skillName: string
  strategy: AgentSkillImportSelection['strategy']
}

const sourceId = (source: AgentSkillImportSource): string =>
  source.kind === 'internal' ? `internal:${source.agentId}` : `external:${source.toolId}`

const normalizeNames = (names?: readonly string[]): string[] | undefined => {
  if (!names) return undefined
  return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  )
}

export class AgentSkillImportService {
  constructor(private readonly dependencies: AgentSkillImportServiceDependencies) {}

  async listSources(targetAgentId: string): Promise<AgentSkillImportSourceInfo[]> {
    await this.requireDeepChatAgent(targetAgentId)
    const [agents, externalResults] = await Promise.all([
      this.dependencies.agents.listAgents(),
      this.dependencies.external.scanExternalTools()
    ])

    const internalSources = await Promise.all(
      agents
        .filter((agent) => agent.type === IMPORTABLE_AGENT_TYPE && agent.id !== targetAgentId)
        .map(async (agent): Promise<AgentSkillImportSourceInfo> => {
          const skills = await this.dependencies.skills.getUnifiedSkillCatalog(agent.id)
          return {
            id: sourceId({ kind: 'internal', agentId: agent.id }),
            source: { kind: 'internal', agentId: agent.id },
            name: agent.name,
            available: true,
            skillCount: skills.filter((skill) => !skill.ownerPluginId).length
          }
        })
    )
    const externalSources = externalResults.map(
      (result): AgentSkillImportSourceInfo => ({
        id: sourceId({ kind: 'external', toolId: result.toolId }),
        source: { kind: 'external', toolId: result.toolId },
        name: result.toolName,
        available: result.available,
        skillCount: result.skills.length
      })
    )

    return [...internalSources, ...externalSources].sort((left, right) => {
      if (left.source.kind !== right.source.kind) {
        return left.source.kind === 'internal' ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
  }

  async preview(input: {
    targetAgentId: string
    source: AgentSkillImportSource
    skillNames?: string[]
  }): Promise<AgentSkillImportPreview> {
    await this.requireDeepChatAgent(input.targetAgentId)
    const items = await this.resolveImportItems(input)
    return {
      targetAgentId: input.targetAgentId,
      source: input.source,
      items: items.map((item) => item.preview)
    }
  }

  async execute(input: {
    targetAgentId: string
    source: AgentSkillImportSource
    items: AgentSkillImportSelection[]
  }): Promise<AgentSkillImportResult> {
    await this.requireDeepChatAgent(input.targetAgentId)
    const selections = this.normalizeSelections(input.items)
    const requestedNames = selections
      .map((item) => item.skillName)
      .sort((left, right) => left.localeCompare(right))
    const strategies = new Map(selections.map((item) => [item.skillName, item.strategy]))
    const resolvedItems = await this.resolveImportItems({
      targetAgentId: input.targetAgentId,
      source: input.source,
      skillNames: requestedNames
    })
    const resolvedByName = new Map(resolvedItems.map((item) => [item.preview.name, item]))
    const result: AgentSkillImportResult = {
      success: true,
      imported: [],
      skipped: [],
      failed: []
    }

    for (const skillName of requestedNames) {
      const resolved = resolvedByName.get(skillName)
      const strategy = strategies.get(skillName) ?? 'skip'
      if (!resolved || resolved.preview.status === 'unavailable') {
        result.failed.push({
          skillName,
          reason: resolved?.preview.warning ?? 'Skill is no longer available from the source Agent.'
        })
        continue
      }
      if (resolved.preview.status === 'conflict' && strategy === 'skip') {
        result.skipped.push(skillName)
        continue
      }

      let temporaryDirectory: string | null = null
      try {
        const sourcePath = resolved.sourcePath ?? (await this.materializeCanonicalSkill(resolved))
        if (!resolved.sourcePath) temporaryDirectory = sourcePath
        if (resolved.sourcePath && (await fs.promises.lstat(sourcePath)).isSymbolicLink()) {
          throw new Error('Symbolic-link Skill roots cannot be imported as snapshots.')
        }

        const options: SkillInstallOptions = {
          overwrite: resolved.preview.status === 'conflict' && strategy === 'overwrite',
          targetName:
            resolved.preview.status === 'conflict' && strategy === 'rename'
              ? resolved.preview.suggestedTargetName
              : resolved.preview.name
        }
        const installed = await this.dependencies.skills.installImportedSkillForAgent(
          input.targetAgentId,
          sourcePath,
          input.source.kind === 'internal'
            ? {
                importedFrom: `agent:${input.source.agentId}/${skillName}`,
                sourceAgentId: input.source.agentId
              }
            : { importedFrom: `external:${input.source.toolId}/${skillName}` },
          options
        )
        if (!installed.success || !installed.skillName) {
          throw new Error(installed.error || 'Skill installation failed.')
        }
        result.imported.push(installed.skillName)
      } catch (error) {
        result.failed.push({
          skillName,
          reason: error instanceof Error ? error.message : String(error)
        })
      } finally {
        if (temporaryDirectory) {
          await fs.promises
            .rm(temporaryDirectory, { recursive: true, force: true })
            .catch(() => undefined)
        }
      }
    }

    if (result.imported.length > 0) {
      await this.dependencies.skills.refreshAgentCatalog(input.targetAgentId)
    }
    result.success = result.failed.length === 0
    return result
  }

  private async resolveImportItems(input: {
    targetAgentId: string
    source: AgentSkillImportSource
    skillNames?: string[]
  }): Promise<ResolvedImportItem[]> {
    if (input.source.kind === 'internal') {
      return await this.resolveInternalItems(
        input.targetAgentId,
        input.source.agentId,
        input.skillNames
      )
    }
    return await this.resolveExternalItems(
      input.targetAgentId,
      input.source.toolId,
      input.skillNames
    )
  }

  private async resolveInternalItems(
    targetAgentId: string,
    sourceAgentId: string,
    requestedNames?: string[]
  ): Promise<ResolvedImportItem[]> {
    if (sourceAgentId === targetAgentId) {
      throw new Error('Source and target Agents must be different.')
    }
    await this.requireDeepChatAgent(sourceAgentId)
    const [sourceCatalog, targetCatalog, sourceRoot] = await Promise.all([
      this.dependencies.skills.getUnifiedSkillCatalog(sourceAgentId),
      this.dependencies.skills.getUnifiedSkillCatalog(targetAgentId),
      this.dependencies.skills.getSkillsDir(sourceAgentId)
    ])
    const selected = this.selectInternalSkills(sourceCatalog, requestedNames)
    return this.buildResolvedItems(
      await Promise.all(
        selected.map(async (skill) => {
          const sourcePath = skill.skillRoot
          const validSourcePath = await this.isSafeInternalSourcePath(sourcePath, sourceRoot)
          return {
            name: skill.name,
            description: skill.description,
            sourcePath: validSourcePath ? sourcePath : undefined,
            unavailable: Boolean(skill.ownerPluginId) || !validSourcePath,
            warning: skill.ownerPluginId
              ? 'Plugin-owned Skills cannot be copied outside their Plugin lifecycle.'
              : validSourcePath
                ? undefined
                : 'Skill source is outside the owning Agent Skill root.'
          }
        })
      ),
      targetCatalog
    )
  }

  private async resolveExternalItems(
    targetAgentId: string,
    toolId: string,
    requestedNames?: string[]
  ): Promise<ResolvedImportItem[]> {
    const scans = await this.dependencies.external.scanExternalTools()
    const source = scans.find((result) => result.toolId === toolId)
    if (!source?.available) {
      throw new Error(`External Agent is unavailable: ${toolId}`)
    }
    const names = normalizeNames(requestedNames) ?? source.skills.map((skill) => skill.name)
    const [previews, targetCatalog] = await Promise.all([
      this.dependencies.external.previewImport(toolId, names),
      this.dependencies.skills.getUnifiedSkillCatalog(targetAgentId)
    ])
    const previewByName = new Map(previews.map((preview) => [preview.skill.name, preview]))
    const sourceByName = new Map(source.skills.map((skill) => [skill.name, skill]))
    const sourceItems = names.map((name) => {
      const preview = previewByName.get(name)
      const sourceInfo = sourceByName.get(name)
      const parseWarning = preview?.warnings.find((warning) => warning.startsWith('Parse error:'))
      return {
        name,
        description: preview?.skill.description ?? sourceInfo?.description ?? '',
        canonicalSkill: preview?.skill,
        unavailable: !sourceInfo || !preview || Boolean(parseWarning),
        warning: !sourceInfo ? 'Skill is no longer present in the external Agent.' : parseWarning
      }
    })
    return this.buildResolvedItems(sourceItems, targetCatalog)
  }

  private buildResolvedItems(
    sourceItems: Array<{
      name: string
      description: string
      sourcePath?: string
      canonicalSkill?: CanonicalSkill
      unavailable: boolean
      warning?: string
    }>,
    targetCatalog: UnifiedSkillItem[]
  ): ResolvedImportItem[] {
    const occupiedNames = new Set(targetCatalog.map((skill) => skill.name))
    return sourceItems
      .map((item): ResolvedImportItem => {
        const conflict = occupiedNames.has(item.name)
        const suggestedTargetName = conflict
          ? this.nextAvailableName(item.name, occupiedNames)
          : undefined
        if (suggestedTargetName) occupiedNames.add(suggestedTargetName)
        return {
          preview: {
            name: item.name,
            description: item.description,
            status: item.unavailable ? 'unavailable' : conflict ? 'conflict' : 'ready',
            suggestedTargetName,
            warning: item.warning
          },
          sourcePath: item.sourcePath,
          canonicalSkill: item.canonicalSkill
        }
      })
      .sort((left, right) => left.preview.name.localeCompare(right.preview.name))
  }

  private selectInternalSkills(
    catalog: UnifiedSkillItem[],
    requestedNames?: string[]
  ): UnifiedSkillItem[] {
    const names = normalizeNames(requestedNames)
    if (!names) return catalog
    const byName = new Map(catalog.map((skill) => [skill.name, skill]))
    return names
      .map((name) => byName.get(name))
      .filter((skill): skill is UnifiedSkillItem => Boolean(skill))
  }

  private async isSafeInternalSourcePath(sourcePath: string, sourceRoot: string): Promise<boolean> {
    try {
      const [sourceStats, resolvedSource, resolvedRoot] = await Promise.all([
        fs.promises.lstat(sourcePath),
        fs.promises.realpath(sourcePath),
        fs.promises.realpath(sourceRoot)
      ])
      if (sourceStats.isSymbolicLink() || !sourceStats.isDirectory()) return false
      const relative = path.relative(resolvedRoot, resolvedSource)
      return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
    } catch {
      return false
    }
  }

  private nextAvailableName(baseName: string, occupiedNames: ReadonlySet<string>): string {
    let suffix = 1
    let candidate = `${baseName}-copy`
    while (occupiedNames.has(candidate)) {
      suffix += 1
      candidate = `${baseName}-copy-${suffix}`
    }
    return candidate
  }

  private normalizeSelections(
    items: readonly AgentSkillImportSelection[]
  ): NormalizedImportSelection[] {
    const selections: NormalizedImportSelection[] = []
    const seen = new Set<string>()
    for (const item of items) {
      const skillName = item.skillName.trim()
      if (!IMPORTABLE_SKILL_NAME_PATTERN.test(skillName)) {
        throw new Error(`Invalid Skill name in import request: ${item.skillName}`)
      }
      if (seen.has(skillName)) {
        throw new Error(`Duplicate Skill selection in import request: ${skillName}`)
      }
      seen.add(skillName)
      selections.push({ skillName, strategy: item.strategy })
    }
    return selections
  }

  private async materializeCanonicalSkill(item: ResolvedImportItem): Promise<string> {
    if (!item.canonicalSkill) {
      throw new Error('External Skill could not be converted.')
    }
    const root = await fs.promises.mkdtemp(
      path.join(app.getPath('temp'), `deepchat-agent-skill-import-${randomUUID()}-`)
    )
    try {
      await fs.promises.writeFile(
        path.join(root, 'SKILL.md'),
        formatConverter.serializeToSkillMd(item.canonicalSkill),
        'utf-8'
      )
      await this.writeCanonicalFiles(root, item.canonicalSkill)
      return root
    } catch (error) {
      await fs.promises.rm(root, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  private async writeCanonicalFiles(root: string, skill: CanonicalSkill): Promise<void> {
    const files = [
      ...(skill.references ?? []).map((file) => ({
        topLevelDirectory: 'references',
        relativePath: file.relativePath || path.join('references', file.name),
        content: file.content
      })),
      ...(skill.scripts ?? []).map((file) => ({
        topLevelDirectory: 'scripts',
        relativePath: file.relativePath || path.join('scripts', file.name),
        content: file.content
      }))
    ]
    const writtenPaths = new Set<string>()
    for (const file of files) {
      const segments = file.relativePath.split(/[\\/]/).filter(Boolean)
      if (
        path.isAbsolute(file.relativePath) ||
        /^[\\/]/.test(file.relativePath) ||
        segments.length < 2 ||
        segments[0] !== file.topLevelDirectory ||
        segments.some((segment) => !isFilenameSafe(segment))
      ) {
        throw new Error(`Unsafe imported Skill path: ${file.relativePath}`)
      }
      const targetPath = path.resolve(root, ...segments)
      const relativeTarget = path.relative(path.resolve(root), targetPath)
      if (!relativeTarget || relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
        throw new Error(`Imported Skill path escapes the target root: ${file.relativePath}`)
      }
      if (writtenPaths.has(targetPath)) {
        throw new Error(`Duplicate imported Skill path: ${file.relativePath}`)
      }
      writtenPaths.add(targetPath)
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.promises.writeFile(targetPath, file.content, 'utf-8')
    }
  }

  private async requireDeepChatAgent(agentId: string): Promise<Agent> {
    const agent = await this.dependencies.agents.getAgent(agentId)
    if (!agent || agent.type !== IMPORTABLE_AGENT_TYPE) {
      throw new Error(`DeepChat Agent not found: ${agentId}`)
    }
    return agent
  }
}
