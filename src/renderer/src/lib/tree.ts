import type { DocumentMeta } from '@shared/types'

export interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
  doc?: DocumentMeta
}

/** 由扁平的文档列表（id 为相对路径）构建目录树，目录在前、按名称排序 */
export function buildTree(docs: DocumentMeta[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] }
  for (const doc of docs) {
    const parts = doc.id.split('/')
    let node = root
    parts.forEach((seg, i) => {
      const isFile = i === parts.length - 1
      const path = parts.slice(0, i + 1).join('/')
      let child = node.children.find((c) => c.name === seg && c.isDir === !isFile)
      if (!child) {
        child = { name: seg, path, isDir: !isFile, children: [] }
        node.children.push(child)
      }
      if (isFile) child.doc = doc
      node = child
    })
  }
  sortTree(root)
  return root
}

export function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  node.children.forEach(sortTree)
}

/** 按关键词裁剪目录树，保留命中项及其祖先目录 */
export function filterTree(node: TreeNode, q: string): TreeNode | null {
  if (!q) return node
  if (!node.isDir) {
    const hay = `${node.doc?.title ?? ''} ${node.name}`.toLowerCase()
    return hay.includes(q) ? node : null
  }
  const children = node.children
    .map((c) => filterTree(c, q))
    .filter((c): c is TreeNode => c !== null)
  if (children.length === 0) return null
  return { ...node, children }
}

/** 文档路径的所有祖先目录路径，如 a/b/c.md -> ['a','a/b'] */
export function ancestorsOf(id: string): string[] {
  const parts = id.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}
