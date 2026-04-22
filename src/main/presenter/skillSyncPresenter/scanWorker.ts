import type {
  ExternalToolConfig,
  NewDiscovery,
  ScanCache,
  ScanResult
} from '@shared/types/skillSync'
import { runInlineJsonWorker } from '@/lib/runInlineJsonWorker'

type WorkerExternalSkillInfo = {
  name: string
  description?: string
  path: string
  format: string
  lastModified: string
}

type WorkerScanResult = Omit<ScanResult, 'skills'> & {
  skills: WorkerExternalSkillInfo[]
}

type WorkerNewDiscovery = Omit<NewDiscovery, 'newSkills'> & {
  newSkills: WorkerExternalSkillInfo[]
}

type SkillSyncWorkerInput = {
  tools: ExternalToolConfig[]
  projectRoot?: string
  cache?: ScanCache | null
  existingSkillNames?: string[]
}

type SkillSyncWorkerOutput = {
  scanResults: WorkerScanResult[]
  discoveries: WorkerNewDiscovery[]
}

const SCAN_WORKER_SOURCE = String.raw`
const requireFromBundle = globalThis.__inlineWorkerRequire || require
const { parentPort, workerData } = requireFromBundle('node:worker_threads')
const fs = requireFromBundle('fs')
const path = requireFromBundle('path')
const os = requireFromBundle('os')

const MAX_FILE_SIZE = 10 * 1024 * 1024

function expandPath(inputPath) {
  if (typeof inputPath === 'string' && inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2))
  }
  return inputPath
}

function resolveSkillsDir(tool, projectRoot) {
  if (tool.isProjectLevel) {
    if (!projectRoot) {
      throw new Error('Project root required for project-level tool: ' + tool.id)
    }
    return path.resolve(projectRoot, tool.skillsDir)
  }
  return expandPath(tool.skillsDir)
}

function isFilenameSafe(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    !name.includes('/') &&
    !name.includes('\\\\') &&
    name !== '.' &&
    name !== '..'
  )
}

function isPathSafe(targetPath, baseDir) {
  const normalizedTarget = path.normalize(path.resolve(baseDir, targetPath))
  const normalizedBase = path.normalize(path.resolve(baseDir))
  const baseWithSep = normalizedBase.endsWith(path.sep) ? normalizedBase : normalizedBase + path.sep
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(baseWithSep)
}

function validateFileSize(filePath, maxSize) {
  const stats = fs.statSync(filePath)
  if (!stats.isFile()) {
    return { valid: false }
  }
  if (stats.size > maxSize) {
    return { valid: false }
  }
  return { valid: true, stats }
}

function extractNameFromFile(filename, pattern) {
  if (pattern === '*.prompt.md') {
    return filename.replace(/\.prompt\.md$/, '')
  }
  return filename.replace(/\.md$/, '')
}

function extractDescription(content, tool) {
  if (tool.capabilities && tool.capabilities.hasFrontmatter) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (frontmatterMatch) {
      const descriptionMatch = frontmatterMatch[1].match(/description:\s*["']?([^\n"']+)["']?/)
      if (descriptionMatch) {
        return descriptionMatch[1].trim()
      }
    }
  }

  const lines = content.split('\n')
  let foundTitle = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) {
      foundTitle = true
      continue
    }
    if (foundTitle && trimmed && !trimmed.startsWith('---')) {
      return trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed
    }
  }

  return undefined
}

function matchesPattern(filename, pattern) {
  if (pattern === '*.md') {
    return filename.endsWith('.md')
  }
  if (pattern === '*.prompt.md') {
    return filename.endsWith('.prompt.md')
  }
  if (pattern.endsWith('/SKILL.md')) {
    return filename === 'SKILL.md'
  }
  return filename.endsWith('.md')
}

function extractSkillInfo(filePath, folderPath, tool) {
  try {
    const sizeResult = validateFileSize(filePath, MAX_FILE_SIZE)
    if (!sizeResult.valid) {
      return null
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const stats = sizeResult.stats || fs.statSync(filePath)
    const name = tool.filePattern.includes('/')
      ? path.basename(folderPath)
      : extractNameFromFile(path.basename(filePath), tool.filePattern)

    return {
      name,
      description: extractDescription(content, tool),
      path: tool.filePattern.includes('/') ? folderPath : filePath,
      format: tool.format,
      lastModified: stats.mtime.toISOString()
    }
  } catch {
    return null
  }
}

function scanSubdirectories(skillsDir, tool) {
  const skills = []
  const fileName = tool.filePattern.split('/').pop() || 'SKILL.md'
  let entries = []
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  } catch {
    return skills
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || (entry.isSymbolicLink && entry.isSymbolicLink())) {
      continue
    }
    if (!isFilenameSafe(entry.name) || !isPathSafe(entry.name, skillsDir)) {
      continue
    }

    const subDir = path.join(skillsDir, entry.name)
    const skillFile = path.join(subDir, fileName)
    try {
      const stats = fs.statSync(skillFile)
      if (!stats.isFile()) {
        continue
      }
      const info = extractSkillInfo(skillFile, subDir, tool)
      if (info) {
        skills.push(info)
      }
    } catch {
      continue
    }
  }

  return skills
}

function scanFiles(skillsDir, tool) {
  const skills = []
  let entries = []
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  } catch {
    return skills
  }

  for (const entry of entries) {
    if (!entry.isFile() || (entry.isSymbolicLink && entry.isSymbolicLink())) {
      continue
    }
    if (!matchesPattern(entry.name, tool.filePattern)) {
      continue
    }
    if (!isFilenameSafe(entry.name) || !isPathSafe(entry.name, skillsDir)) {
      continue
    }

    const filePath = path.join(skillsDir, entry.name)
    const info = extractSkillInfo(filePath, skillsDir, tool)
    if (info) {
      skills.push(info)
    }
  }

  return skills
}

function scanTool(tool, projectRoot) {
  let skillsDir
  try {
    skillsDir = resolveSkillsDir(tool, projectRoot)
  } catch (error) {
    return {
      toolId: tool.id,
      toolName: tool.name,
      available: false,
      skillsDir: tool.skillsDir,
      skills: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }

  try {
    const stats = fs.statSync(skillsDir)
    if (!stats.isDirectory()) {
      return {
        toolId: tool.id,
        toolName: tool.name,
        available: false,
        skillsDir,
        skills: [],
        error: 'Path is not a directory: ' + skillsDir
      }
    }
  } catch {
    return {
      toolId: tool.id,
      toolName: tool.name,
      available: false,
      skillsDir,
      skills: []
    }
  }

  const skills = tool.filePattern.includes('/')
    ? scanSubdirectories(skillsDir, tool)
    : scanFiles(skillsDir, tool)

  return {
    toolId: tool.id,
    toolName: tool.name,
    available: true,
    skillsDir,
    skills
  }
}

function scanExternalTools(tools, projectRoot) {
  const results = []
  for (const tool of tools) {
    if (tool.isProjectLevel && !projectRoot) {
      continue
    }
    results.push(scanTool(tool, projectRoot))
  }
  return results
}

function compareWithCacheAndSkills(scanResults, cache, existingSkillNames) {
  const discoveries = []
  const existingSet = new Set(existingSkillNames || [])
  const cacheMap = new Map()

  if (cache && Array.isArray(cache.tools)) {
    for (const tool of cache.tools) {
      cacheMap.set(tool.toolId, new Set((tool.skills || []).map((skill) => skill.name)))
    }
  }

  for (const result of scanResults) {
    if (!result.available || result.toolId.includes('project')) {
      continue
    }

    const cachedSkillNames = cacheMap.get(result.toolId) || new Set()
    const newSkills = []

    for (const skill of result.skills) {
      const isInCache = cachedSkillNames.has(skill.name)
      const isAlreadyImported = existingSet.has(skill.name)
      if (!isInCache && !isAlreadyImported) {
        newSkills.push(skill)
      }
    }

    if (newSkills.length > 0) {
      discoveries.push({
        toolId: result.toolId,
        toolName: result.toolName,
        newSkills
      })
    }
  }

  return discoveries
}

function main() {
  const { tools, projectRoot, cache, existingSkillNames } = workerData
  const scanResults = scanExternalTools(tools || [], projectRoot)
  const discoveries = compareWithCacheAndSkills(scanResults, cache, existingSkillNames || [])
  return { scanResults, discoveries }
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

const toScanResults = (results: WorkerScanResult[]): ScanResult[] =>
  results.map((result) => ({
    ...result,
    skills: result.skills.map((skill) => ({
      ...skill,
      lastModified: new Date(skill.lastModified)
    }))
  }))

const toDiscoveries = (discoveries: WorkerNewDiscovery[]): NewDiscovery[] =>
  discoveries.map((discovery) => ({
    ...discovery,
    newSkills: discovery.newSkills.map((skill) => ({
      ...skill,
      lastModified: new Date(skill.lastModified)
    }))
  }))

export async function scanExternalToolsInWorker(
  input: Pick<SkillSyncWorkerInput, 'tools' | 'projectRoot'>,
  signal?: AbortSignal
): Promise<ScanResult[]> {
  const output = await runInlineJsonWorker<SkillSyncWorkerInput, SkillSyncWorkerOutput>({
    name: 'skill-sync-scan',
    source: SCAN_WORKER_SOURCE,
    input: {
      tools: input.tools,
      projectRoot: input.projectRoot
    },
    signal
  })

  return toScanResults(output.scanResults)
}

export async function scanAndDetectDiscoveriesInWorker(
  input: SkillSyncWorkerInput,
  signal?: AbortSignal
): Promise<{ scanResults: ScanResult[]; discoveries: NewDiscovery[] }> {
  const output = await runInlineJsonWorker<SkillSyncWorkerInput, SkillSyncWorkerOutput>({
    name: 'skill-sync-discovery',
    source: SCAN_WORKER_SOURCE,
    input,
    signal
  })

  return {
    scanResults: toScanResults(output.scanResults),
    discoveries: toDiscoveries(output.discoveries)
  }
}
