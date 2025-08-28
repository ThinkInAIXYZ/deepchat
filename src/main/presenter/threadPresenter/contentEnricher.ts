import axios from 'axios'
import * as cheerio from 'cheerio'
import { SearchResult } from '../../../shared/presenter'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { proxyConfig } from '@/presenter/proxyConfig'
import { presenter } from '@/presenter'
// 统一的搜索结果类型

/**
 * 内容丰富工具类，用于处理URL内容提取和丰富
 */
export class ContentEnricher {
  /**
   * 从文本中提取并丰富URL内容
   * @param text 包含URL的文本
   * @returns 丰富后的URL结果数组
   */
  static async extractAndEnrichUrls(text: string): Promise<SearchResult[]> {
    // 用正则表达式匹配http和https链接
    const urlRegex = /(https?:\/\/[^\s]+)/g
    const matches = text.match(urlRegex)

    if (!matches || matches.length === 0) {
      return []
    }

    const results: SearchResult[] = []

    for (const url of matches) {
      const result = await this.enrichUrl(url, results.length + 1)
      results.push(result as SearchResult)
    }

    return results
  }

  /**
   * 丰富单个URL的内容
   * @param url 需要丰富的URL
   * @param rank 结果排名（可选）
   * @returns 丰富后的SearchResult对象
   */
  static async enrichUrl(url: string, rank: number = 1): Promise<SearchResult> {
    const timeout = 5000 // 5秒超时

    try {
      const proxyUrl = proxyConfig.getProxyUrl()
      // 使用axios获取页面内容
      const response = await axios.get(url, {
        timeout,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        httpAgent: proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined
      })

      const $ = cheerio.load(response.data)
      // 移除不需要的元素
      $('script, style, nav, header, footer, iframe, .ad, #ad, .advertisement').remove()

      // 获取页面标题
      const title = $('title').text().trim() || url

      // 尝试获取主要内容
      const mainContent = this.extractMainContent($)
      // 获取图标
      const icon = this.extractFavicon($, url)

      // 获取页面描述
      const description =
        $('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content') ||
        ''

      return {
        title,
        url,
        content: mainContent,
        icon,
        description,
        rank
      }
    } catch (error: Error | unknown) {
      console.error(`提取URL内容失败 ${url}:`, error instanceof Error ? error.message : '')
      // 如果获取失败，只添加URL信息
      return {
        title: url,
        url,
        rank,
        description: '',
        icon: ''
      }
    }
  }

  /**
   * 批量丰富搜索结果内容
   * @param results 搜索结果数组
   * @param limit 处理结果的数量限制（可选）
   * @returns 丰富后的搜索结果数组
   */
  static async enrichResults(results: SearchResult[], limit?: number): Promise<SearchResult[]> {
    const enrichedResults: SearchResult[] = []
    const resultsToProcess = limit ? results.slice(0, limit) : results

    for (const result of resultsToProcess) {
      try {
        const enrichedResult = await this.enrichUrl(result.url, result.rank)
        // 合并原始结果和丰富的结果
        enrichedResults.push({
          ...result,
          content: enrichedResult.content || result.description || '',
          icon: result.icon || enrichedResult.icon || ''
        })
      } catch (error) {
        console.error(`Error enriching content for ${result.url}:`, error)
        // 获取失败保留原始结果
        enrichedResults.push(result)
      }
    }

    return enrichedResults
  }

  /**
   * 从HTML中提取主要内容
   * @param $ cheerio加载的HTML
   * @returns 提取的内容文本
   */
  private static extractMainContent($: cheerio.CheerioAPI): string {
    // 尝试获取主要内容
    let mainContent = ''
    const possibleSelectors = [
      'article',
      'main',
      '.content',
      '#content',
      '.post-content',
      '.article-content',
      '.entry-content',
      '[role="main"]',
      '.container'
    ]

    for (const selector of possibleSelectors) {
      const element = $(selector)
      if (element.length > 0) {
        mainContent = element.text()
        break
      }
    }
    mainContent = mainContent
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .trim()

    // 如果没有找到主要内容，使用body
    if (!mainContent) {
      mainContent = $('body').text()
    }
    // 清理文本内容
    mainContent = mainContent
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // 获取配置的长度限制，如果获取失败则使用默认值3000
    let lengthLimit = 3000
    try {
      const configValue = presenter.configPresenter.getSetting<number>('webContentLengthLimit')
      if (configValue && typeof configValue === 'number') {
        if (configValue === 0) {
          // 0 表示不限制长度
          return mainContent
        } else if (configValue > 0 && configValue <= 50000) {
          lengthLimit = configValue
        }
      }
    } catch {
      // 忽略错误，使用默认值
    }

    // 如果内容长度小于或等于限制，直接返回全部内容
    if (mainContent.length <= lengthLimit) {
      return mainContent
    }

    // 否则截断到指定长度
    return mainContent.slice(0, lengthLimit)
  }

  /**
   * 从HTML中提取网站图标
   * @param $ cheerio加载的HTML
   * @param url 页面URL
   * @returns 图标URL
   */
  private static extractFavicon($: cheerio.CheerioAPI, url: string): string {
    // 尝试获取网站图标
    let icon = $('link[rel="icon"]').attr('href') || $('link[rel="shortcut icon"]').attr('href')

    // 如果找到了相对路径的图标，转换为绝对路径
    if (icon && !icon.startsWith('http')) {
      const urlObj = new URL(url)
      icon = icon.startsWith('/')
        ? `${urlObj.protocol}//${urlObj.host}${icon}`
        : `${urlObj.protocol}//${urlObj.host}/${icon}`
    }

    // 如果没有找到图标，使用默认的favicon.ico
    if (!icon) {
      const urlObj = new URL(url)
      icon = `${urlObj.protocol}//${urlObj.host}/favicon.ico`
    }

    return icon
  }

  /**
   * 根据提取的URL内容丰富用户消息
   * @param userText 原始用户消息
   * @param urlResults 提取的URL内容结果
   * @returns 丰富后的用户消息
   */
  static enrichUserMessageWithUrlContent(userText: string, urlResults: SearchResult[]): string {
    if (urlResults.length === 0) {
      return userText
    }

    let enrichedContent = `---
  如下url-content的标签中包含了用户上述提到的一些链接的具体信息:
  <url-content>
  \n
  `
    for (let i = 0; i < urlResults.length; i++) {
      const result = urlResults[i]
      if (result.content) {
        enrichedContent += `<url-content-item><url>${result.url}</url>\n<content>${result.content}</content>\n</url-content-item>`
      }
    }
    enrichedContent += `</url-content>`

    return enrichedContent
  }

  /**
   * 将HTML转换为简洁的Markdown格式
   * 保留链接和结构化数据，减少数据量
   * @param html HTML内容
   * @param baseUrl 基础URL，用于解析相对路径
   * @returns 转换后的Markdown内容
   */
  static convertHtmlToMarkdown(html: string, baseUrl: string): string {
    const $ = cheerio.load(html)

    // 移除不需要的元素
    $('script, style, nav, header, footer, iframe, .ad, #ad, .advertisement').remove()

    let markdown = ''

    // 提取页面中可能的搜索结果链接和文本
    const searchResults: { title: string; url: string; text: string }[] = []

    // 1. 查找明显的搜索结果项
    $('a').each((_, element) => {
      const $el = $(element)
      const href = $el.attr('href') || ''
      const text = $el.text().trim()

      // 跳过空链接和明显的导航链接
      if (!href || href === '#' || text.length < 3 || href.includes('javascript:')) {
        return
      }

      // 转换为绝对URL
      let url = href
      try {
        url = href.startsWith('http') ? href : new URL(href, baseUrl).toString()
      } catch (error) {
        // 如果URL构建失败，使用原始href
        console.error('构建URL失败:', error)
      }

      // 获取周围的文本作为描述
      const parent = $el.parent()
      let description = ''

      // 尝试在父元素或祖先元素中寻找描述性文本
      if (parent && parent.children().length > 1) {
        // 克隆父元素并移除所有链接，只保留文本内容
        const parentClone = parent.clone()
        parentClone.find('a').remove()
        description = parentClone.text().trim()
      }

      if (!description) {
        // 尝试查找相邻的段落元素
        const nextParagraph = $el.next('p, div, span')
        if (nextParagraph.length) {
          description = nextParagraph.text().trim()
        }
      }

      // 清理描述文本
      description = description.replace(/\s+/g, ' ').trim().substring(0, 200) // 限制描述长度

      searchResults.push({
        title: text,
        url,
        text: description
      })
    })

    // 2. 将提取的搜索结果转换为Markdown格式
    searchResults.forEach((result, index) => {
      markdown += `## 结果 ${index + 1}\n`
      markdown += `### [${result.title}](${result.url})\n`
      markdown += `- URL: ${result.url}\n`
      if (result.text) {
        markdown += `- 描述: ${result.text}\n`
      }
      markdown += '\n'
    })

    // 3. 如果没有提取到结构化结果，提取基础HTML结构
    if (searchResults.length === 0) {
      // 提取所有可见文本块并保留基本结构
      $('h1, h2, h3, h4, h5, h6, p, div').each((_, element) => {
        const $el = $(element)
        // 跳过空白或很短的文本块
        const text = $el.text().trim()
        if (text.length < 5) return

        // 根据元素类型添加标记
        const tagName = $el.prop('tagName')?.toLowerCase() || ''
        if (tagName.startsWith('h')) {
          const level = parseInt(tagName.substring(1))
          markdown += `${'#'.repeat(level)} ${text}\n\n`
        } else {
          markdown += `${text}\n\n`
        }
      })

      // 再次提取所有链接
      $('a').each((_, element) => {
        const $el = $(element)
        const href = $el.attr('href') || ''
        const text = $el.text().trim()

        if (href && href !== '#' && text.length > 0) {
          let url = href
          try {
            url = href.startsWith('http') ? href : new URL(href, baseUrl).toString()
          } catch {
            // 如果URL构建失败，使用原始href
          }
          markdown += `- [${text}](${url})\n`
        }
      })
    }

    // 4. 最后，添加所有图片的引用
    $('img').each((_, element) => {
      const $el = $(element)
      const src = $el.attr('src') || ''
      const alt = $el.attr('alt') || '图片'

      if (src) {
        let imageUrl = src
        try {
          imageUrl = src.startsWith('http') ? src : new URL(src, baseUrl).toString()
        } catch {
          // 如果URL构建失败，使用原始src
        }
        markdown += `![${alt}](${imageUrl})\n`
      }
    })

    return markdown
  }
}
