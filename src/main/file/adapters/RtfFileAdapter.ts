import { TextFileAdapter } from './TextFileAdapter'

export class RtfFileAdapter extends TextFileAdapter {
  protected getFileDescription(): string | undefined {
    return 'Rich Text Format File'
  }

  async getContent(): Promise<string | undefined> {
    const content = await super.getContent()
    if (!content) {
      return content
    }

    return stripRtfToText(content)
  }
}

function stripRtfToText(content: string): string {
  return content
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}/g, '')
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\tab/g, '\t')
    .replace(/\\'[0-9a-fA-F]{2}/g, (match) =>
      String.fromCharCode(Number.parseInt(match.slice(2), 16))
    )
    .replace(/\\u(-?\d+)\??/g, (_match, code: string) => {
      const value = Number.parseInt(code, 10)
      return Number.isFinite(value) ? String.fromCharCode(value < 0 ? value + 65536 : value) : ''
    })
    .replace(/[{}]/g, '')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/\\[^a-zA-Z0-9]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
