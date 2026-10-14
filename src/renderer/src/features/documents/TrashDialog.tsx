import { RotateCcw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { displayTitle } from '@shared/domain/naming'
import type { TrashItem } from '@shared/types'
import { useAppStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { confirmDialog } from '@/components/ui/dialogs'
import { EmptyState, toast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlays'
import { EntryIcon } from '@/features/workspace/EntryIcon'
import { call, errorMessage } from '@/lib/api'
import { invalidate, useData } from '@/lib/useData'
import { formatTimestamp, plural } from '@/lib/utils'

/**
 * The app's trash: everything deleted in Avalanche waits here and can be put back. Emptying
 * it sends the items to the Windows Recycle Bin, so even that step is recoverable.
 */
export function TrashDialog(): ReactNode {
  const open = useAppStore((state) => state.trashOpen)
  const items = useData<TrashItem[]>(['workspace'], () => call('workspace.trash'), [open])
  const [busy, setBusy] = useState(false)
  const close = (): void => useAppStore.setState({ trashOpen: false })

  const restore = async (item: TrashItem): Promise<void> => {
    setBusy(true)
    try {
      const entry = await call('workspace.restore', { trashId: item.id })
      toast(`Restored “${displayTitle(entry.name, entry.kind)}” to ${entry.parentPath || 'the workspace'}.`)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
    invalidate('workspace')
    setBusy(false)
  }

  const empty = async (): Promise<void> => {
    const count = items.data?.length ?? 0
    const confirmed = await confirmDialog({
      title: 'Empty the trash?',
      body: `${plural(count, 'item')} will leave Avalanche and go to the Windows Recycle Bin. You can still recover them from there until the Recycle Bin is emptied.`,
      confirmLabel: 'Empty trash',
      danger: true
    })
    if (!confirmed) return
    setBusy(true)
    try {
      await call('workspace.emptyTrash')
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
    invalidate('workspace')
    setBusy(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(value) => !value && close()}
      title="Trash"
      description="Deleted documents and folders are kept here until you empty the trash."
      className="w-[560px]"
      footer={
        <>
          <Button variant="ghost" className="mr-auto text-danger hover:bg-danger-soft hover:text-danger" disabled={busy || !items.data?.length} onClick={() => void empty()}>
            <Trash2 size={14} />
            Empty trash
          </Button>
          <Button onClick={close}>Done</Button>
        </>
      }
    >
      {items.data?.length ? (
        <div className="-mx-1">
          {items.data.map((item) => (
            <div key={item.id} data-testid="trash-row" className="flex h-11 items-center gap-3 rounded-md px-2 hover:bg-hover">
              <EntryIcon kind={item.kind} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-fg">{displayTitle(item.name, item.kind)}</div>
                <div className="truncate text-xs text-subtle">
                  From {item.originalRelPath.includes('/') ? item.originalRelPath.slice(0, item.originalRelPath.lastIndexOf('/')) : 'the workspace root'} · deleted{' '}
                  {formatTimestamp(item.deletedAt)}
                </div>
              </div>
              <Button size="sm" disabled={busy} onClick={() => void restore(item)}>
                <RotateCcw size={12} />
                Restore
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState compact icon={<Trash2 size={18} />} title="The trash is empty" body="Items you delete can be restored from here." />
      )}
    </Modal>
  )
}
