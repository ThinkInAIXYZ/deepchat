import { describe, expect, it } from 'vitest'
import { parseSkillFrontmatter, stringifySkillFrontmatter } from '@/skill/frontmatter'

describe('Skill front matter', () => {
  it.each(['js', 'JS', 'javascript', 'JavaScript'])('never executes the %s engine', (engine) => {
    const probe = `deepchatFrontmatter${engine}`
    const input = `---${engine}\n(globalThis.${probe} = true, {name: 'unsafe'})\n---\nBody`
    expect(() => parseSkillFrontmatter(input)).toThrow('JavaScript front matter')
    expect(() => stringifySkillFrontmatter(input, { name: 'safe' })).toThrow(
      'JavaScript front matter'
    )
    expect(Reflect.get(globalThis, probe)).toBeUndefined()
  })

  it('keeps declarative YAML and JSON metadata round-trippable', () => {
    for (const input of [
      '---\nname: example\ndescription: Example\n---\nBody',
      '---json\n{"name":"example","description":"Example"}\n---\nBody'
    ]) {
      const parsed = parseSkillFrontmatter(input)
      expect(parsed.data).toEqual({ name: 'example', description: 'Example' })
      expect(
        parseSkillFrontmatter(stringifySkillFrontmatter(parsed.content, parsed.data)).data
      ).toEqual(parsed.data)
    }
  })
})
