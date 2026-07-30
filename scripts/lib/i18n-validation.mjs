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

const flattenMessages = (value, prefix, messages) => {
  if (typeof value === 'string') {
    messages.set(prefix, value)
    return
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return
  }

  for (const [key, child] of Object.entries(value)) {
    flattenMessages(child, prefix ? `${prefix}.${key}` : key, messages)
  }
}

const readLocaleMessages = (i18nRoot, locale) => {
  const localeDirectory = path.join(i18nRoot, locale)
  const messages = new Map()

  for (const namespace of listJsonNamespaces(localeDirectory)) {
    const namespacePath = path.join(localeDirectory, `${namespace}.json`)
    const namespaceMessages = JSON.parse(fs.readFileSync(namespacePath, 'utf8'))
    flattenMessages(namespaceMessages, namespace, messages)
  }

  return messages
}

const uniqueSorted = (values) => [...new Set(values)].sort()

const parseMessageContract = (message) => {
  const invalidLiteralQuotes = []
  const literalValues = []
  const messageWithoutLiterals = message.replace(
    /\{(['"])(.*?)\1\}/gs,
    (interpolation, quote, value) => {
      literalValues.push(value)
      if (quote !== "'") {
        invalidLiteralQuotes.push(quote)
      }
      return ' '.repeat(interpolation.length)
    }
  )
  const namedParameters = Array.from(
    messageWithoutLiterals.matchAll(/\{([\p{L}_$][\p{L}\p{N}_$-]*)\}/gu),
    (match) => match[1]
  )
  const listParameters = Array.from(
    messageWithoutLiterals.matchAll(/\{(\d+)\}/g),
    (match) => match[1]
  )

  return {
    namedParameters: uniqueSorted(namedParameters),
    listParameters: uniqueSorted(listParameters),
    literalValues: literalValues.sort(),
    invalidLiteralQuotes
  }
}

const contractsMatch = (expected, actual) =>
  JSON.stringify({
    namedParameters: expected.namedParameters,
    listParameters: expected.listParameters,
    literalValues: expected.literalValues
  }) ===
  JSON.stringify({
    namedParameters: actual.namedParameters,
    listParameters: actual.listParameters,
    literalValues: actual.literalValues
  })

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

export function validateLocaleMessageContracts(i18nRoot, baselineLocale = 'en-US') {
  const issues = []
  const locales = listLocaleDirectories(i18nRoot)

  if (!locales.includes(baselineLocale)) {
    return {
      issues: [{ kind: 'missing-baseline-locale', locale: baselineLocale }],
      baselineLocale,
      messageCount: 0,
      localeCount: locales.length
    }
  }

  const baselineMessages = readLocaleMessages(i18nRoot, baselineLocale)
  const baselineContracts = new Map(
    Array.from(baselineMessages, ([key, message]) => [key, parseMessageContract(message)])
  )

  for (const locale of locales) {
    const messages = readLocaleMessages(i18nRoot, locale)

    for (const [key, message] of messages) {
      const actual = parseMessageContract(message)

      if (actual.invalidLiteralQuotes.length > 0) {
        issues.push({
          kind: 'invalid-literal-interpolation',
          locale,
          key
        })
      }

      if (locale === baselineLocale) {
        continue
      }

      const expected = baselineContracts.get(key)
      if (expected && !contractsMatch(expected, actual)) {
        issues.push({
          kind: 'message-contract-mismatch',
          locale,
          key,
          expected: {
            namedParameters: expected.namedParameters,
            listParameters: expected.listParameters,
            literalValues: expected.literalValues
          },
          actual: {
            namedParameters: actual.namedParameters,
            listParameters: actual.listParameters,
            literalValues: actual.literalValues
          }
        })
      }
    }
  }

  return {
    issues,
    baselineLocale,
    messageCount: baselineMessages.size,
    localeCount: locales.length
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
    case 'missing-baseline-locale':
      return `baseline locale ${issue.locale} does not exist`
    case 'invalid-literal-interpolation':
      return `${issue.locale}: ${issue.key} uses double quotes in a literal interpolation`
    case 'message-contract-mismatch':
      return (
        `${issue.locale}: ${issue.key} has a different message contract ` +
        `(expected ${JSON.stringify(issue.expected)}, got ${JSON.stringify(issue.actual)})`
      )
    default:
      return JSON.stringify(issue)
  }
}
