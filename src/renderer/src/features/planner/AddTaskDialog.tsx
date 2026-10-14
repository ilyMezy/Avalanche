import { useEffect, useState, type ReactNode } from 'react'
import { taskFromText } from '@shared/domain/task-text'
import { useAppStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/controls'
import { toast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlays'
import { call, errorMessage } from '@/lib/api'
import { invalidate } from '@/lib/useData'
import { todayString } from '@/lib/utils'

/**
 * Adds a planner task from text selected in a document. The title, notes, and any date or time
 * found in the text are filled in as a suggestion; nothing is saved until the user confirms.
 */
export function AddTaskDialog(): ReactNode {
  const request = useAppStore((state) => state.taskRequest)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [remind, setRemind] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!request) return
    const draft = taskFromText(request.text, todayString())
    setTitle(draft.title)
    setNotes(draft.notes)
    setDueDate(draft.dueDate ?? '')
    setDueTime(draft.dueTime ?? '')
    setRemind(false)
    setBusy(false)
  }, [request])

  if (!request) return null
  const close = (): void => useAppStore.setState({ taskRequest: null })

  const save = async (): Promise<void> => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      await call('planner.saveTask', {
        title,
        notes,
        dueDate: dueDate || null,
        dueTime: dueDate && dueTime ? dueTime : null,
        reminder: remind && dueDate ? { localDate: dueDate, localTime: dueTime || '09:00', recurrence: 'none' } : null
      })
      invalidate('planner')
      toast(dueDate ? 'Added to the planner.' : 'Added to the planner without a due date.')
      close()
    } catch (error) {
      toast(errorMessage(error), 'error')
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && close()}
      title="Add to planner"
      description="Made from the text you selected. Check the details, then add it."
      className="w-[480px]"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!title.trim() || busy} onClick={() => void save()}>
            Add task
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Field label="Task">
          <Input autoFocus aria-label="Task title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea aria-label="Task notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Due date">
            <Input type="date" aria-label="Due date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
          <Field label="Due time">
            <Input type="time" aria-label="Due time" value={dueTime} disabled={!dueDate} onChange={(event) => setDueTime(event.target.value)} />
          </Field>
        </div>
        <label className={`flex items-center gap-2 text-[13px] ${dueDate ? 'cursor-pointer text-fg' : 'text-subtle'}`}>
          <input type="checkbox" checked={remind && dueDate !== ''} disabled={!dueDate} onChange={(event) => setRemind(event.target.checked)} className="accent-[var(--accent)]" />
          Remind me then{dueDate && !dueTime ? ' (at 09:00)' : ''}
        </label>
      </form>
    </Modal>
  )
}
