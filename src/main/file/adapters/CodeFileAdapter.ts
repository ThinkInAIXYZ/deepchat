import { BaseFileAdapter } from './BaseFileAdapter'
import fs from 'fs/promises'
import path from 'path'
import { getLanguageFromFilename } from '@shared/utils/codeLanguage'

export class CodeFileAdapter extends BaseFileAdapter {
  private maxFileSize: number
  private fileContent: string | undefined

  constructor(filePath: string, maxFileSize: number) {
    super(filePath)
    this.maxFileSize = maxFileSize
    this.fileContent = undefined
    this.mimeType = 'text/code' //set a default mime type
  }

  protected getFileDescription(): string | undefined {
    const ext = path.extname(this.filePath).toLowerCase()
    switch (ext) {
      case '.js':
        return 'JavaScript Source File'
      case '.ts':
        return 'TypeScript Source File'
      case '.py':
        return 'Python Source File'
      case '.java':
        return 'Java Source File'
      case '.c':
        return 'C Source File'
      case '.cpp':
      case '.cc':
      case '.cxx':
        return 'C++ Source File'
      case '.h':
        return 'C/C++ Header File'
      case '.hpp':
      case '.hxx':
      case '.hh':
        return 'C++ Header File'
      case '.cs':
        return 'C# Source File'
      case '.go':
        return 'Go Source File'
      case '.rb':
        return 'Ruby Source File'
      case '.php':
        return 'PHP Source File'
      case '.rs':
        return 'Rust Source File'
      case '.swift':
        return 'Swift Source File'
      case '.kt':
        return 'Kotlin Source File'
      case '.scala':
        return 'Scala Source File'
      case '.pl':
        return 'Perl Source File'
      case '.lua':
        return 'Lua Source File'
      case '.sh':
        return 'Shell Script'
      case '.html':
      case '.htm':
        return 'HTML File'
      case '.css':
        return 'CSS File'
      case '.dart':
        return 'Dart Source File'
      case '.r':
        return 'R Source File'
      case '.m':
        return 'MATLAB/Objective-C Source File'
      case '.sql':
        return 'SQL Script File'
      case '.json':
        return 'JSON File'
      case '.yaml':
      case '.yml':
        return 'YAML File'
      case '.xml':
        return 'XML File'
      case '.md':
        return 'Markdown File'
      case '.vue':
        return 'Vue.js Component File'
      case '.svelte':
        return 'Svelte Component File'
      case '.sass':
      case '.scss':
        return 'Sass/SCSS File'
      case '.less':
        return 'Less File'
      case '.f90':
      case '.f95':
      case '.f03':
        return 'Fortran Source File'
      case '.jl':
        return 'Julia Source File'
      case '.ex':
      case '.exs':
        return 'Elixir Source File'
      case '.elm':
        return 'Elm Source File'
      case '.clj':
      case '.cljs':
        return 'Clojure Source File'
      case '.fs':
      case '.fsx':
        return 'F# Source File'
      case '.hs':
        return 'Haskell Source File'
      case '.ml':
      case '.mli':
        return 'OCaml Source File'
      case '.nim':
        return 'Nim Source File'
      case '.proto':
        return 'Protocol Buffers File'
      case '.groovy':
        return 'Groovy Source File'
      case '.tf':
      case '.tfvars':
        return 'Terraform Configuration File'
      case '.dockerfile':
        return 'Dockerfile'
      case '.toml':
        return 'TOML File'
      case '.graphql':
      case '.gql':
        return 'GraphQL File'
      case '.tsx':
      case '.jsx':
        return 'React Component File'
      case '.astro':
        return 'Astro Component File'
      case '.zig':
        return 'Zig Source File'
      case '.v':
        return 'V Source File'
      case '.ini':
        return 'INI Configuration File'
      case '.env':
        return 'Environment Configuration File'
      case '.conf':
      case '.config':
        return 'Configuration File'
      case '.properties':
        return 'Properties Configuration File'
      case '.lock':
        return 'Lock File'
      case '.npmrc':
        return 'NPM Configuration File'
      case '.babelrc':
      case '.babel.config.js':
        return 'Babel Configuration File'
      case '.eslintrc':
      case '.eslintignore':
        return 'ESLint Configuration File'
      case '.prettierrc':
        return 'Prettier Configuration File'
      case '.gitignore':
        return 'Git Ignore File'
      case '.dockerignore':
        return 'Docker Ignore File'
      case '.editorconfig':
        return 'Editor Configuration File'
      case '.htaccess':
        return 'Apache Configuration File'
      case '.nginx':
        return 'Nginx Configuration File'
      default:
        return 'Source Code File'
    }
  }

  async getContent(): Promise<string | undefined> {
    if (this.fileContent === undefined) {
      const fullPath = path.join(this.filePath)
      const stats = await fs.stat(fullPath)
      if (stats.size <= this.maxFileSize) {
        this.fileContent = await fs.readFile(fullPath, 'utf-8')
      }
    }
    return this.fileContent
  }

  public async getLLMContent(): Promise<string | undefined> {
    const content = await this.getContent()
    const language = getLanguageFromFilename(this.filePath)
    return `
  \`\`\`${language}
  ${content}
  \`\`\``
  }

  async getThumbnail(): Promise<string | undefined> {
    return ''
  }
}
