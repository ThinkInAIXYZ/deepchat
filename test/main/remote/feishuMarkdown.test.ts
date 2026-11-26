import { describe, expect, it } from 'vitest'
import { optimizeMarkdownForFeishu } from '@/remote/channels/feishu/feishuMarkdown'

describe('optimizeMarkdownForFeishu code blocks', () => {
  const snippets = ['echo $$', "x=$'a'", "perl -pe 's/a/$&$&/'", 'echo $`', 'echo $1 $<n>']

  for (const cardVersion of [1, 2]) {
    it.each(snippets)(`keeps "%s" unchanged in a fenced block (card v${cardVersion})`, (code) => {
      const text = `# Title\n\n\`\`\`bash\n${code}\n\`\`\`\n`
      const result = optimizeMarkdownForFeishu(text, cardVersion)
      expect(result).toContain(`\`\`\`bash\n${code}\n\`\`\``)
    })
  }
})
