import matter from 'gray-matter'

const options = {
  engines: {
    javascript: () => {
      throw new Error('JavaScript front matter is not supported')
    }
  }
}

export function parseSkillFrontmatter(content: string) {
  return matter(content, options)
}

export function stringifySkillFrontmatter(content: string, data: Record<string, unknown>): string {
  return matter.stringify(content, data, options)
}
