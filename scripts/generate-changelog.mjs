import fs from 'fs'
import path from 'path'

const projectRoot = process.cwd()
const sourcePath = path.join(projectRoot, 'CHANGELOG.md')
const outputPath = path.join(projectRoot, 'dist', 'changelog.md')

if (!fs.existsSync(sourcePath)) {
  console.error('CHANGELOG.md not found at project root.')
  process.exit(1)
}

const content = fs.readFileSync(sourcePath, 'utf8').trim()
if (!content) {
  console.error('CHANGELOG.md is empty.')
  process.exit(1)
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${content}\n`, 'utf8')
console.log(`Generated changelog at ${outputPath}`)
