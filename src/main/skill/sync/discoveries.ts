import type { NewDiscovery, ScanCache, ScanResult } from '@shared/types/skillSync'

export function compareWithCacheAndSkills(
  scanResults: ScanResult[],
  cache: ScanCache | null,
  existingSkillNames: Set<string>
): NewDiscovery[] {
  const cacheMap = new Map(
    cache?.tools.map((tool) => [tool.toolId, new Set(tool.skills.map((skill) => skill.name))])
  )
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
