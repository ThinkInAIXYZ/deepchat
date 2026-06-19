import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'

const skillPath = resolve(process.cwd(), '.agents/skills/add-provider/SKILL.md')
const readSkill = async () => {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  return fs.readFileSync(skillPath, 'utf8')
}

describe('add-provider skill', () => {
  it('declares valid skill front matter', async () => {
    const content = await readSkill()
    const frontMatter = content.match(/^---\n([\s\S]*?)\n---/)

    expect(frontMatter).not.toBeNull()
    expect(frontMatter?.[1]).toContain('name: add-provider')
    expect(frontMatter?.[1]).toContain('description:')
  })

  it('documents required inputs and current provider files', async () => {
    const content = await readSkill()

    for (const requiredText of [
      'Provider ID in kebab case',
      'API type or known transport family',
      'Default base URL',
      'Auth type',
      'Model metadata source',
      'src/main/presenter/configPresenter/providers.ts',
      'src/main/presenter/llmProviderPresenter/providerRegistry.ts',
      'src/main/presenter/llmProviderPresenter/aiSdk/providerFactory.ts'
    ]) {
      expect(content).toContain(requiredText)
    }
  })

  it('keeps runtime manifest and dynamic SDK guardrails explicit', async () => {
    const content = await readSkill()

    expect(content).toContain('Do not introduce `ProviderRuntimeDefinition`')
    expect(content).toContain('generated runtime manifests')
    expect(content).toContain('runtime package-name')
    expect(content).toContain('Do not install provider SDK packages automatically')
    expect(content).toContain('Do not execute provider logic in the renderer')
  })
})
