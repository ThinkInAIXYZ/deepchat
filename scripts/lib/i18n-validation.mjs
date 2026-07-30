import fs from 'node:fs'
import path from 'node:path'

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const listLocaleDirectories = (i18nRoot) =>
  fs
    .readdirSync(i18nRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

const listJsonNamespaces = (localeDirectory) =>
  fs
    .readdirSync(localeDirectory)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => path.basename(fileName, '.json'))
    .sort()

const findDefaultImport = (source, namespace) => {
  const escapedNamespace = escapeRegExp(namespace)
  const importPattern = new RegExp(
    `^\\s*import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+['"]\\./${escapedNamespace}\\.json['"]\\s*$`,
    'm'
  )
  return source.match(importPattern)?.[1]
}

const hasShorthandExport = (exportBody, identifier) => {
  const escapedIdentifier = escapeRegExp(identifier)
  return new RegExp(`(?:^|,|\\n)\\s*${escapedIdentifier}\\s*(?=,|\\n|$)`, 'm').test(exportBody)
}

export function validateLocaleNamespaceRegistrations(i18nRoot) {
  const issues = []
  let namespaceRegistrationCount = 0
  const locales = listLocaleDirectories(i18nRoot)

  for (const locale of locales) {
    const localeDirectory = path.join(i18nRoot, locale)
    const namespaces = listJsonNamespaces(localeDirectory)
    namespaceRegistrationCount += namespaces.length
    const indexPath = path.join(localeDirectory, 'index.ts')

    if (!fs.existsSync(indexPath)) {
      issues.push({ kind: 'missing-index', locale })
      continue
    }

    const source = fs.readFileSync(indexPath, 'utf8')
    const exportMatch = source.match(/export\s+default\s*\{([\s\S]*?)\}\s*$/)
    const exportBody = exportMatch?.[1]

    if (exportBody === undefined) {
      issues.push({ kind: 'missing-default-export', locale })
      continue
    }

    for (const namespace of namespaces) {
      const identifier = findDefaultImport(source, namespace)
      if (!identifier) {
        issues.push({ kind: 'missing-import', locale, namespace })
        continue
      }

      if (!hasShorthandExport(exportBody, identifier)) {
        issues.push({ kind: 'missing-export', locale, namespace })
      }
    }
  }

  return {
    issues,
    localeCount: locales.length,
    namespaceRegistrationCount
  }
}

export function formatI18nValidationIssue(issue) {
  switch (issue.kind) {
    case 'missing-index':
      return `${issue.locale}: missing index.ts`
    case 'missing-default-export':
      return `${issue.locale}: index.ts is missing a default object export`
    case 'missing-import':
      return `${issue.locale}: ${issue.namespace}.json is not imported`
    case 'missing-export':
      return `${issue.locale}: ${issue.namespace}.json is imported but not exported`
    default:
      return JSON.stringify(issue)
  }
}
