const CANONICAL_TOOL_NAMES = new Set([
  'read',
  'write',
  'edit',
  'find',
  'grep',
  'ls',
  'exec',
  'process'
])

const TOOL_NAME_MAPPING: Record<string, string> = {
  // Canonical names
  read: 'read',
  write: 'write',
  edit: 'edit',
  find: 'find',
  grep: 'grep',
  ls: 'ls',
  exec: 'exec',
  process: 'process',

  // Claude Code common names
  multiedit: 'edit',
  glob: 'find',
  bash: 'exec',

  // Legacy DeepChat names
  read_file: 'read',
  write_file: 'write',
  list_directory: 'ls',
  glob_search: 'find',
  grep_search: 'grep',
  edit_file: 'edit',
  execute_command: 'exec'
}

export interface NormalizeSkillToolNameResult {
  canonical: string
  mapped: boolean
}

export function normalizeSkillToolName(toolName: string): NormalizeSkillToolNameResult {
  const normalizedInput = toolName.trim()
  if (!normalizedInput) {
    return { canonical: normalizedInput, mapped: false }
  }

  const mapped = TOOL_NAME_MAPPING[normalizedInput.toLowerCase()]
  if (!mapped) {
    return { canonical: normalizedInput, mapped: false }
  }

  return {
    canonical: mapped,
    mapped: mapped !== normalizedInput
  }
}

export interface NormalizeSkillAllowedToolsResult {
  tools: string[]
  warnings: string[]
}

export function normalizeSkillAllowedTools(tools: string[]): NormalizeSkillAllowedToolsResult {
  const normalized: string[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  for (const originalToolName of tools) {
    if (typeof originalToolName !== 'string') {
      continue
    }

    const { canonical, mapped } = normalizeSkillToolName(originalToolName)
    if (!canonical) {
      continue
    }

    const isCanonical = CANONICAL_TOOL_NAMES.has(canonical)
    if (!isCanonical && !mapped) {
      warnings.push(`[SkillTools] Unknown allowedTools entry kept as-is: ${originalToolName}`)
    }
    if (mapped && canonical !== originalToolName) {
      warnings.push(`[SkillTools] Mapped allowedTools entry: ${originalToolName} -> ${canonical}`)
    }

    if (seen.has(canonical)) {
      continue
    }
    seen.add(canonical)
    normalized.push(canonical)
  }

  return { tools: normalized, warnings }
}
