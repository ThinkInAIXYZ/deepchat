import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  formatI18nValidationIssue,
  validateLocaleMessageContracts,
  validateLocaleNamespaceRegistrations
} from './lib/i18n-validation.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
const i18nRoot = path.join(repositoryRoot, 'src/renderer/src/i18n')
const namespaceResult = validateLocaleNamespaceRegistrations(i18nRoot)
const messageResult = validateLocaleMessageContracts(i18nRoot)
const issues = [...namespaceResult.issues, ...messageResult.issues]

if (issues.length > 0) {
  console.error('i18n validation failed:')
  for (const issue of issues) {
    console.error(`- ${formatI18nValidationIssue(issue)}`)
  }
  process.exitCode = 1
} else {
  console.log(
    `i18n validation passed: ${namespaceResult.localeCount} locales, ` +
      `${namespaceResult.namespaceRegistrationCount} namespace registrations, ` +
      `${messageResult.messageCount} source message contracts`
  )
}
