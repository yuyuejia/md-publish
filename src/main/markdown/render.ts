import type { Article, DocumentContent } from '@shared/types'
import { renderMarkdown } from '@shared/markdown'

export function toArticle(doc: DocumentContent, baseDir?: string): Article {
  return {
    title: doc.title,
    markdown: doc.body,
    html: renderMarkdown(doc.body),
    cover: doc.cover,
    summary: doc.summary,
    tags: doc.tags,
    baseDir
  }
}
