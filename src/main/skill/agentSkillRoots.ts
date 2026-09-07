import fs from 'fs'
import path from 'node:path'

export const BUILTIN_SKILL_AGENT_ID = 'deepchat'
export const AGENT_SKILL_SCOPES_DIR = '.agent-scopes'

const SAFE_AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function assertSafeSkillAgentId(agentId: string): string {
  const normalized = agentId.trim()
  if (
    !normalized ||
    !SAFE_AGENT_ID_PATTERN.test(normalized) ||
    normalized.includes('..') ||
    normalized.includes('/') ||
    normalized.includes('\\')
  ) {
    throw new Error(`Invalid Skill Agent id: ${agentId}`)
  }
  return normalized
}

export function resolveAgentSkillsRoot(skillsRoot: string, agentId: string): string {
  const normalizedAgentId = assertSafeSkillAgentId(agentId)
  const resolvedSkillsRoot = path.resolve(skillsRoot)
  if (normalizedAgentId === BUILTIN_SKILL_AGENT_ID) {
    return resolvedSkillsRoot
  }

  const resolvedAgentRoot = path.resolve(
    resolvedSkillsRoot,
    AGENT_SKILL_SCOPES_DIR,
    normalizedAgentId
  )
  const relative = path.relative(resolvedSkillsRoot, resolvedAgentRoot)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Skill Agent root escapes configured Skills directory: ${agentId}`)
  }
  assertPhysicalAgentRootConfinement(resolvedSkillsRoot, resolvedAgentRoot, normalizedAgentId)
  return resolvedAgentRoot
}

function assertPhysicalAgentRootConfinement(
  resolvedSkillsRoot: string,
  resolvedAgentRoot: string,
  agentId: string
): void {
  if (!fs.existsSync(resolvedSkillsRoot)) return

  const canonicalSkillsRoot = fs.realpathSync(resolvedSkillsRoot)
  const scopesRoot = path.join(resolvedSkillsRoot, AGENT_SKILL_SCOPES_DIR)
  for (const candidate of [scopesRoot, resolvedAgentRoot]) {
    if (!fs.existsSync(candidate)) break

    const stats = fs.lstatSync(candidate)
    if (stats.isSymbolicLink()) {
      throw new Error(`Skill Agent root contains a symbolic link: ${agentId}`)
    }
    if (!stats.isDirectory()) {
      throw new Error(`Skill Agent root is not a directory: ${agentId}`)
    }

    const canonicalCandidate = fs.realpathSync(candidate)
    const physicalRelative = path.relative(canonicalSkillsRoot, canonicalCandidate)
    if (
      !physicalRelative ||
      physicalRelative.startsWith('..') ||
      path.isAbsolute(physicalRelative)
    ) {
      throw new Error(`Skill Agent root escapes configured Skills directory: ${agentId}`)
    }
  }
}

export function resolveScopedAgentIdFromPath(skillsRoot: string, filePath: string): string | null {
  const relative = path.relative(path.resolve(skillsRoot), path.resolve(filePath))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }

  const segments = relative.split(path.sep).filter(Boolean)
  if (segments[0] !== AGENT_SKILL_SCOPES_DIR || !segments[1]) {
    return null
  }

  try {
    return assertSafeSkillAgentId(segments[1])
  } catch {
    return null
  }
}
