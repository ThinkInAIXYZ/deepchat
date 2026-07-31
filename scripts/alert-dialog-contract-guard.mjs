import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const REPOSITORY_ROOT = process.cwd()
const RENDERER_ROOT = path.join(REPOSITORY_ROOT, 'src/renderer')
const FORBIDDEN_MODIFIERS = new Set(['prevent', 'stop'])
const ALERT_DIALOG_CLOSE_TAG =
  /<AlertDialog(?:Action|Cancel)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g
const CLICK_DIRECTIVE =
  /(?:^|\s)(?:@click|v-on:click)((?:\.[A-Za-z0-9_-]+)+)(?=\s|=|\/?>)/g

function lineNumberAt(source, offset) {
  let line = 1
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1
  }
  return line
}

export function findForbiddenAlertDialogClickModifiers(source) {
  const violations = []

  for (const tagMatch of source.matchAll(ALERT_DIALOG_CLOSE_TAG)) {
    const tag = tagMatch[0]
    const component = tag.startsWith('<AlertDialogCancel')
      ? 'AlertDialogCancel'
      : 'AlertDialogAction'

    for (const directiveMatch of tag.matchAll(CLICK_DIRECTIVE)) {
      const modifiers = directiveMatch[1]
        .split('.')
        .filter((modifier) => FORBIDDEN_MODIFIERS.has(modifier))
      for (const modifier of modifiers) {
        violations.push({
          component,
          modifier,
          line: lineNumberAt(source, (tagMatch.index ?? 0) + (directiveMatch.index ?? 0))
        })
      }
    }
  }

  return violations
}

async function listVueFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listVueFiles(filePath)))
    } else if (entry.isFile() && entry.name.endsWith('.vue')) {
      files.push(filePath)
    }
  }

  return files
}

export async function findAlertDialogContractViolations(root = RENDERER_ROOT) {
  const violations = []
  const files = await listVueFiles(root)

  for (const filePath of files) {
    const source = await fs.readFile(filePath, 'utf8')
    for (const violation of findForbiddenAlertDialogClickModifiers(source)) {
      violations.push({
        ...violation,
        file: path.relative(REPOSITORY_ROOT, filePath).split(path.sep).join('/')
      })
    }
  }

  return violations
}

async function main() {
  const violations = await findAlertDialogContractViolations()
  if (violations.length > 0) {
    console.error('Alert dialog contract guard failed.')
    for (const violation of violations) {
      console.error(
        `- ${violation.file}:${violation.line} ${violation.component} may not use .${violation.modifier}`
      )
    }
    console.error('Use AlertDialogAsyncAction when confirmation must remain open.')
    process.exit(1)
  }

  console.log('Alert dialog contract guard passed.')
}

const isMainModule =
  process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMainModule) {
  main().catch((error) => {
    console.error('Alert dialog contract guard failed to run:', error)
    process.exit(1)
  })
}
