import { fileURLToPath } from 'node:url'
import manifest from '../packages/shared/package.json' with { type: 'json' }

const packageRoot = new URL('../packages/shared/', import.meta.url)

// Only declared public subpaths may resolve to source during development.
/** @type {Record<string, string>} */
export const sharedSourceAliases = Object.fromEntries(
  Object.entries(manifest.exports).map(([subpath, target]) => [
    `@deepchat/shared/${subpath.slice(2)}`,
    fileURLToPath(new URL(target.import.replace('./dist/', './src/').replace(/\.js$/, '.ts'), packageRoot))
  ])
)
