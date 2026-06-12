import logger from '@shared/logger'
import type { SkillMetadata } from '@shared/types/skill'
import { runInlineJsonWorker } from '@/lib/runInlineJsonWorker'

type SkillDiscoveryWarning =
  | {
      type: 'scan-skip'
      currentDir: string
      error: string
    }
  | {
      type: 'parse-failed'
      skillPath: string
      error: string
    }
  | {
      type: 'duplicate-skill-name'
      name: string
      path: string
    }
  | {
      type: 'invalid-frontmatter'
      dirName: string
      skillPath: string
    }
  | {
      type: 'name-mismatch'
      dirName: string
      declaredName: string
      skillPath: string
    }

type SkillDiscoveryWorkerInput = {
  skillsDir: string
  sidecarDirName: string
  maxDepth: number
}

type SkillDiscoveryWorkerOutput = {
  skills: SkillMetadata[]
  warnings: SkillDiscoveryWarning[]
}

const DISCOVERY_WORKER_SOURCE = String.raw`
const requireFromBundle = globalThis.__inlineWorkerRequire || require
const { parentPort, workerData } = requireFromBundle('node:worker_threads')
const fs = requireFromBundle('fs')
const path = requireFromBundle('path')
const matter = requireFromBundle('gray-matter')

function shouldIgnoreSkillsRootEntry(entryName, sidecarDirName) {
  return (
    entryName === sidecarDirName ||
    entryName.includes('.backup-') ||
    entryName.startsWith('.')
  )
}

function collectSkillManifestPaths(currentDir, maxDepth, sidecarDirName, depth = 0, acc = [], warnings = []) {
  if (depth > maxDepth) {
    return acc
  }

  let entries
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true })
  } catch (error) {
    warnings.push({
      type: 'scan-skip',
      currentDir,
      error: error instanceof Error ? error.message : String(error)
    })
    return acc
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink && entry.isSymbolicLink()) {
      continue
    }

    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      if (shouldIgnoreSkillsRootEntry(entry.name, sidecarDirName)) {
        continue
      }
      collectSkillManifestPaths(fullPath, maxDepth, sidecarDirName, depth + 1, acc, warnings)
      continue
    }

    if (entry.name === 'SKILL.md') {
      acc.push(fullPath)
    }
  }

  return acc
}

function deriveSkillCategory(skillsDir, skillRoot) {
  const relative = path.relative(skillsDir, skillRoot)
  if (!relative || relative === '.' || path.isAbsolute(relative)) {
    return null
  }

  const segments = relative.split(path.sep).filter(Boolean)
  return segments.length > 1 ? segments.slice(0, -1).join('/') : null
}

function parseSkillMetadata(skillsDir, skillPath, warnings) {
  const dirName = path.basename(path.dirname(skillPath))
  try {
    const content = fs.readFileSync(skillPath, 'utf-8')
    const parsed = matter(content)
    const data = parsed.data || {}

    if (!data.name || !data.description) {
      warnings.push({
        type: 'invalid-frontmatter',
        dirName,
        skillPath
      })
      return null
    }

    if (data.name !== dirName) {
      warnings.push({
        type: 'name-mismatch',
        dirName,
        declaredName: data.name,
        skillPath
      })
    }

    return {
      name: data.name || dirName,
      description: data.description || '',
      path: skillPath,
      skillRoot: path.dirname(skillPath),
      category: deriveSkillCategory(skillsDir, path.dirname(skillPath)),
      platforms: Array.isArray(data.platforms)
        ? data.platforms.filter((platform) => typeof platform === 'string')
        : undefined,
      metadata:
        data.metadata && typeof data.metadata === 'object'
          ? data.metadata
          : undefined,
      allowedTools: Array.isArray(data.allowedTools)
        ? data.allowedTools.filter((toolName) => typeof toolName === 'string')
        : undefined
    }
  } catch (error) {
    warnings.push({
      type: 'parse-failed',
      skillPath,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

function main() {
  const { skillsDir, sidecarDirName, maxDepth } = workerData

  if (!fs.existsSync(skillsDir)) {
    return { skills: [], warnings: [] }
  }

  const warnings = []
  const skillManifestPaths = collectSkillManifestPaths(
    skillsDir,
    maxDepth,
    sidecarDirName,
    0,
    [],
    warnings
  ).sort((left, right) => left.localeCompare(right))

  const discovered = []
  const seenNames = new Set()
  for (const skillPath of skillManifestPaths) {
    const metadata = parseSkillMetadata(skillsDir, skillPath, warnings)
    if (!metadata) {
      continue
    }

    if (seenNames.has(metadata.name)) {
      warnings.push({
        type: 'duplicate-skill-name',
        name: metadata.name,
        path: metadata.path
      })
      continue
    }

    seenNames.add(metadata.name)
    discovered.push(metadata)
  }

  return { skills: discovered, warnings }
}

try {
  parentPort.postMessage({
    ok: true,
    data: main()
  })
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }
  })
}
`

export async function discoverSkillMetadataInWorker(
  input: SkillDiscoveryWorkerInput,
  signal?: AbortSignal
): Promise<SkillDiscoveryWorkerOutput> {
  return await runInlineJsonWorker<SkillDiscoveryWorkerInput, SkillDiscoveryWorkerOutput>({
    name: 'skill-discovery',
    source: DISCOVERY_WORKER_SOURCE,
    input,
    signal
  })
}

export function logSkillDiscoveryWorkerWarnings(warnings: SkillDiscoveryWarning[]): void {
  for (const warning of warnings) {
    switch (warning.type) {
      case 'scan-skip':
        logger.warn('[SkillPresenter] Failed to scan skill directory, skipping subtree', {
          currentDir: warning.currentDir,
          error: new Error(warning.error)
        })
        break
      case 'parse-failed':
        console.error(
          `[SkillPresenter] Failed to parse skill at ${warning.skillPath}:`,
          warning.error
        )
        break
      case 'duplicate-skill-name':
        logger.warn('[SkillPresenter] Duplicate skill name discovered. Keeping the first entry.', {
          name: warning.name,
          path: warning.path
        })
        break
      case 'invalid-frontmatter':
        console.warn(
          `[SkillPresenter] Skill ${warning.dirName} missing required frontmatter fields`
        )
        break
      case 'name-mismatch':
        console.warn(
          `[SkillPresenter] Skill name "${warning.declaredName}" doesn't match directory "${warning.dirName}"`
        )
        break
      default:
        break
    }
  }
}
