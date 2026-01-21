import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { globSync } from 'glob'

const ROOT = process.cwd()
const CLASSIFICATION_PATH = path.join(
  ROOT,
  'docs/specs/renderer-store-composables-rules/classification.md'
)

const loadClassification = () => {
  if (!fs.existsSync(CLASSIFICATION_PATH)) {
    throw new Error(`Missing classification file: ${CLASSIFICATION_PATH}`)
  }

  const content = fs.readFileSync(CLASSIFICATION_PATH, 'utf8')
  const lines = content.split('\n')
  const adapterPaths = []
  let inAdapterSection = false

  for (const line of lines) {
    if (line.startsWith('### Adapter Composable')) {
      inAdapterSection = true
      continue
    }
    if (inAdapterSection && line.startsWith('### ')) {
      break
    }
    if (inAdapterSection) {
      const match = line.match(/^- `([^`]+)`/)
      if (match) {
        adapterPaths.push(match[1])
      }
    }
  }

  return new Set(adapterPaths)
}

const stripComments = (source) => {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return withoutBlock.replace(/^\s*\/\/.*$/gm, '')
}

const adapterAllowList = loadClassification()

const files = globSync('src/renderer/src/{composables,stores}/**/*.ts', {
  cwd: ROOT,
  absolute: true,
  ignore: ['**/*.d.ts']
})

const rules = [
  { name: 'usePresenter', regex: /\busePresenter\b/ },
  { name: 'window.electron', regex: /window\.electron/ },
  { name: 'ipcRenderer', regex: /\bipcRenderer\b/ }
]

const violations = []

for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const isAllowed = adapterAllowList.has(rel)
  if (isAllowed) continue

  const source = fs.readFileSync(file, 'utf8')
  const content = stripComments(source)

  const matches = rules.filter((rule) => rule.regex.test(content)).map((rule) => rule.name)
  if (matches.length > 0) {
    violations.push({ file: rel, matches })
  }
}

if (violations.length > 0) {
  console.error('Renderer adapter boundary violations found:')
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.matches.join(', ')}`)
  }
  process.exit(1)
}

console.log('Renderer adapter boundary check passed.')
