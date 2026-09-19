import { fileURLToPath } from 'node:url'
import manifest from '../packages/provider/package.json' with { type: 'json' }
const root = new URL('../packages/provider/', import.meta.url)
export const providerSourceAliases = Object.fromEntries(
  Object.entries(manifest.exports).map(([subpath, target]) => [
    subpath === '.' ? '@deepchat/provider' : `@deepchat/provider/${subpath.slice(2)}`,
    fileURLToPath(new URL(target.import.replace('./dist/', './src/').replace(/\.js$/, '.ts'), root))
  ])
)
