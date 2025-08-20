import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const i18nDir = path.resolve(__dirname, '../src/renderer/src/i18n/zh-CN')
const outputFile = path.resolve(__dirname, '../src/types/i18n.d.ts')

function safeKey(key) {
  return /^[a-zA-Z$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key}'`
}

function mergeKeys(target, source) {
  for (const key in source) {
    if (
      typeof source[key] === 'object' &&
      source[key] !== null &&
      !Array.isArray(source[key])
    ) {
      if (!target[key]) target[key] = {}
      mergeKeys(target[key], source[key])
    } else {
      target[key] = ''
    }
  }
}

function genType(obj, indent = 4) {
  const space = ' '.repeat(indent)
  let result = '{\n'
  for (const key in obj) {
    const k = safeKey(key)
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      result += `${space}${k}: ${genType(obj[key], indent + 2)}\n`
    } else {
      result += `${space}${k}: string\n`
    }
  }
  result += ' '.repeat(indent - 2) + '}'
  return result
}

async function main() {
  const files = fs.readdirSync(i18nDir).filter((f) => f.endsWith('.json'))
  const allKeys = {}
  for (const file of files) {
    const json = JSON.parse(fs.readFileSync(path.join(i18nDir, file), 'utf-8'))
    mergeKeys(allKeys, json)
  }

  const typeDef = `declare module 'vue-i18n' {\n  interface DefineLocaleMessage ${genType(allKeys, 4)}\n}\n`

  fs.writeFileSync(outputFile, typeDef, 'utf-8')
  console.log('i18n types file generated:', outputFile)
}

// 仅需要在本地开发时执行
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
