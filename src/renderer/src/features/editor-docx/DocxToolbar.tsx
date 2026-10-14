import type { Editor } from '@tiptap/react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  CalendarPlus,
  FileDown,
  Omega,
  PenTool,
  SeparatorHorizontal,
  SpellCheck,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Layers,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  TextQuote,
  Underline,
  Undo2
} from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton, ToolbarDivider } from '@/components/ui/button'
import { Select } from '@/components/ui/controls'
import { ActionMenu, type MenuEntry } from '@/components/ui/overlays'

type BlockStyle = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4'

// Fonts that ship with Windows and Office, so a document looks the same in Word. The first
// entry is the document default and is stored as "no explicit font".
export const DEFAULT_FONT = 'Calibri'
export const FONTS = [DEFAULT_FONT, 'Arial', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana', 'Consolas']
export const DEFAULT_SIZE = 11
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48]

function currentStyle(editor: Editor): BlockStyle {
  for (const level of [1, 2, 3, 4] as const) {
    if (editor.isActive('heading', { level })) return `h${level}`
  }
  return 'paragraph'
}

function currentFont(editor: Editor): string {
  const family = editor.getAttributes('textStyle').fontFamily as string | undefined
  const first = family?.split(',')[0].replace(/['"]/g, '').trim()
  return first && FONTS.includes(first) ? first : DEFAULT_FONT
}

function currentSize(editor: Editor): number {
  const size = parseFloat((editor.getAttributes('textStyle').fontSize as string | undefined) ?? '')
  return Number.isFinite(size) ? size : DEFAULT_SIZE
}

const COMPACT_SELECT = 'h-7 shrink-0 border-transparent bg-transparent px-2 text-xs hover:border-line-strong hover:bg-hover focus:bg-bg'

/**
 * The formatting toolbar, one compact row grouped as: history · text style · emphasis ·
 * alignment · lists · insert · tools. Buttons show their active state from the selection.
 */
export function DocxToolbar({
  editor,
  onInsertLink,
  onInsertImage,
  onFlashcards,
  onPageBreak,
  onWhiteboard,
  onSymbol,
  onExportPdf,
  onPlanner,
  onCheckWriting,
  checking
}: {
  editor: Editor
  onInsertLink(): void
  onInsertImage(): void
  onFlashcards(): void
  onPageBreak(): void
  onWhiteboard(): void
  onSymbol(): void
  onExportPdf(): void
  onPlanner(): void
  onCheckWriting(): void
  checking: boolean
}): ReactNode {
  const chain = () => editor.chain().focus()
  const inTable = editor.isActive('table')
  const inList = editor.isActive('listItem')
  const size = currentSize(editor)
  const tableItems: MenuEntry[] = [
    { label: 'Insert 3 × 3 table', onSelect: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { type: 'separator' },
    { label: 'Add row below', disabled: !inTable, onSelect: () => chain().addRowAfter().run() },
    { label: 'Add column to the right', disabled: !inTable, onSelect: () => chain().addColumnAfter().run() },
    { label: 'Delete row', disabled: !inTable, onSelect: () => chain().deleteRow().run() },
    { label: 'Delete column', disabled: !inTable, onSelect: () => chain().deleteColumn().run() },
    { type: 'separator' },
    { label: 'Delete table', danger: true, disabled: !inTable, onSelect: () => chain().deleteTable().run() }
  ]

  return (
    <div role="toolbar" aria-label="Formatting" className="flex h-10 shrink-0 items-center overflow-x-auto border-b border-line bg-bg px-2 [&::-webkit-scrollbar]:hidden">
      <IconButton label="Undo" shortcut="Ctrl+Z" disabled={!editor.can().undo()} onClick={() => chain().undo().run()}>
        <Undo2 size={15} />
      </IconButton>
      <IconButton label="Redo" shortcut="Ctrl+Y" disabled={!editor.can().redo()} onClick={() => chain().redo().run()}>
        <Redo2 size={15} />
      </IconButton>
      <ToolbarDivider />

      <Select
        aria-label="Paragraph style"
        className={`${COMPACT_SELECT} w-[106px]`}
        value={currentStyle(editor)}
        onChange={(event) => {
          const value = event.target.value as BlockStyle
          if (value === 'paragraph') chain().setParagraph().run()
          else chain().setHeading({ level: Number(value[1]) as 1 | 2 | 3 | 4 }).run()
        }}
      >
        <option value="paragraph">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
      </Select>
      <Select
        aria-label="Font"
        className={`${COMPACT_SELECT} w-[112px]`}
        value={currentFont(editor)}
        onChange={(event) => {
          const font = event.target.value
          if (font === DEFAULT_FONT) chain().unsetFontFamily().run()
          else chain().setFontFamily(font).run()
        }}
      >
        {FONTS.map((font) => (
          <option key={font} value={font}>
            {font}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Font size"
        className={`${COMPACT_SELECT} w-[62px]`}
        value={SIZES.includes(size) ? size : DEFAULT_SIZE}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (next === DEFAULT_SIZE) chain().unsetFontSize().run()
          else chain().setFontSize(`${next}pt`).run()
        }}
      >
        {SIZES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
      <ToolbarDivider />

      <IconButton label="Bold" shortcut="Ctrl+B" active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()}>
        <Bold size={15} />
      </IconButton>
      <IconButton label="Italic" shortcut="Ctrl+I" active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()}>
        <Italic size={15} />
      </IconButton>
      <IconButton label="Underline" shortcut="Ctrl+U" active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()}>
        <Underline size={15} />
      </IconButton>
      <IconButton label="Strikethrough" active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough size={15} />
      </IconButton>
      <ToolbarDivider />

      <IconButton label="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => chain().setTextAlign('left').run()}>
        <AlignLeft size={15} />
      </IconButton>
      <IconButton label="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => chain().setTextAlign('center').run()}>
        <AlignCenter size={15} />
      </IconButton>
      <IconButton label="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => chain().setTextAlign('right').run()}>
        <AlignRight size={15} />
      </IconButton>
      <IconButton label="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => chain().setTextAlign('justify').run()}>
        <AlignJustify size={15} />
      </IconButton>
      <ToolbarDivider />

      <IconButton label="Bulleted list" shortcut="Ctrl+Shift+8" active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()}>
        <List size={15} />
      </IconButton>
      <IconButton label="Numbered list" shortcut="Ctrl+Shift+7" active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered size={15} />
      </IconButton>
      <IconButton label="Decrease list indent" shortcut="Shift+Tab" disabled={!inList} onClick={() => chain().liftListItem('listItem').run()}>
        <IndentDecrease size={15} />
      </IconButton>
      <IconButton label="Increase list indent" shortcut="Tab" disabled={!inList} onClick={() => chain().sinkListItem('listItem').run()}>
        <IndentIncrease size={15} />
      </IconButton>
      <IconButton label="Quote" active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()}>
        <TextQuote size={15} />
      </IconButton>
      <ToolbarDivider />

      <IconButton label="Link" active={editor.isActive('link')} onClick={onInsertLink}>
        <LinkIcon size={15} />
      </IconButton>
      <IconButton label="Insert image" onClick={onInsertImage}>
        <ImageIcon size={15} />
      </IconButton>
      <ActionMenu items={tableItems}>
        <IconButton label="Table" active={inTable}>
          <TableIcon size={15} />
        </IconButton>
      </ActionMenu>
      <IconButton label="Horizontal line" onClick={() => chain().setHorizontalRule().run()}>
        <Minus size={15} />
      </IconButton>
      <IconButton label="Symbol" onClick={onSymbol}>
        <Omega size={15} />
      </IconButton>
      <IconButton label="Page break" shortcut="Ctrl+Enter" onClick={onPageBreak}>
        <SeparatorHorizontal size={15} />
      </IconButton>
      <IconButton label={editor.isActive('image') && editor.getAttributes('image').whiteboard ? 'Edit drawing' : 'Whiteboard'} onClick={onWhiteboard}>
        <PenTool size={15} />
      </IconButton>
      <ToolbarDivider />
      <IconButton label="Export as PDF" onClick={onExportPdf}>
        <FileDown size={15} />
      </IconButton>

      <IconButton label="Create flashcards from selection" shortcut="Ctrl+Shift+K" onClick={onFlashcards}>
        <Layers size={15} />
      </IconButton>
      <IconButton label="Add selection to planner" shortcut="Ctrl+Shift+D" onClick={onPlanner}>
        <CalendarPlus size={15} />
      </IconButton>
      <ToolbarDivider />
      <IconButton label="Check writing" active={checking} onClick={onCheckWriting}>
        <SpellCheck size={15} />
      </IconButton>
    </div>
  )
}
