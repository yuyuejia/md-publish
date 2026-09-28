import { useEffect, useRef } from 'react'
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension
} from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
  type Command
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands'
import {
  markdown,
  insertNewlineContinueMarkup,
  deleteMarkupBackward
} from '@codemirror/lang-markdown'
import { languages as allLanguages } from '@codemirror/language-data'
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentUnit,
  syntaxHighlighting,
  defaultHighlightStyle
} from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { tags } from '@lezer/highlight'

const COMMON_LANGUAGES = new Set([
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'json',
  'html',
  'css',
  'scss',
  'less',
  'python',
  'java',
  'go',
  'rust',
  'c',
  'c++',
  'c#',
  'php',
  'ruby',
  'swift',
  'kotlin',
  'shell',
  'sql',
  'yaml',
  'xml',
  'markdown',
  'dockerfile',
  'diff'
])

const codeLanguages = allLanguages.filter((l) => COMMON_LANGUAGES.has(l.name.toLowerCase()))
const monoFont = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

/** 语法高亮：Markdown 结构 + 常见代码 token，配色参考 VSCode */
function highlightStyle(dark: boolean): HighlightStyle {
  const c = dark
    ? {
        heading: '#569cd6',
        strong: '#d7ba7d',
        link: '#4fc1ff',
        mono: '#ce9178',
        quote: '#6a9955',
        list: '#6796e6',
        meta: '#808080',
        comment: '#6a9955',
        keyword: '#c586c0',
        control: '#c586c0',
        string: '#ce9178',
        number: '#b5cea8',
        type: '#4ec9b0',
        fn: '#dcdcaa',
        variable: '#9cdcfe',
        tag: '#569cd6',
        operator: '#d4d4d4'
      }
    : {
        heading: '#0451a5',
        strong: '#795e26',
        link: '#0451a5',
        mono: '#a31515',
        quote: '#008000',
        list: '#0451a5',
        meta: '#808080',
        comment: '#008000',
        keyword: '#0000ff',
        control: '#af00db',
        string: '#a31515',
        number: '#098658',
        type: '#267f99',
        fn: '#795e26',
        variable: '#001080',
        tag: '#800000',
        operator: '#000000'
      }

  return HighlightStyle.define([
    {
      tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
      color: c.heading,
      fontWeight: 'bold'
    },
    { tag: [tags.strong], color: c.strong, fontWeight: 'bold' },
    { tag: [tags.emphasis], fontStyle: 'italic' },
    { tag: [tags.strikethrough], textDecoration: 'line-through' },
    { tag: [tags.link], color: c.link },
    { tag: [tags.url], color: c.link, textDecoration: 'underline' },
    { tag: [tags.monospace], color: c.mono },
    { tag: [tags.quote], color: c.quote },
    { tag: [tags.list], color: c.list },
    { tag: [tags.contentSeparator], color: c.meta },
    { tag: [tags.meta, tags.processingInstruction], color: c.meta },
    { tag: [tags.comment], color: c.comment, fontStyle: 'italic' },
    { tag: [tags.keyword, tags.definitionKeyword, tags.moduleKeyword], color: c.keyword },
    { tag: [tags.controlKeyword, tags.self], color: c.control },
    { tag: [tags.string, tags.special(tags.string)], color: c.string },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: c.number },
    { tag: [tags.typeName, tags.className, tags.namespace], color: c.type },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      color: c.fn
    },
    { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: c.variable },
    { tag: [tags.tagName], color: c.tag },
    { tag: [tags.operator, tags.punctuation], color: c.operator }
  ])
}

function baseTheme(dark: boolean): Extension {
  const bg = dark ? '#1e1f22' : '#ffffff'
  const fg = dark ? '#d6d8dc' : '#1f2328'
  const gutterFg = dark ? '#5a5d63' : '#8b949e'
  const activeBg = dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.045)'
  const activeGutterFg = dark ? '#8a8f98' : '#57606a'
  const selection = dark ? '#264f78' : '#add6ff'
  const selectionSel = `${selection} !important`
  const match = dark ? '#5a4a1e' : '#ffe08a'
  const matchBorder = dark ? '#8a7633' : '#e0b000'
  const border = dark ? '#35373b' : '#d8dade'
  const panelBg = dark ? '#26282c' : '#f3f3f5'
  const matchSel = dark ? '#755d24' : '#ffc61a'

  return EditorView.theme(
    {
      '&': { backgroundColor: bg, color: fg, height: '100%' },
      '.cm-scroller': {
        fontFamily: monoFont,
        lineHeight: '1.6',
        overflow: 'auto'
      },
      '.cm-content': { caretColor: '#4f8cff', fontSize: '13.5px', padding: '16px 0' },
      '.cm-line': { padding: '0 20px' },
      '&.cm-focused': { outline: 'none' },
      '&.cm-focused .cm-cursor': { borderLeftColor: '#4f8cff' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#4f8cff' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: selection
      },
      '.cm-selectionBackground': { backgroundColor: selectionSel },
      '& > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
        backgroundColor: selectionSel
      },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
        backgroundColor: selectionSel
      },
      '.cm-gutters': {
        backgroundColor: bg,
        color: gutterFg,
        border: 'none',
        minWidth: '44px'
      },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 16px' },
      '.cm-activeLine': { backgroundColor: activeBg },
      '.cm-activeLineGutter': { backgroundColor: activeBg, color: activeGutterFg },
      '.cm-foldGutter .cm-gutterElement': { color: gutterFg, cursor: 'pointer', padding: '0 4px' },
      '.cm-foldPlaceholder': {
        background: panelBg,
        border: `1px solid ${border}`,
        color: fg,
        padding: '0 4px',
        margin: '0 2px',
        borderRadius: '3px'
      },
      '.cm-matchingBracket, .cm-nonmatchingBracket': {
        backgroundColor: selection,
        outline: `1px solid ${border}`
      },
      '.cm-selectionMatch': {
        backgroundColor: match,
        outline: `1px solid ${matchBorder}`,
        borderRadius: '2px'
      },
      '.cm-searchMatch': { backgroundColor: match, outline: `1px solid ${border}` },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: matchSel },
      '.cm-panels': { backgroundColor: panelBg, color: fg },
      '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${border}` },
      '.cm-panel.cm-search': { padding: '8px 10px' },
      '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-textfield': {
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        borderRadius: '4px',
        padding: '2px 6px',
        fontFamily: monoFont
      },
      '.cm-panel.cm-search label': { color: fg, fontSize: '12px' },
      '.cm-tooltip': {
        background: panelBg,
        color: fg,
        border: `1px solid ${border}`,
        borderRadius: '6px'
      },
      '.cm-tooltip-autocomplete ul li[aria-selected]': { background: selection, color: fg },
      '.cm-button': {
        background: panelBg,
        backgroundImage: 'none',
        border: `1px solid ${border}`,
        color: fg
      }
    },
    { dark }
  )
}

const prefersDark = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches

function themeFor(dark: boolean): Extension {
  return [baseTheme(dark), syntaxHighlighting(highlightStyle(dark))]
}

/** 用成对标记包裹/取消包裹选区（如 **加粗**、*斜体*、`代码`） */
function wrapSelection(view: EditorView, before: string, after = before): boolean {
  const changes = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to)
    if (
      selected.length >= before.length + after.length &&
      selected.startsWith(before) &&
      selected.endsWith(after)
    ) {
      const inner = selected.slice(before.length, selected.length - after.length)
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length)
      }
    }
    const insert = before + selected + after
    const cursor = range.empty
      ? EditorSelection.cursor(range.from + before.length)
      : EditorSelection.range(range.from, range.from + insert.length)
    return { changes: { from: range.from, to: range.to, insert }, range: cursor }
  })
  view.dispatch(changes, { scrollIntoView: true, userEvent: 'input' })
  view.focus()
  return true
}

const boldCommand: Command = (view) => wrapSelection(view, '**')
const italicCommand: Command = (view) => wrapSelection(view, '*')
const codeCommand: Command = (view) => wrapSelection(view, '`')
const strikeCommand: Command = (view) => wrapSelection(view, '~~')

const linkCommand: Command = (view) => {
  const changes = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to)
    const label = text || 'text'
    const insert = `[${label}](url)`
    const urlStart = range.from + label.length + 3
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + 3)
    }
  })
  view.dispatch(changes, { scrollIntoView: true, userEvent: 'input' })
  view.focus()
  return true
}

interface EditorProps {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  onReady?: (view: EditorView | null) => void
}

export function Editor({ value, onChange, onSave, onReady }: EditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const lastEmitted = useRef<string>(value)
  const callbacks = useRef({ onChange, onSave, onReady })

  useEffect(() => {
    callbacks.current = { onChange, onSave, onReady }
  })

  useEffect(() => {
    if (!containerRef.current) return

    const themeCompartment = new Compartment()

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      EditorState.tabSize.of(2),
      indentUnit.of('  '),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      foldGutter(),
      markdown({ codeLanguages }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      themeCompartment.of(themeFor(prefersDark())),
      EditorView.lineWrapping,
      EditorView.scrollMargins.of(() => ({ bottom: 160 })),
      keymap.of([
        { key: 'Enter', run: insertNewlineContinueMarkup },
        { key: 'Backspace', run: deleteMarkupBackward },
        { key: 'Mod-b', run: boldCommand },
        { key: 'Mod-i', run: italicCommand },
        { key: 'Mod-e', run: codeCommand },
        { key: 'Mod-Shift-x', run: strikeCommand },
        { key: 'Mod-k', run: linkCommand },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...foldKeymap,
        indentWithTab,
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            callbacks.current.onSave?.()
            return true
          }
        }
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const text = update.state.doc.toString()
          lastEmitted.current = text
          callbacks.current.onChange(text)
        }
      })
    ]

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: containerRef.current
    })
    viewRef.current = view
    callbacks.current.onReady?.(view)

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = (e: MediaQueryListEvent): void => {
      view.dispatch({ effects: themeCompartment.reconfigure(themeFor(e.matches)) })
    }
    mql.addEventListener('change', onScheme)

    return () => {
      mql.removeEventListener('change', onScheme)
      callbacks.current.onReady?.(null)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value === lastEmitted.current) return
    if (value === view.state.doc.toString()) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value }
    })
    lastEmitted.current = value
  }, [value])

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />
}
