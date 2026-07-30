import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  formatI18nValidationIssue,
  validateLocaleNamespaceRegistrations
} from './lib/i18n-validation.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
const i18nRoot = path.join(repositoryRoot, 'src/renderer/src/i18n')
const result = validateLocaleNamespaceRegistrations(i18nRoot)

if (result.issues.length > 0) {
  console.error('i18n validation failed:')
  for (const issue of result.issues) {
    console.error(`- ${formatI18nValidationIssue(issue)}`)
  }
  process.exitCode = 1
} else {
  console.log(
    `i18n validation passed: ${result.localeCount} locales, ` +
      `${result.namespaceRegistrationCount} namespace registrations`
  )
}
