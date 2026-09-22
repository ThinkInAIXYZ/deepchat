import type { NewDiscovery, ScanCache, ScanResult } from '@shared/types/skillSync'

export function compareWithCacheAndSkills(
  scanResults: ScanResult[],
  cache: ScanCache | null,
  existingSkillNames: Set<string>
): NewDiscovery[] {
  // Persisted cache is not runtime-validated. Ignore malformed entries so a
  // successful scan can replace it instead of failing in both execution paths.
  const cacheMap = new Map<string, Set<string>>()
  if (Array.isArray(cache?.tools)) {
    for (const tool of cache.tools) {
      if (typeof tool?.toolId !== 'string') continue
      const skills = Array.isArray(tool.skills) ? tool.skills : []
      cacheMap.set(
        tool.toolId,
        new Set(skills.flatMap((skill) => (typeof skill?.name === 'string' ? [skill.name] : [])))
      )
    }
  }
  const discoveries: NewDiscovery[] = []

  for (const result of scanResults) {
    if (!result.available || result.toolId.includes('project')) continue

    const cachedNames = cacheMap.get(result.toolId)
    const newSkills = result.skills.filter(
      (skill) => !cachedNames?.has(skill.name) && !existingSkillNames.has(skill.name)
    )
    if (newSkills.length > 0) {
      discoveries.push({ toolId: result.toolId, toolName: result.toolName, newSkills })
    }
  }
  return discoveries
}
