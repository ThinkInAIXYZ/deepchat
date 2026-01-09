const DEFAULT_CODE_LANGUAGE = 'plaintext'

const BASENAME_LANGUAGE_MAP: Record<string, string> = {
  dockerfile: 'dockerfile',
  '.dockerfile': 'dockerfile',
  '.npmrc': 'ini',
  '.babelrc': 'json',
  '.eslintrc': 'json',
  '.eslintignore': 'gitignore',
  '.prettierrc': 'json',
  '.gitignore': 'gitignore',
  '.dockerignore': 'gitignore',
  '.editorconfig': 'ini',
  '.htaccess': 'apacheconf',
  '.nginx': 'nginx'
}

const SUFFIX_LANGUAGE_MAP: Record<string, string> = {
  '.babel.config.js': 'json'
}

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.hh': 'cpp',
  '.cs': 'csharp',
  '.go': 'go',
  '.rb': 'ruby',
  '.php': 'php',
  '.rs': 'rust',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.pl': 'perl',
  '.lua': 'lua',
  '.sh': 'shell',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.dart': 'dart',
  '.r': 'r',
  '.m': 'matlab',
  '.sql': 'sql',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.md': 'markdown',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.sass': 'scss',
  '.scss': 'scss',
  '.less': 'less',
  '.f90': 'fortran',
  '.f95': 'fortran',
  '.f03': 'fortran',
  '.jl': 'julia',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.elm': 'elm',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',
  '.hs': 'haskell',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  '.nim': 'nim',
  '.proto': 'protobuf',
  '.groovy': 'groovy',
  '.tf': 'terraform',
  '.tfvars': 'terraform',
  '.dockerfile': 'dockerfile',
  '.toml': 'toml',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.astro': 'astro',
  '.zig': 'zig',
  '.v': 'v',
  '.ini': 'ini',
  '.env': 'dotenv',
  '.conf': 'configuration',
  '.config': 'configuration',
  '.properties': 'properties',
  '.lock': 'yaml'
}

const normalizeFilename = (filename: string): string => filename.replace(/\\/g, '/').toLowerCase()

const getBasename = (filename: string): string => {
  const normalized = normalizeFilename(filename)
  const parts = normalized.split('/')
  return parts[parts.length - 1] || normalized
}

const getExtension = (basename: string): string => {
  const dotIndex = basename.lastIndexOf('.')
  if (dotIndex === 0 && basename.indexOf('.', 1) === -1) {
    return basename
  }
  if (dotIndex > 0) {
    return basename.slice(dotIndex)
  }
  return ''
}

export const getLanguageFromFilename = (filename?: string): string => {
  if (!filename) return DEFAULT_CODE_LANGUAGE
  const basename = getBasename(filename)

  for (const [suffix, language] of Object.entries(SUFFIX_LANGUAGE_MAP)) {
    if (basename.endsWith(suffix)) {
      return language
    }
  }

  if (basename in BASENAME_LANGUAGE_MAP) {
    return BASENAME_LANGUAGE_MAP[basename]
  }

  const extension = getExtension(basename)
  return EXTENSION_LANGUAGE_MAP[extension] ?? DEFAULT_CODE_LANGUAGE
}

export { DEFAULT_CODE_LANGUAGE }
