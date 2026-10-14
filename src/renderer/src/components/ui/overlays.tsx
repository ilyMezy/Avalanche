import { keyLabel } from '@/lib/platform'
import { ContextMenu, Dialog, DropdownMenu, Tooltip } from 'radix-ui'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Accessible overlay primitives (Radix UI) with the app's styling, in the shadcn/ui manner:
// the component code lives in this repository and nothing is fetched at runtime.
//
// Motion: every overlay uses one of three classes from index.css (ui-overlay, ui-dialog,
// ui-pop). They animate in on mount and out when Radix sets data-state="closed", so dialogs,
// menus, and tooltips all enter and leave the same way.

export function Tip({
  label,
  shortcut,
  side = 'bottom',
  children
}: {
  label: string
  shortcut?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: ReactNode
}): ReactNode {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="ui-pop z-[70] flex items-center gap-2 rounded-md border border-line-strong bg-raised px-2 py-1 text-xs text-fg shadow-pop"
        >
          {label}
          {shortcut && <span className="text-subtle">{keyLabel(shortcut)}</span>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className
}: {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  className?: string
}): ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className={cn(
            'ui-dialog fixed top-[14%] left-1/2 z-50 flex max-h-[76vh] w-[460px] max-w-[92vw] -translate-x-1/2 flex-col',
            'rounded-xl border border-line-strong bg-raised shadow-pop outline-none',
            className
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-1">
            <div className="min-w-0">
              <Dialog.Title className="text-[15px] font-semibold tracking-tight text-fg">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-[13px] leading-relaxed text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-mr-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg"
            >
              <X size={15} />
            </Dialog.Close>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export type MenuEntry =
  | { type?: 'item'; label: string; icon?: ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect(): void }
  | { type: 'separator' }

const MENU_CONTENT = 'ui-pop z-[60] min-w-[196px] rounded-lg border border-line-strong bg-raised p-1 text-[13px] text-fg shadow-pop outline-none'
const MENU_ITEM =
  'flex h-7 cursor-default items-center gap-2.5 rounded-[5px] px-2 outline-none select-none data-[highlighted]:bg-hover data-[disabled]:opacity-40'

function renderEntries(
  entries: MenuEntry[],
  Item: typeof DropdownMenu.Item | typeof ContextMenu.Item,
  Separator: typeof DropdownMenu.Separator | typeof ContextMenu.Separator
): ReactNode {
  return entries.map((entry, index) =>
    entry.type === 'separator' ? (
      <Separator key={index} className="-mx-1 my-1 h-px bg-line" />
    ) : (
      <Item
        key={index}
        disabled={entry.disabled}
        onSelect={entry.onSelect}
        className={cn(MENU_ITEM, entry.danger && 'text-danger data-[highlighted]:bg-danger-soft')}
      >
        <span className={cn('flex w-4 justify-center', entry.danger ? 'text-danger' : 'text-subtle')}>{entry.icon}</span>
        <span className="flex-1">{entry.label}</span>
        {entry.shortcut && <span className="pl-4 text-xs text-subtle">{keyLabel(entry.shortcut)}</span>}
      </Item>
    )
  )
}

/** A dropdown menu opened from a trigger element. */
export function ActionMenu({
  items,
  children,
  align = 'start'
}: {
  items: MenuEntry[]
  children: ReactNode
  align?: 'start' | 'end'
}): ReactNode {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={4} collisionPadding={8} className={MENU_CONTENT}>
          {renderEntries(items, DropdownMenu.Item, DropdownMenu.Separator)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** Wraps an element so that right-clicking it (or pressing the menu key) opens a context menu. */
export function ContextArea({ items, children }: { items: MenuEntry[]; children: ReactNode }): ReactNode {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content collisionPadding={8} className={MENU_CONTENT}>
          {renderEntries(items, ContextMenu.Item, ContextMenu.Separator)}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

export const TooltipProvider = Tooltip.Provider
