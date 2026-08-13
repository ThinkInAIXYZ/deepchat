import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { app } from 'electron'
import type {
  AgentSkillImportPreview,
  AgentSkillImportPreviewItem,
  AgentSkillImportResult,
  AgentSkillImportSelection,
  AgentSkillImportSource,
  AgentSkillImportSourceInfo
} from '@shared/types/agentSkillImport'
import {
  SKILL_NAME_MAX_LENGTH,
  type SkillInstallOptions,
  type SkillServicePort
} from '@shared/types/skill'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'
import type { CanonicalSkill, SkillSyncServicePort } from '@shared/types/skillSync'
import { formatConverter } from './sync/formatConverter'
import { isFilenameSafe } from './sync/security'

const IMPORTABLE_SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

export interface AgentSkillImportServiceDependencies {
  skills: Pick<SkillServicePort, 'getAllSkills' | 'installImportedSkill'>
  external: Pick<SkillSyncServicePort, 'scanExternalTools' | 'previewImport'>
}

type ResolvedImportItem = {
  preview: AgentSkillImportPreviewItem
  canonicalSkill?: CanonicalSkill
}

type NormalizedImportSelection = {
  skillName: string
  strategy: AgentSkillImportSelection['strategy']
  acknowledgedAgentIds: string[]
}

const sourceId = (source: AgentSkillImportSource): string => `external:${source.toolId}`

const normalizeNames = (names?: readonly string[]): string[] | undefined => {
  if (!names) return undefined
  return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  )
}

export class AgentSkillImportService {
  constructor(private readonly dependencies: AgentSkillImportServiceDependencies) {}

  async listSources(): Promise<AgentSkillImportSourceInfo[]> {
    const externalResults = await this.dependencies.external.scanExternalTools()
    return externalResults
      .map(
        (result): AgentSkillImportSourceInfo => ({
          id: sourceId({ kind: 'external', toolId: result.toolId }),
          source: { kind: 'external', toolId: result.toolId },
          name: result.toolName,
          available: result.available,
          skillCount: result.skills.length
        })
      )
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  async preview(input: {
    source: AgentSkillImportSource
    skillNames?: string[]
  }): Promise<AgentSkillImportPreview> {
    const items = await this.resolveExternalItems(input.source.toolId, input.skillNames)
    return {
      source: input.source,
      items: items.map((item) => item.preview)
    }
  }

  async execute(input: {
    source: AgentSkillImportSource
    items: AgentSkillImportSelection[]
  }): Promise<AgentSkillImportResult> {
    const selections = this.normalizeSelections(input.items).sort((left, right) =>
      left.skillName.localeCompare(right.skillName)
    )
    const requestedNames = selections.map((item) => item.skillName)
    const resolvedItems = await this.resolveExternalItems(input.source.toolId, requestedNames)
    const resolvedByName = new Map(resolvedItems.map((item) => [item.preview.name, item]))
    const result: AgentSkillImportResult = {
      success: true,
      imported: [],
      reused: [],
      skipped: [],
      failed: []
    }

    for (const selection of selections) {
      const skillName = selection.skillName
      const resolved = resolvedByName.get(skillName)
      if (!resolved || resolved.preview.status === 'unavailable') {
        result.failed.push({
          skillName,
          reason:
            resolved?.preview.warning ?? 'Skill is no longer available from the external Agent.'
        })
        continue
      }
      if (resolved.preview.status === 'conflict' && selection.strategy === 'skip') {
        result.skipped.push(skillName)
        continue
      }
      if (
        resolved.preview.status === 'conflict' &&
        selection.strategy === 'overwrite' &&
        !this.sameNames(resolved.preview.affectedAgentIds ?? [], selection.acknowledgedAgentIds)
      ) {
        result.failed.push({
          skillName,
          reason: 'Enabled Agent impact changed; preview the import again.'
        })
        continue
      }

      let temporaryDirectory: string | null = null
      try {
        if (resolved.preview.status === 'same') {
          result.reused.push(skillName)
          continue
        }

        temporaryDirectory = await this.materializeCanonicalSkill(resolved)
        const options: SkillInstallOptions = {
          overwrite: resolved.preview.status === 'conflict' && selection.strategy === 'overwrite',
          acknowledgedAgentIds:
            resolved.preview.status === 'conflict' && selection.strategy === 'overwrite'
              ? selection.acknowledgedAgentIds
              : undefined,
          targetName:
            resolved.preview.status === 'conflict' && selection.strategy === 'rename'
              ? resolved.preview.suggestedTargetName
              : resolved.preview.name
        }
        const installed = await this.dependencies.skills.installImportedSkill(
          [],
          temporaryDirectory,
          { importedFrom: `external:${input.source.toolId}/${skillName}` },
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

    result.success = result.failed.length === 0
    return result
  }

  private async resolveExternalItems(
    toolId: string,
    requestedNames?: string[]
  ): Promise<ResolvedImportItem[]> {
    const scans = await this.dependencies.external.scanExternalTools()
    const source = scans.find((result) => result.toolId === toolId)
    if (!source?.available) throw new Error(`External Agent is unavailable: ${toolId}`)

    const names = normalizeNames(requestedNames) ?? source.skills.map((skill) => skill.name)
    const [previews, allSkills] = await Promise.all([
      this.dependencies.external.previewImport(toolId, names),
      this.dependencies.skills.getAllSkills()
    ])
    const previewByName = new Map(previews.map((preview) => [preview.skill.name, preview]))
    const sourceByName = new Map(source.skills.map((skill) => [skill.name, skill]))
    const skillByName = new Map(allSkills.map((skill) => [skill.name, skill]))
    const occupiedNames = new Set([...skillByName.keys(), ...names])
    const resolved: ResolvedImportItem[] = []

    for (const name of names) {
      const preview = previewByName.get(name)
      const sourceInfo = sourceByName.get(name)
      const parseWarning = preview?.warnings.find((warning) => warning.startsWith('Parse error:'))
      const existing = skillByName.get(name)
      const unavailable = !sourceInfo || !preview || Boolean(parseWarning)
      const same =
        !unavailable && existing && preview
          ? await this.isCanonicalSkillSame(existing, preview.skill)
          : false
      const conflict = Boolean(existing && !same)
      const suggestedTargetName = conflict ? this.nextAvailableName(name, occupiedNames) : undefined
      if (suggestedTargetName) occupiedNames.add(suggestedTargetName)
      resolved.push({
        preview: {
          name,
          description: preview?.skill.description ?? sourceInfo?.description ?? '',
          status: unavailable ? 'unavailable' : same ? 'same' : conflict ? 'conflict' : 'ready',
          suggestedTargetName,
          affectedAgentIds: conflict ? existing?.assignedAgentIds : undefined,
          warning: !sourceInfo ? 'Skill is no longer present in the external Agent.' : parseWarning
        },
        canonicalSkill: preview?.skill
      })
    }
    return resolved.sort((left, right) => left.preview.name.localeCompare(right.preview.name))
  }

  private async isCanonicalSkillSame(
    existing: UnifiedSkillItem,
    canonicalSkill: CanonicalSkill
  ): Promise<boolean> {
    const temporaryDirectory = await this.materializeCanonicalSkill({
      preview: {
        name: canonicalSkill.name,
        description: canonicalSkill.description,
        status: 'ready'
      },
      canonicalSkill
    })
    try {
      const [existingHash, importedHash] = await Promise.all([
        this.createDirectoryHash(existing.skillRoot),
        this.createDirectoryHash(temporaryDirectory)
      ])
      return existingHash === importedHash
    } catch {
      return false
    } finally {
      await fs.promises
        .rm(temporaryDirectory, { recursive: true, force: true })
        .catch(() => undefined)
    }
  }

  private async createDirectoryHash(root: string): Promise<string> {
    const directoryHash = createHash('sha256')

    const visit = async (current: string): Promise<void> => {
      const entries = await fs.promises.readdir(current, { withFileTypes: true })
      entries.sort((left, right) => left.name.localeCompare(right.name))

      for (const entry of entries) {
        if (entry.isSymbolicLink() || entry.name === '.deepchat-meta') continue
        const fullPath = path.join(current, entry.name)
        if (entry.isDirectory()) {
          await visit(fullPath)
          continue
        }
        if (!entry.isFile()) continue

        const fileHash = createHash('sha256')
        for await (const chunk of fs.createReadStream(fullPath)) {
          fileHash.update(chunk)
        }
        directoryHash.update(path.relative(root, fullPath))
        directoryHash.update('\0')
        directoryHash.update(fileHash.digest())
      }
    }

    await visit(root)
    return directoryHash.digest('hex')
  }

  private nextAvailableName(baseName: string, occupiedNames: ReadonlySet<string>): string {
    let suffix = 1
    let copySuffix = '-copy'
    let candidate = `${baseName.slice(0, SKILL_NAME_MAX_LENGTH - copySuffix.length)}${copySuffix}`
    while (occupiedNames.has(candidate)) {
      suffix += 1
      copySuffix = `-copy-${suffix}`
      candidate = `${baseName.slice(0, SKILL_NAME_MAX_LENGTH - copySuffix.length)}${copySuffix}`
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
      if (
        skillName.length > SKILL_NAME_MAX_LENGTH ||
        !IMPORTABLE_SKILL_NAME_PATTERN.test(skillName)
      ) {
        throw new Error(`Invalid Skill name in import request: ${item.skillName}`)
      }
      if (seen.has(skillName)) {
        throw new Error(`Duplicate Skill selection in import request: ${skillName}`)
      }
      seen.add(skillName)
      selections.push({
        skillName,
        strategy: item.strategy,
        acknowledgedAgentIds: Array.from(new Set(item.acknowledgedAgentIds ?? [])).sort()
      })
    }
    return selections
  }

  private async materializeCanonicalSkill(item: ResolvedImportItem): Promise<string> {
    if (!item.canonicalSkill) throw new Error('External Skill could not be converted.')
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

  private sameNames(left: string[], right: string[]): boolean {
    const normalizedLeft = Array.from(new Set(left)).sort()
    const normalizedRight = Array.from(new Set(right)).sort()
    return (
      normalizedLeft.length === normalizedRight.length &&
      normalizedLeft.every((value, index) => value === normalizedRight[index])
    )
  }
}
