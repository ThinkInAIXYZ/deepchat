export type ExportTemplates = {
  html: {
    documentStart: string[]
    documentEnd: string[]
  }
  styles: string[]
  templates: Record<string, string | string[]>
}

export const conversationExportTemplates: ExportTemplates = {
  html: {
    documentStart: [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '  <meta charset="UTF-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '  <title>{{title}}</title>',
      '  <style>',
      '{{styleLines}}',
      '  </style>',
      '</head>',
      '<body>',
      '  <div class="page">'
    ],
    documentEnd: ['  </div>', '</body>', '</html>']
  },
  styles: [
    ':root { color-scheme: only light; }',
    '* { box-sizing: border-box; }',
    'body { margin: 0; padding: 40px 16px 48px; background: #f1f4f9; color: #1f2933; font-family: "Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.7; }',
    '.page { max-width: 840px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }',
    '.header { background: #ffffff; border-radius: 18px; padding: 28px 32px; border: 1px solid rgba(148, 163, 184, 0.24); box-shadow: 0 14px 35px rgba(15, 23, 42, 0.05); }',
    '.header h1 { margin: 0 0 16px; font-size: 2.1rem; font-weight: 700; color: #0f172a; }',
    '.meta { display: grid; gap: 6px; font-size: 0.92rem; color: #475569; }',
    '.meta-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }',
    '.meta-label { font-weight: 600; color: #1e293b; }',
    '.message { background: #ffffff; border-radius: 16px; padding: 24px 28px; border: 1px solid rgba(203, 213, 225, 0.6); box-shadow: 0 6px 20px rgba(15, 23, 42, 0.04); }',
    '.message.user-message { border-left: 4px solid #2563eb; }',
    '.message.assistant-message { border-left: 4px solid #0ea5e9; }',
    '.message-header { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; }',
    '.message-avatar { font-size: 1.4rem; line-height: 1; }',
    '.message-identity { font-weight: 600; font-size: 1.02rem; color: #0f172a; }',
    '.message-meta { font-size: 0.85rem; color: #64748b; }',
    '.message-content { font-size: 1rem; color: #1f2937; word-break: break-word; }',
    '.section { margin-top: 18px; }',
    '.section-title { font-weight: 600; font-size: 0.95rem; color: #0f172a; display: flex; gap: 6px; align-items: center; }',
    '.section-label { font-size: 0.75rem; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }',
    '.section-caption { font-size: 0.85rem; color: #475569; margin-bottom: 4px; }',
    '.attachments, .search-block, .tool-call, .error-block, .reasoning-block { border-radius: 12px; padding: 18px 20px; border: 1px solid rgba(203, 213, 225, 0.7); background: #f8fafc; }',
    '.attachments { background: #fef3c7; border-color: #fcd34d; }',
    '.attachments ul { margin: 8px 0 0; padding-left: 20px; }',
    '.attachments li { margin: 4px 0; }',
    '.tool-call { background: #ecfdf3; border-color: #c4f0d6; }',
    '.reasoning-block { background: #e0e7ff; border-color: #c7d2fe; color: #1e293b; }',
    '.error-block { background: #fee2e2; border-color: #fecaca; color: #b91c1c; }',
    '.search-block { background: #eff6ff; border-color: #bfdbfe; color: #1e3a8a; }',
    'pre.code { background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 16px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 0.88rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; margin: 10px 0 0; }',
    'a { color: #1d4ed8; text-decoration: none; font-weight: 500; }',
    'a:hover { text-decoration: underline; }',
    '.divider { height: 1px; background: linear-gradient(90deg, rgba(148, 163, 184, 0.4), rgba(148, 163, 184, 0)); margin: 12px auto 32px; max-width: 820px; }'
  ],
  templates: {
    header: [
      '    <div class="header">',
      '      <h1>{{title}}</h1>',
      '      <div class="meta">',
      '{{metaRows}}',
      '      </div>',
      '    </div>'
    ],
    metaRow:
      '        <div class="meta-row"><span class="meta-label">{{label}}</span><span>{{value}}</span></div>',
    userMessage: [
      '    <article class="message user-message">',
      '      <header class="message-header">',
      '        <div class="message-avatar">👤</div>',
      '        <div>',
      '          <div class="message-identity">用户</div>',
      '          <div class="message-meta">{{timestamp}}</div>',
      '        </div>',
      '      </header>',
      '      <div class="message-content">{{content}}</div>',
      '{{attachmentsSection}}',
      '{{linksSection}}',
      '    </article>'
    ],
    assistantMessage: [
      '    <article class="message assistant-message">',
      '      <header class="message-header">',
      '        <div class="message-avatar">🤖</div>',
      '        <div>',
      '          <div class="message-identity">助手</div>',
      '          <div class="message-meta">{{timestamp}}</div>',
      '        </div>',
      '      </header>',
      '{{assistantBlocks}}',
      '    </article>'
    ],
    attachmentsSection: [
      '      <div class="section attachments">',
      '        <div class="section-title">📎 附件</div>',
      '        <ul>',
      '{{items}}',
      '        </ul>',
      '      </div>'
    ],
    attachmentItem: '          <li><strong>{{name}}</strong> <span>({{mime}})</span></li>',
    linksSection: [
      '      <div class="section attachments">',
      '        <div class="section-title">🔗 链接</div>',
      '        <ul>',
      '{{items}}',
      '        </ul>',
      '      </div>'
    ],
    linkItem:
      '          <li><a href="{{href}}" target="_blank" rel="noopener noreferrer">{{label}}</a></li>',
    assistantContent: ['      <div class="message-content">{{content}}</div>'],
    assistantReasoning: [
      '      <div class="section reasoning-block">',
      '        <div class="section-title">🤔 思考过程</div>',
      '        <pre class="code">{{content}}</pre>',
      '      </div>'
    ],
    assistantArtifact: [
      '      <div class="section reasoning-block">',
      '        <div class="section-title">💭 创作思考</div>',
      '        <pre class="code">{{content}}</pre>',
      '      </div>'
    ],
    assistantToolCall: [
      '      <div class="section tool-call">',
      '        <div class="section-title">🔧 工具调用</div>',
      '{{name}}',
      '{{params}}',
      '{{response}}',
      '      </div>'
    ],
    assistantToolName: '        <div class="section-caption">{{value}}</div>',
    assistantToolParams: [
      '        <div class="section-label">参数</div>',
      '        <pre class="code">{{value}}</pre>'
    ],
    assistantToolResponse: [
      '        <div class="section-label">响应</div>',
      '        <pre class="code">{{value}}</pre>'
    ],
    assistantSearch: [
      '      <div class="section search-block">',
      '        <div class="section-title">🔍 网络搜索</div>',
      '{{caption}}',
      '      </div>'
    ],
    assistantSearchCaption: '        <div class="section-caption">找到 {{total}} 个搜索结果</div>',
    assistantImage: [
      '      <div class="section">',
      '        <div class="section-title">🖼️ 图片</div>',
      '        <div class="message-content">*[图片内容]*</div>',
      '      </div>'
    ],
    assistantError: [
      '      <div class="section error-block">',
      '        ❌ {{content}}',
      '      </div>'
    ],
    divider: '    <div class="divider"></div>'
  }
}
